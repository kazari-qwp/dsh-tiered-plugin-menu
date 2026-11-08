import { Context, Service, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { createElement, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import type { MenuRemote } from '../remote-contract.ts'
import { clientScope, scopeKey, type PluginRow, type Scope } from '../shared.ts'
import { sessionForm } from './form.ts'
import { captureRegisteredSettings } from './registered-settings.tsx'
import { isolateProvidedServices } from '../isolation.ts'
import { scopedRemote } from './scoped-remote.ts'
import { scopePluginFetch } from './scoped-fetch.ts'

/** 后端实例按作用域长期存活；客户端把当前会话的原生面板绑定到它的配置表。 */
export class ContextClient {
  private sessionId: string | null = null
  private mounted?: Fiber
  private native?: { entry: any; isolation: Record<string, symbol>; disabled: boolean | null }
  private mutedSlots = Symbol('tiered-managed-client')
  private current = ''
  private removeCard?: () => void
  private pending = Promise.resolve()
  private stopped = false
  private managed = false
  private forms = new Map<string, ReturnType<typeof sessionForm>>()
  private formRows = new Map<string, PluginRow>()
  private cards = new Map<string, Promise<{ Page: ComponentType; dispose(): unknown }>>()
  private fetch = scopePluginFetch()

  constructor(private ctx: Context, private api: MenuRemote, private plugin: Plugin, private namespace: string, private packageName = namespace) {
    ctx.on('loader/patch-context', async (entry, next) => {
      if (this.managed && !this.stopped && entry.options.name === this.packageName) {
        this.rememberNative(entry)
        // 原入口等待私有 slots；重新开启全局时创建的新入口也一样处理。
        entry.ctx[Context.isolate].slots = this.mutedSlots
      }
      await next()
    })
  }

  private rememberNative(entry: any) {
    if (this.native?.entry === entry) return
    const isolation = Object.assign(Object.create(Object.getPrototypeOf(entry.ctx[Context.isolate])), entry.ctx[Context.isolate])
    this.native = { entry, isolation, disabled: entry.options.disabled ?? null }
  }

  select(sessionId: string | null) { this.sessionId = sessionId; return this.refresh() }

  refresh(): Promise<void> {
    const run = () => this.stopped ? undefined : this.sync()
    this.pending = this.pending.then(run, run)
    return this.pending
  }

  private form(row: PluginRow, scope: Scope) {
    const key = `${scopeKey(scope)}/${row.id}`
    this.formRows.set(key, row)
    let form = this.forms.get(key)
    if (!form) {
      form = sessionForm(row.config, async config => {
        const result = await this.api.configure(scope, row.id, this.formRows.get(key)!.enabled, config, false)
        if (!result.ok) throw new Error(result.error.message)
        void this.refresh().catch(error => this.ctx.logger.error(error))
      })
      this.forms.set(key, form)
    }
    form.replace(row.config)
    return form
  }

  async settings(row: PluginRow, scope: Scope): Promise<ComponentType> {
    const current = await this.api.list(scope)
    if (!current.ok) throw new Error(current.error.message)
    row = current.value.flatMap(item => item.components ?? [item]).find(item => item.id === row.id) ?? row
    const form = this.form(row, scope)
    const key = `${scopeKey(scope)}/${row.id}`
    if (!this.cards.has(key)) this.cards.set(key, captureRegisteredSettings(this.ctx, this.plugin, row.configNamespace ?? this.namespace, form,
      ctx => scopedRemote(ctx, this.api, row, scope), this.packageName))
    return (await this.cards.get(key)!).Page
  }

  private async row(scope: Scope) {
    const result = await this.api.list(scope)
    if (!result.ok) throw new Error(result.error.message)
    return result.value.find(row => row.id === this.namespace)
  }

  private async sync() {
    const client = await this.row(clientScope)
    if (client) this.form(client, clientScope)
    const row = await this.row(this.sessionId ? { level: 'session', id: this.sessionId } : clientScope)
    if (row) this.fetch.select(row)
    if (!row?.managed) return
    this.managed = true
    const entry = [...this.ctx.loader.entries()].find(entry => entry.options.name === this.packageName)
    if (entry && entry !== this.native?.entry) {
      this.rememberNative(entry)
      const { disabled } = this.native!
      await entry.update({ disabled: true })
      await entry.update({ disabled })
    }
    if (entry && client && !this.removeCard) {
      const row = client.components?.[0] ?? client
      try {
        const Page = await this.settings(row, clientScope)
        this.removeCard = this.ctx.slots.inject('plugins.bundle.config', () => this.ctx.slots.register({
          name: 'plugins.bundle.config', key: row.configNamespace ?? row.id,
        } as any, () => createElement(Page)))
      } catch { /* Host-only components may have no native settings card. */ }
    }
    const key = JSON.stringify([row.enabled, row.partial, row.source, row.config, row.components])
    if (key === this.current) return
    await this.mounted?.dispose()
    this.mounted = undefined
    if (!row.enabled && !row.partial) { this.current = key; return }
    const componentRows = row.components ?? [row]
    const form = this.form(row, row.source)
    let isolated = this.ctx.isolate('configForms').isolate('slots').isolate('remote')
    isolated = isolateProvidedServices(isolated, Object.create(isolated[Context.isolate]))
    this.mounted = await isolated.plugin(async (child: Context) => {
      child.provide('configForms', { get: (ns: string) => {
        const component = componentRows.find(item => item.configNamespace === ns)
        return component ? this.form(component, component.source) : form
      }, whileServed: (_ids: string[], mount: () => () => void) => mount() })
      child.provide('remote', scopedRemote(child, this.api, componentRows[0]!, row.source))
      new PanelSlots(child, this.ctx)
      await child.plugin(this.plugin)
    })
    this.current = key
  }

  async dispose() {
    this.stopped = true
    this.fetch.dispose()
    await this.pending.catch(() => {})
    await this.mounted?.dispose()
    this.removeCard?.()
    for (const card of this.cards.values()) await (await card).dispose()
    if (this.native && [...this.ctx.loader.entries()].includes(this.native.entry)) {
      const { entry, isolation, disabled } = this.native
      await entry.update({ disabled: true })
      entry.ctx[Context.isolate] = isolation
      if (this.ctx.root.fiber.state === 2) { await entry.update({ disabled }); await entry.fiber?.await() }
      else entry.options.disabled = disabled
    }
  }
}

class PanelSlots extends Service {
  constructor(ctx: Context, private root: Context) { super(ctx, 'slots') }
  entries(name: any) { return this.root.slots.entries(name) }
  inject(name: any, mount: () => () => void) {
    if (name === 'plugins.bundle.config') return () => {}
    return this.ctx.effect(() => this.root.slots.inject(name, mount))
  }
  register(options: any, component: ComponentType<any>) { return this.ctx.effect(() => this.root.slots.register(options, props => createElement(component, props))) }
}

export function ActiveSession({ controller, sessionId }: { controller: ContextClient; sessionId?: string }) {
  useEffect(() => {
    void controller.select(sessionId ?? null).catch(error => console.error(error))
    return () => { void controller.select(null).catch(error => console.error(error)) }
  }, [controller, sessionId])
  return null
}

export function RegisteredSettings({ controller, row, scope, fallback }: { controller: ContextClient; row: PluginRow; scope: Scope; fallback?: ReactNode }) {
  const [Page, setPage] = useState<ComponentType>()
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    void controller.settings(row, scope).then(page => { if (live) setPage(() => page) }, error => { if (live) setError(String(error)) })
    return () => { live = false }
  }, [controller, scopeKey(scope), row.config])
  return error ? <>{fallback ?? <p role="status">{error}</p>}</> : Page ? <Page /> : <p>加载原生配置…</p>
}
