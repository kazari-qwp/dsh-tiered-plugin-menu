import { Context, Service, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import { createElement, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import type { MenuRemote } from 'dsh-tiered-plugin-core/remote-contract'
import { clientScope, scopeKey, type PluginRow, type Scope } from 'dsh-tiered-plugin-core/shared'
import { sessionForm } from './form.ts'
import { captureRegisteredSettings } from './registered-settings.tsx'
import { isolateProvidedServices } from 'dsh-tiered-plugin-core/isolation'
import { scopedRemote } from './scoped-remote.ts'
import { scopePluginFetch } from './scoped-fetch.ts'
import { rowReader, type ReadRows } from './refresh.ts'

/** 后端实例按作用域长期存活；客户端把当前会话的原生面板绑定到它的配置表。 */
export class ContextClient {
  revision = 0
  private sessionId: string | null = null
  private mounted?: Fiber
  private native?: { entry: Entry; disabled: Entry['options']['disabled'] | null; restore(): void }
  private current = ''
  private removeCard?: () => void
  private pending = Promise.resolve()
  private stopped = false
  private managed = false
  private clientEnabled = false
  private forms = new Map<string, ReturnType<typeof sessionForm>>()
  private cards = new Map<string, Promise<{ Page: ComponentType; dispose(): unknown }>>()
  private fetch = scopePluginFetch()

  constructor(private ctx: Context, private api: MenuRemote, private plugin: Plugin | undefined, private namespace: string, private packageName = namespace,
    private readRows: ReadRows = rowReader(api).read) {
    ctx.on('loader/patch-context', async (entry, next) => {
      if (this.managed && !this.stopped && entry.options.name === this.packageName) {
        this.rememberNative(entry)
      }
      await next()
    })
  }

  private rememberNative(entry: Entry) {
    if (this.native?.entry === entry) return
    this.native?.restore()
    const ctx = entry.ctx
    const registry = ctx.registry
    const descriptor = Object.getOwnPropertyDescriptor(ctx, 'registry')
    // The Loader entry keeps ownership of the module and its styles. Only the
    // controller runs the real UI, with the selected scope's configuration.
    const managedEntry = { name: this.packageName, apply() {} }
    const registryView = Object.create(registry, {
      plugin: { value: (plugin: Plugin, config: unknown, getOuterStack?: () => string[]) =>
        registry.plugin(registry.resolve(plugin) ? managedEntry : plugin, config, getOuterStack) },
    })
    Object.defineProperty(ctx, 'registry', { configurable: true, value: registryView })
    this.native = {
      entry, disabled: entry.options.disabled ?? null,
      restore() {
        if (descriptor) Object.defineProperty(ctx, 'registry', descriptor)
        else Reflect.deleteProperty(ctx, 'registry')
      },
    }
  }

  select(sessionId: string | null) { this.sessionId = sessionId; return this.refresh() }

  refresh(readRows = this.readRows): Promise<void> {
    const run = () => this.stopped ? undefined : this.sync(readRows)
    this.pending = this.pending.then(run, run)
    return this.pending
  }

  async setPlugin(plugin: Plugin | undefined, readRows = this.readRows): Promise<boolean> {
    let changed = false
    const run = async () => {
      if (this.stopped || this.plugin === plugin) return
      await this.clearClient()
      this.plugin = plugin
      this.revision++
      changed = true
      await this.sync(readRows)
    }
    this.pending = this.pending.then(run, run)
    await this.pending
    return changed
  }

  private async clearClient() {
    await this.mounted?.dispose()
    this.mounted = undefined
    this.removeCard?.()
    this.removeCard = undefined
    for (const card of this.cards.values()) await (await card).dispose()
    this.cards.clear()
    this.current = ''
  }

  private form(row: PluginRow, scope: Scope) {
    const key = `${scopeKey(scope)}/${row.id}`
    let form = this.forms.get(key)
    if (!form) {
      form = sessionForm(row.config, async config => {
        const result = await this.api.saveConfig(scope, row.id, config)
        if (!result.ok) throw new Error(result.error.message)
        void this.refresh().catch(error => this.ctx.logger.error(error))
      })
      this.forms.set(key, form)
    }
    form.replace(row.config)
    return form
  }

  async settings(row: PluginRow, scope: Scope, readRows = this.readRows): Promise<ComponentType> {
    if (!this.plugin) throw new Error('插件前端正在重新加载')
    const current = await readRows(scope)
    row = current.flatMap(item => item.components ?? [item]).find(item => item.id === row.id) ?? row
    const form = this.form(row, scope)
    const key = `${scopeKey(scope)}/${row.id}`
    if (!this.cards.has(key)) this.cards.set(key, captureRegisteredSettings(this.ctx, this.plugin, row.configNamespace ?? this.namespace, form,
      ctx => scopedRemote(ctx, this.api, row, scope), this.packageName))
    return (await this.cards.get(key)!).Page
  }

  private async row(scope: Scope, readRows: ReadRows) {
    return (await readRows(scope)).find(row => row.id === this.namespace)
  }

  private async sync(readRows = this.readRows) {
    if (!this.plugin) return
    const client = await this.row(clientScope, readRows)
    if (client) {
      this.clientEnabled = client.enabled || !!client.partial
      this.form(client, clientScope)
    }
    // An unmanaged plugin uses its native client everywhere. Only managed
    // plugins need a second, session-specific view.
    const row = this.sessionId && client?.managed ? await this.row({ level: 'session', id: this.sessionId }, readRows) : client
    if (row) this.fetch.select(row)
    if (!row?.managed) return
    this.managed = true
    const entry = [...this.ctx.loader.entries()].find(entry => entry.options.name === this.packageName)
    if (entry && entry !== this.native?.entry) {
      this.rememberNative(entry)
      const { disabled } = this.native!
      await entry.update({ disabled: true })
      await entry.update({ disabled })
      await entry.fiber?.await()
    }
    if (entry && client && !this.removeCard) {
      const row = client.components?.[0] ?? client
      try {
        const Page = await this.settings(row, clientScope, readRows)
        this.removeCard = this.ctx.slots.inject('plugins.bundle.config', () => this.ctx.slots.register({
          name: 'plugins.bundle.config', key: row.configNamespace ?? row.id,
        } as any, () => createElement(Page)))
      } catch { /* Host-only components may have no native settings card. */ }
    }
    const key = JSON.stringify([row.enabled, row.partial, row.source, row.config, row.components, row.projections])
    if (key === this.current) return
    await this.mounted?.dispose()
    this.mounted = undefined
    if (!row.enabled && !row.partial) { this.current = key; return }
    const componentRows = row.components ?? [row]
    const plugin = this.plugin
    const form = this.form(row, row.source)
    let isolated = this.ctx.isolate('configForms').isolate('slots').isolate('remote')
    isolated = isolateProvidedServices(isolated, Object.create(isolated[Context.isolate]))
    this.mounted = await isolated.plugin(async (child: Context) => {
      child.provide('configForms', { get: (ns: string) => {
        const component = componentRows.find(item => item.configNamespace === ns)
        return component ? this.form(component, component.source) : form
      }, whileServed: (_ids: string[], mount: () => () => void) => mount() })
      child.provide('remote', scopedRemote(child, this.api, componentRows[0]!, row.source))
      new PanelSlots(child, this.ctx, Object.assign({}, ...componentRows.map(row => row.projections)))
      await child.plugin(plugin)
    })
    this.current = key
  }

  async dispose() {
    this.stopped = true
    this.fetch.dispose()
    await this.pending.catch(() => {})
    await this.clearClient()
    const native = this.native
    if (native && [...this.ctx.loader.entries()].includes(native.entry)) {
      const { entry } = native
      // 下级实例也会让原前端进入模块图；卸载菜单时只恢复实际启用的客户端插件。
      const disabled = this.clientEnabled ? native.disabled : true
      try { await entry.update({ disabled: true }) }
      finally { native.restore() }
      if (this.ctx.root.fiber.state === 2) { await entry.update({ disabled }); await entry.fiber?.await() }
      else entry.options.disabled = disabled
    } else native?.restore()
  }
}

class PanelSlots extends Service {
  constructor(ctx: Context, private root: Context, private projections: Record<string, string>) { super(ctx, 'slots') }
  entries(name: any) { return this.root.slots.entries(name) }
  inject(name: any, mount: () => () => void) {
    if (name === 'plugins.bundle.config') return () => {}
    return this.ctx.effect(() => this.root.slots.inject(name, mount))
  }
  register(options: any, component: ComponentType<any>) {
    return this.ctx.effect(() => this.root.slots.register(options, (props: any) => createElement(component,
      typeof props.useProjection === 'function' ? { ...props,
        useProjection: (key: string) => props.useProjection(this.projections[key] ?? key),
      } : props)))
  }
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
