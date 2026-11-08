import { Context, resolveConfig, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import { isVolatile } from '@deepseek-ai/cosmokit'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-config-editor'
import { ConfigStore } from './store.ts'
import { installedPlugins, type InstalledPlugin } from './catalog.ts'
import { attachRoute, installRouting, routing } from './routing.ts'
import { clientScope, scopeKey, type MenuContext, type PluginConfig, type PluginRow, type Scope } from './shared.ts'
import type { ChangeResult } from '@deepseek-ai/dsh-plugin-manager'
import { ScopedServices, scopedServiceNames } from './scoped-services.ts'

interface Instance { scope: Scope; owner: Fiber; plugin: Fiber }

export class PluginManager {
  readonly instances = new Map<string, Map<string, Instance>>()
  private stopped = false
  private syncing = Promise.resolve()
  private plugins = new Map<string, InstalledPlugin>()
  private managed = new Set<string>()
  private services = new Map<string, ScopedServices>()
  private clientOwners: { entry: NonNullable<ReturnType<PluginManager['entry']>>; owner: Fiber; isolation: any; labels: Record<string, symbol> }[] = []

  constructor(private ctx: Context, readonly store: ConfigStore) {}

  private async refresh(): Promise<void> {
    this.plugins = new Map((await installedPlugins(this.ctx)).map(item => [item.id, item]))
  }

  private adapter(id: string): InstalledPlugin {
    const plugin = this.plugins.get(id)
    if (!plugin) throw new Error(`未安装的插件：${id}`)
    return plugin
  }

  private entries(id: string) {
    const rows = this.adapter(id).bundle.rows
    return [...this.ctx.loader.entries()].filter(entry => rows.some(row =>
      row.entryId === entry.id || (row.rowId === entry.options.id && row.moduleName === entry.options.name)))
  }

  private entry(id: string) {
    return this.entries(id)[0]
  }

  private async definition(id: string): Promise<Plugin> {
    const entry = this.entry(id)
    const rows = this.adapter(id).bundle.rows
    if (rows.length !== 1) throw new Error('此插件包不是单入口插件，当前还不能创建独立实例')
    const namespace = entry?.moduleNamespace ?? await (entry?.parent.tree ?? this.ctx.loader).import(rows[0]!.moduleName)
    return this.ctx.loader.unwrapExports(namespace)
  }

  private async normalize(id: string, config: PluginConfig): Promise<PluginConfig> {
    const parsed = resolveConfig(await this.definition(id) as unknown as Plugin.Runtime, config) as PluginConfig
    return Object.fromEntries(Object.entries(parsed ?? {}).map(([key, value]) => [key, isVolatile(value) ? value.get() : value]))
  }

  context(sessionId: string | null): MenuContext {
    const workspaces = this.ctx.workspaceRegistry.list()
    const workspace = sessionId ? workspaces.find(w => w.sessionIds.includes(SessionId(sessionId))) : undefined
    return {
      workspaces: workspaces.map(({ id, title, path }) => ({ id: String(id), title, path })),
      workspaceId: workspace ? String(workspace.id) : null,
    }
  }

  private chain(scope: Scope): Scope[] {
    if (scope.level === 'client') return [clientScope]
    if (scope.level === 'workspace') return [scope, clientScope]
    const workspaceId = this.context(scope.id).workspaceId
    return [scope, ...(workspaceId ? [{ level: 'workspace' as const, id: workspaceId }] : []), clientScope]
  }

  private source(scope: Scope, id: string): Scope {
    return this.chain(scope).find(candidate => this.store.get(candidate, id)) ?? clientScope
  }

  private accepts(scope: Scope, id: string, sessionId: string): boolean {
    if (this.stopped) return scope.level === 'client'
    const selected = this.source({ level: 'session', id: sessionId }, id)
    const enabled = selected.level === 'client' ? this.clientEnabled(id) : this.store.get(selected, id)!.enabled
    return enabled && scopeKey(selected) === scopeKey(scope)
  }

  private clientEnabled(id: string): boolean {
    const entries = this.entries(id)
    return this.adapter(id).bundle.enabled && (!entries.length || entries.some(entry => !entry.disabled))
  }

  instance(scope: Scope, id: string): Instance | undefined {
    return this.instances.get(scopeKey(scope))?.get(id)
  }

  async rows(scope: Scope): Promise<PluginRow[]> {
    await this.refresh()
    return Promise.all([...this.plugins.values()].map(async adapter => {
      const entry = this.entry(adapter.id)
      const source = this.source(scope, adapter.id)
      const saved = source.level === 'client'
        ? { enabled: this.clientEnabled(adapter.id), config: entry?.options.config ?? {} }
        : this.store.get(source, adapter.id)!
      return {
        id: adapter.id, name: adapter.package, package: adapter.package, description: adapter.description, ...saved,
        config: adapter.uiService || adapter.scopedRegistries ? await this.normalize(adapter.id, saved.config) : saved.config,
        managed: this.managed.has(adapter.id),
        verified: adapter.verifiedScopes.includes(scope.level),
        settings: adapter.uiService ? 'temporary-messages' : adapter.scopedRegistries ? 'registered' : 'native',
        own: scope.level === 'client' || !!this.store.get(scope, adapter.id), source,
        active: saved.enabled && (source.level === 'client' ? this.entries(adapter.id).some(entry => entry.fiber?.state === 2) : this.instance(source, adapter.id)?.plugin.state === 2),
      }
    }))
  }

  private markEntry(entry: NonNullable<ReturnType<PluginManager['entry']>>): void {
    if (this.stopped) return
    const mounted = this.clientOwners.find(item => item.entry === entry)
    if (mounted) Object.assign(entry.ctx[Context.isolate], mounted.labels)
    const adapter = [...this.plugins.values()].find(item => this.managed.has(item.id) && item.bundle.rows.some(row => row.moduleName === entry.options.name))
    if (adapter) attachRoute(entry.ctx, { accepts: sessionId => this.accepts(clientScope, adapter.id, sessionId) })
  }

  private async manage(id: string): Promise<void> {
    if (this.managed.has(id)) return
    this.managed.add(id)
    const adapter = this.adapter(id)
    if (adapter.scopedRegistries) this.services.set(id, new ScopedServices(this.ctx))
    for (const entry of this.entries(id)) {
      this.markEntry(entry)
      const broker = this.services.get(id)
      const running = !!entry.fiber?.uid
      const disabled = entry.options.disabled ?? null
      if (broker) {
        if (running) await entry.update({ disabled: true })
        let isolated = this.ctx
        const isolation = entry.ctx[Context.isolate]
        const labels: Record<string, symbol> = {}
        for (const name of scopedServiceNames) { labels[name] = Symbol(name); isolated = isolated.isolate(name, labels[name]) }
        const owner = await broker.mount(isolated, { scope: clientScope,
          accepts: sessionId => this.accepts(clientScope, id, sessionId), configKey: () => JSON.stringify(entry.options.config ?? {}) })
        entry.ctx[Context.isolate] = Object.assign(Object.create(isolation), labels)
        this.clientOwners.push({ entry, owner, isolation, labels })
      }
      if (running) {
        if (broker) await entry.update({ disabled })
        else await entry.fiber!.restart()
        await entry.fiber?.await()
      }
    }
  }

  async start(): Promise<void> {
    await this.refresh()
    installRouting(this.ctx)
    this.ctx.on('loader/patch-context', async (entry, next) => { this.markEntry(entry); await next() })
    for (const adapter of this.plugins.values()) if (this.store.hasScoped(adapter.id)) await this.manage(adapter.id)
    await this.sync()
  }

  private checkChange(result: ChangeResult): void {
    if (result.error) throw new Error(result.error.diagnostic ?? result.error.code)
  }

  async configure(scope: Scope, id: string, enabled: boolean, config: PluginConfig, confirmed = false): Promise<void> {
    await this.refresh()
    const adapter = this.adapter(id)
    if (scope.level === 'client') {
      if (!adapter.bundle.enabled) {
        if (!enabled) return
        this.checkChange(await this.ctx.pluginManager.setBundleEnabled(adapter.package, true))
        await this.refresh()
      }
      for (const entry of this.entries(id)) {
        const normalized = enabled && (adapter.uiService || adapter.scopedRegistries)
          ? await this.normalize(id, config) : undefined
        this.checkChange(await this.ctx.pluginManager.setPluginEnabled(entry.id as never, enabled))
        // 原生客户端实例由 DSH 管理；只有已复用的配置表会从这里保存配置。
        if (normalized) {
          // 开关会重新读取 profile；配置也走持久化编辑，不能只改当前内存入口。
          await this.ctx.configEditor.edit(this.entries(id).find(current => current.id === entry.id)!, () => normalized)
        }
      }
      await this.services.get(id)?.refresh()
      return
    }
    const previous = this.store.get(scope, id)
    if (enabled && !previous?.enabled && !adapter.verifiedScopes.includes(scope.level) && !confirmed) {
      throw new Error('该插件尚未验证此层级的兼容性，请确认后再启用')
    }
    const definition = await this.definition(id)
    if ((definition as Plugin.Object).apply === this.ctx.fiber.runtime?.callback) {
      throw new Error('分级菜单不能在自身管理的作用域内再次加载自己')
    }
    const normalized = await this.normalize(id, config)
    await this.manage(id)
    this.store.set(scope, id, { enabled, config: normalized })
    try {
      if (enabled) await this.instance(scope, id)?.plugin.update(normalized)
      await this.sync()
      await this.services.get(id)?.refresh()
    } catch (error) {
      if (previous) this.store.set(scope, id, previous)
      else this.store.remove(scope, id)
      const failed = this.instance(scope, id)
      if (failed) {
        this.instances.get(scopeKey(scope))!.delete(id)
        await failed.owner.dispose()
      }
      await this.sync()
      await this.services.get(id)?.refresh()
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        throw new Error(`端口已被占用（EADDRINUSE），已恢复原配置。${(error as Error).message}`, { cause: error })
      }
      throw error
    }
  }

  async inherit(scope: Scope, id: string): Promise<void> {
    if (scope.level === 'client') throw new Error('客户端没有上级配置')
    this.store.remove(scope, id)
    await this.sync()
    await this.services.get(id)?.refresh()
  }

  sync(): Promise<void> {
    // DSH 可以同时恢复多个会话；串行同步，避免重复创建同一作用域的实例。
    const run = () => this.syncInstances()
    this.syncing = this.syncing.then(run, run)
    return this.syncing
  }

  private async syncInstances(): Promise<void> {
    const scopes: Scope[] = [
      ...this.ctx.workspaceRegistry.list().map(w => ({ level: 'workspace' as const, id: String(w.id) })),
      ...this.ctx.agents.list().map(agent => ({ level: 'session' as const, id: String(agent.id) })),
    ]
    const wanted = new Set<string>()
    for (const scope of scopes) for (const adapter of this.plugins.values()) {
      const saved = this.store.get(scope, adapter.id)
      if (!saved?.enabled) continue
      wanted.add(`${scopeKey(scope)}/${adapter.id}`)
      if (!this.instance(scope, adapter.id)) await this.mount(scope, adapter, saved.config)
    }
    for (const [key, instances] of this.instances) for (const [id, instance] of instances) {
      if (wanted.has(`${key}/${id}`)) continue
      instances.delete(id)
      await instance.owner.dispose()
      if (!instances.size) this.instances.delete(key)
    }
  }

  private async mount(scope: Scope, adapter: InstalledPlugin, config: PluginConfig): Promise<void> {
    let isolated = this.ctx
    for (const service of [...adapter.services, ...(adapter.scopedRegistries ? scopedServiceNames : ['settings']), 'typert']) isolated = isolated.isolate(service)
    const route = { accepts: (sessionId: string) => this.accepts(scope, adapter.id, sessionId) }
    isolated = isolated.extend({ [routing]: route })
    const owner = await isolated.plugin((ctx: Context) => {
      // 原插件的 UI 服务留在本实例，由统一远程接口转发。
      ctx.provide('typert', { register: () => () => {} })
    })
    await this.services.get(adapter.id)?.mount(owner.ctx, { scope, accepts: route.accepts,
      configKey: () => JSON.stringify(this.store.get(scope, adapter.id)?.config ?? {}) })
    // ctx.inject 的子入口失败也要回报，避免把启动失败显示成已启用。
    const failures: Promise<unknown>[] = []
    const unwatch = owner.ctx.on('internal/status', fiber => {
      if (fiber.state === 3 && (fiber.ctx as Context & { [routing]?: unknown })[routing] === route) {
        failures.push(fiber.await().then(() => undefined, error => error))
      }
    })
    let plugin: Fiber
    try {
      plugin = await owner.ctx.plugin(await this.definition(adapter.id), config)
      const error = (await Promise.all(failures)).find(Boolean)
      if (error) throw error
    } catch (error) {
      await owner.dispose()
      throw error
    } finally { unwatch() }
    const instances = this.instances.get(scopeKey(scope)) ?? new Map<string, Instance>()
    instances.set(adapter.id, { scope, owner, plugin })
    this.instances.set(scopeKey(scope), instances)
  }

  async releaseSession(sessionId: string): Promise<void> {
    const key = scopeKey({ level: 'session', id: sessionId })
    const instances = this.instances.get(key)
    this.instances.delete(key)
    for (const instance of instances?.values() ?? []) await instance.owner.dispose()
  }

  async invoke(scope: Scope, sessionId: string | null, id: string, method: 'catalog' | 'preview', args: unknown[], signal: AbortSignal): Promise<unknown> {
    const source = this.source(scope, id)
    const context = source.level === 'client' ? this.entry(id)?.fiber?.ctx : this.instance(source, id)?.plugin.ctx
    if (!context) throw new Error('请先启用插件；会话级还需要打开对应会话')
    const service = context.get(this.adapter(id).uiService!) as {
      catalog(sessionId: string | null, signal: AbortSignal): Promise<Record<string, unknown>>
      preview(sessionId: string | null, template: string, signal: AbortSignal): Promise<string>
    }
    const sessions = this.ctx.agents.list().filter(agent => this.chain({ level: 'session', id: String(agent.id) })
      .some(candidate => scopeKey(candidate) === scopeKey(scope))).map(agent => String(agent.id))
    const selected = sessionId && sessions.includes(sessionId) ? sessionId : sessions[0] ?? null
    if (method === 'catalog') return { ...await service.catalog(selected, signal), sessions }
    return service.preview(selected, String(args[1]), signal)
  }

  async dispose(): Promise<void> {
    this.stopped = true
    for (const instances of this.instances.values()) for (const instance of instances.values()) await instance.owner.dispose()
    this.instances.clear()
    for (const { entry, owner, isolation } of this.clientOwners) {
      const running = !!entry.fiber?.uid
      const disabled = entry.options.disabled ?? null
      if (running) await entry.update({ disabled: true })
      entry.ctx[Context.isolate] = isolation
      // 菜单单独卸载时，把客户端入口交回 DSH；应用退出无需重启入口。
      if (this.ctx.root.fiber.state === 2 && running) { await entry.update({ disabled }); await entry.fiber?.await() }
      else entry.options.disabled = disabled
      await owner.dispose()
    }
    this.clientOwners = []
  }
}
