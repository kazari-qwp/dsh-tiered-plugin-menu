import { Context, Inject, resolveConfig, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import { isVolatile } from '@deepseek-ai/cosmokit'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent'
import type { Agent, SessionStartSource } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-config-editor'
import { ConfigStore } from './store.ts'
import { installedPlugins, type InstalledPlugin } from './catalog.ts'
import { attachRoute, installRouting, routing } from './routing.ts'
import { childScope, clientScope, isClientScope, ownScope, scopeKey, type ChildSettings, type MenuContext, type PluginConfig, type PluginRow, type Scope } from './shared.ts'
import type { ChangeResult } from '@deepseek-ai/dsh-plugin-manager'
import { ScopedServices, scopedServiceNames } from './scoped-services.ts'
import { isolateProvidedServices } from './isolation.ts'
import { RuntimeTree } from './runtime-tree.ts'
import { parentWorkspace } from './workspace-tree.ts'
import { ScopedPresets } from './scoped-presets.ts'
import { ScopedModules } from './scoped-modules.ts'
import { dependencyPlan, type DependencyNode } from './dependencies.ts'
import type { ChangeMode, ChangePlan } from './shared.ts'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import type { PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-gateway'

interface Instance { scope: Scope; owner: Fiber; plugin: Fiber }

async function disposeFiber(fiber: Fiber): Promise<void> {
  await fiber.dispose()
  // Another owner may already have claimed disposal while teardown is still running.
  await fiber.await()
}

export class PluginManager {
  readonly instances = new Map<string, Map<string, Instance>>()
  private stopped = false
  private syncing = Promise.resolve()
  private plugins = new Map<string, InstalledPlugin>()
  private managed = new Set<string>()
  private services = new Map<string, ScopedServices>()
  private runtime: RuntimeTree
  private realms = new Map<string, Record<string, symbol>>()
  private declarations = new Map<string, { provides: Set<string>; requires: Set<string> }>()
  private presets?: ScopedPresets
  private modules: ScopedModules
  private resuming = new Map<string, number>()
  private readonly pluginIsolation: boolean
  private pendingEntries = new Set<() => void>()
  private hostLabels = new Map<string, PropertyDescriptor | undefined>()
  private clientOwners: { entry: NonNullable<ReturnType<PluginManager['entry']>>; owner: Fiber; isolation: any; labels: Record<string, symbol>; restore?: () => void; realm?: Record<string, symbol> }[] = []

  constructor(private ctx: Context, readonly store: ConfigStore) {
    this.runtime = new RuntimeTree(ctx)
    this.modules = new ScopedModules(`${store.filename}.data`)
    this.pluginIsolation = store.settings().pluginIsolation
  }

  private async refresh(): Promise<void> {
    this.plugins = new Map((await installedPlugins(this.ctx)).map(item => [item.id, item]))
    const packages = new Map<string, string[]>()
    for (const item of this.plugins.values()) packages.set(item.package, [...packages.get(item.package) ?? [], item.id])
    for (const [name, ids] of packages) this.store.migrate(name, ids)
  }

  private adapter(id: string): InstalledPlugin {
    const plugin = this.plugins.get(id) ?? [...this.plugins.values()].find(item => item.package === id && item.parentId === item.id)
    if (!plugin) throw new Error(`未安装的插件：${id}`)
    return plugin
  }

  private entries(id: string) {
    const rows = this.adapter(id).bundle.rows
    return [...this.ctx.loader.entries()].filter(entry => entry.parent.tree !== this.runtime && rows.some(row =>
      row.entryId === entry.id || (row.rowId === entry.options.id && row.moduleName === entry.options.name)))
  }

  private entry(id: string) {
    return this.entries(id)[0]
  }

  private async definition(id: string): Promise<Plugin> {
    const entry = this.entry(id)
    const rows = this.adapter(id).bundle.rows
    const namespace = entry?.moduleNamespace ?? await (entry?.parent.tree ?? this.ctx.loader).import(rows[0]!.moduleName)
    return this.ctx.loader.unwrapExports(namespace)
  }

  private targets(id: string) {
    const group = [...this.plugins.values()].filter(item => item.parentId === id || item.package === id)
    return group.length ? group : [this.adapter(id)]
  }

  private async dependencyNodes(scope: Scope): Promise<DependencyNode[]> {
    const result: DependencyNode[] = []
    for (const item of this.plugins.values()) {
      const plugin = await this.definition(item.id) as Plugin.Object
      const declared = this.declarations.get(item.id) ?? { provides: new Set<string>(), requires: new Set<string>() }
      for (const name of [plugin.provide ?? []].flat()) declared.provides.add(name)
      for (const name of Object.keys(Inject.resolve(plugin.inject))) declared.requires.add(name)
      for (const name of Object.keys(Inject.resolve(item.options.inject))) declared.requires.add(name)
      const entry = this.entry(item.id)
      for (const runtime of this.ctx.registry.values()) for (const fiber of runtime.fibers) {
        if (!entry || fiber.ctx.fiber.entry !== entry) continue
        // Private helpers are not services exported by the package entry.
        for (const provision of fiber.provisions) {
          if (provision.isolate === entry.ctx[Context.isolate][provision.name]) declared.provides.add(provision.name)
        }
        // An unserved ctx.inject callback may be an optional integration (for example, GUI settings).
        if (fiber.state === 2) for (const name of Object.keys(fiber.inject)) declared.requires.add(name)
      }
      this.declarations.set(item.id, declared)
      const source = this.source(scope, item.id)
      result.push({ id: item.id, name: item.options.id, provides: [...declared.provides],
        requires: [...declared.requires].filter(name => !declared.provides.has(name)),
        enabled: isClientScope(source) ? this.clientEnabled(item.id) : this.store.get(source, item.id)!.enabled })
    }
    if (!isClientScope(scope)) return result
    const provided = new Set(result.flatMap(node => node.provides))
    const known = new Set([...this.plugins.values()].flatMap(item => this.entries(item.id)))
    // Native components can depend on third-party services too (for example, agent presets).
    for (const entry of this.ctx.loader.entries()) {
      if (known.has(entry) || entry.parent.tree === this.runtime) continue
      const required = Object.keys({ ...Inject.resolve(entry.options.inject), ...entry.fiber?.inject }).filter(name => provided.has(name))
      if (required.length) result.push({ id: `@entry:${entry.id}`, name: entry.options.id, requires: required, provides: [], enabled: !entry.disabled })
    }
    return result
  }

  async plan(scope: Scope, id: string, mode: ChangeMode): Promise<ChangePlan> {
    await this.refresh()
    if (mode === 'inherit' && isClientScope(scope)) throw new Error('客户端没有上级配置')
    const targets = this.targets(id).map(item => item.id)
    const nodes = await this.dependencyNodes(scope)
    const provided = new Set(nodes.flatMap(node => node.provides))
    const host = new Set(Object.keys(this.ctx.reflect.props).filter(name => this.ctx.reflect.props[name]!.type === 'service' && !provided.has(name) && this.ctx.get(name) !== undefined))
    const changes: ChangePlan['changes'] = []
    const missing: string[] = []
    const on = targets.filter(target => mode === 'on' || mode === 'inherit' && (() => {
      const parent = this.chain(scope).slice(1).find(candidate => this.store.get(candidate, target)) ?? clientScope
      return isClientScope(parent) ? this.clientEnabled(target) : this.store.get(parent, target)!.enabled
    })())
    for (const [selection, enabled] of [[on, true], [targets.filter(target => !on.includes(target)), false]] as const) {
      if (!selection.length) continue
      const plan = dependencyPlan(nodes, selection, enabled, host)
      missing.push(...plan.missing)
      for (const target of [...plan.enable, ...plan.disable]) changes.push({ scope, id: target,
        name: nodes.find(node => node.id === target)!.name, mode: targets.includes(target) ? mode : enabled ? 'on' : 'off' })
    }
    const after = (view: Scope, id: string) => {
      for (const candidate of this.chain(view)) {
        const change = changes.find(item => item.id === id && scopeKey(item.scope) === scopeKey(candidate))
        if (change?.mode === 'inherit') continue
        if (change) return change.mode === 'on'
        if (isClientScope(candidate)) return this.clientEnabled(id)
        const saved = this.store.get(candidate, id)
        if (saved) return saved.enabled
      }
      return false
    }
    const children = new Map<string, Scope>()
    for (const child of [
      ...this.store.scopes(),
      ...this.ctx.workspaceRegistry.list().map(workspace => ({ level: 'workspace' as const, id: String(workspace.id) })),
      ...this.ctx.agents.list().map(agent => ({ level: 'session' as const, id: String(agent.id) })),
    ]) if (!scope.children && scopeKey(child) !== scopeKey(scope) && this.chain(child).some(parent => scopeKey(parent) === scopeKey(scope))) children.set(scopeKey(child), child)
    // A session may keep an explicit consumer while inheriting its provider from a workspace.
    for (const child of [...children.values()].sort((a, b) => this.chain(a).length - this.chain(b).length)) {
      const childNodes = await this.dependencyNodes(child)
      const removed = childNodes.filter(node => node.enabled && !after(child, node.id)).map(node => node.id)
      if (removed.length) {
        const plan = dependencyPlan(childNodes, removed, false, host)
        for (const target of plan.disable) if (after(child, target)) changes.push({ scope: child, id: target,
          name: childNodes.find(node => node.id === target)!.name, mode: 'off' })
      }
      const added = childNodes.filter(node => !node.enabled && after(child, node.id)).map(node => node.id)
      if (added.length) {
        const plan = dependencyPlan(childNodes.map(node => ({ ...node, enabled: after(child, node.id) })), added, true, host)
        missing.push(...plan.missing)
        for (const target of plan.enable) if (!after(child, target)) changes.push({ scope: child, id: target,
          name: childNodes.find(node => node.id === target)!.name, mode: 'on' })
      }
    }
    const dependencies = changes.filter(change => scopeKey(change.scope) !== scopeKey(scope) || !targets.includes(change.id))
    const unverified = changes.filter(change => change.mode === 'on' && !isClientScope(change.scope)
      && !change.id.startsWith('@entry:') && !this.adapter(change.id).selfCompatible
      && !this.store.get(change.scope, change.id)?.enabled).map(change => change.name)
    const signature = JSON.stringify([changes, missing, unverified, nodes.map(node => [node.id, node.enabled])])
    return { scope, id, mode, changes, dependencies, missing, unverified, signature }
  }

  async change(scope: Scope, id: string, mode: ChangeMode, signature: string): Promise<void> {
    const plan = await this.plan(scope, id, mode)
    if (plan.signature !== signature) throw new Error('依赖状态已变化，请重新确认')
    if (plan.missing.length) throw new Error(`依赖不可用：${plan.missing.join('、')}`)
    // The UI confirms the whole list before the first write.
    const key = (change: { scope: Scope; id: string }) => `${scopeKey(change.scope)}/${change.id}`
    const previous = new Map(plan.changes.map(change => [key(change), this.store.get(change.scope, change.id)]))
    const rows = new Map<string, PluginRow>()
    for (const change of plan.changes) {
      if (change.id.startsWith('@entry:')) continue
      const row = (await this.rows(change.scope)).flatMap(row => row.components ?? [row]).find(row => row.id === change.id)!
      rows.set(key(change), row)
    }
    const applied: typeof plan.changes = []
    try {
      // Deeper consumers close before their inherited providers; providers enable before consumers.
      const ordered = [...plan.changes].sort((a, b) => a.mode === 'off' && b.mode === 'off'
        ? this.chain(b.scope).length - this.chain(a.scope).length : 0)
      for (const change of ordered) {
        if (change.id.startsWith('@entry:')) {
          if (change.scope.level !== 'client') throw new Error(`原生组件 ${change.name} 只能在客户端级更改`)
          this.checkChange(await this.ctx.pluginManager.setPluginEnabled(change.id.slice('@entry:'.length) as never, change.mode === 'on'))
          applied.push(change)
          continue
        }
        if (change.mode === 'inherit') await this.inherit(change.scope, change.id, true)
        else await this.configure(change.scope, change.id, change.mode === 'on', rows.get(key(change))!.config, true, true)
        applied.push(change)
      }
    } catch (error) {
      for (const change of applied.reverse()) {
        if (change.id.startsWith('@entry:')) {
          this.checkChange(await this.ctx.pluginManager.setPluginEnabled(change.id.slice('@entry:'.length) as never, change.mode !== 'on'))
          continue
        }
        if (isClientScope(change.scope)) {
          const row = rows.get(key(change))!
          await this.configure(change.scope, change.id, row.enabled, row.config, true)
        } else {
          const saved = previous.get(key(change))
          if (saved) this.store.set(change.scope, change.id, saved)
          else this.store.remove(change.scope, change.id)
        }
      }
      await this.sync()
      throw error
    }
  }

  private async normalize(id: string, config: PluginConfig): Promise<PluginConfig> {
    const value = resolveConfig(await this.definition(id) as unknown as Plugin.Runtime, config) as PluginConfig
    const parsed = isVolatile(value) ? value.get() as PluginConfig : value
    // Volatile snapshots are frozen; schema validators may normalize nested dictionaries in place.
    return structuredClone(Object.fromEntries(Object.entries(parsed ?? {}).map(([key, value]) => [key, isVolatile(value) ? value.get() : value])))
  }

  context(sessionId: string | null): MenuContext {
    const workspaces = this.ctx.workspaceRegistry.list()
    // Session setup precedes agent/created and the workspace membership update.
    const cwd = sessionId ? this.ctx.sessions.get(SessionId(sessionId))?.header.cwd : undefined
    const workspace = sessionId ? workspaces.find(w => w.sessionIds.includes(SessionId(sessionId)))
      ?? workspaces.find(w => w.path === cwd) : undefined
    return {
      workspaces: workspaces.map(({ id, title, path }) => ({ id: String(id), title, path })),
      workspaceId: workspace ? String(workspace.id) : sessionId ? this.sessionParents(sessionId)
        .find(scope => scope.level === 'workspace' && workspaces.some(workspace => workspace.id === scope.id))?.id ?? null : null,
    }
  }

  private sessionParents(sessionId: string): Scope[] {
    const parent = this.store.parent({ level: 'session', id: sessionId })
    if (!parent) return []
    return [parent, ...(parent.level === 'session' ? this.sessionParents(parent.id) : [])]
  }

  settings() { return this.store.settings() }
  setPluginIsolation(enabled: boolean): void { this.store.setPluginIsolation(enabled) }

  async setWorkspaceTreeInheritance(enabled: boolean): Promise<void> {
    this.store.setWorkspaceTreeInheritance(enabled)
    await this.sync()
    for (const broker of this.services.values()) await broker.refresh()
  }

  private workspaceParent(scope: Scope): Scope {
    const parent = this.settings().inheritWorkspaceTree
      ? parentWorkspace(scope.id, this.ctx.workspaceRegistry.list()) : undefined
    return parent ? { level: 'workspace', id: String(parent.id) } : clientScope
  }

  private chain(scope: Scope): Scope[] {
    if (scope.children) {
      const policy = this.childSettings(ownScope(scope)).source
      return [scope, ...(policy && scopeKey(policy) !== scopeKey(ownScope(scope)) ? [childScope(policy)] : []), ...this.chain(ownScope(scope))]
    }
    if (scope.level === 'client') return [clientScope]
    if (scope.level === 'workspace') return [scope, ...this.chain(this.workspaceParent(scope))]
    const workspaceId = this.context(scope.id).workspaceId
    return [scope, ...this.sessionParents(scope.id).filter(parent => parent.level === 'session'),
      ...(workspaceId ? this.chain({ level: 'workspace', id: workspaceId }) : [clientScope])]
  }

  childSettings(scope: Scope): ChildSettings {
    scope = ownScope(scope)
    const candidates = this.chain(scope).filter(parent => parent.level === scope.level)
    return { independent: this.store.children(scope).independent,
      source: candidates.find(candidate => this.store.children(candidate).independent) ?? null }
  }

  setChildSettings(scope: Scope, independent: boolean): void { this.store.setChildren(scope, independent) }

  private async initialize(scope: Scope, parent: Scope): Promise<void> {
    const policy = this.childSettings(parent).source
    this.store.initialize(scope, parent, policy ? this.store.children(policy).plugins : {})
    for (const plugin of this.plugins.values()) if (this.store.get(scope, plugin.id)) await this.manage(plugin.id)
  }

  private async agentParent(agent: Agent): Promise<Scope> {
    const owner = this.ctx.agents.list().find(parent => this.ctx.agents.isOwnedBy(agent.id, parent))
    const header = agent.session.header
    const parentId = owner?.id ?? (header.origin === 'subagent' ? header.parentSession : undefined)
    if (parentId) return { level: 'session', id: String(parentId) }
    const workspaceId = this.context(String(agent.id)).workspaceId
    if (workspaceId) return { level: 'workspace', id: workspaceId }
    const workspace = header.cwd ? await this.ctx.workspaceRegistry.resolveByPath(header.cwd) : undefined
    return workspace ? { level: 'workspace', id: String(workspace.id) } : clientScope
  }

  async agentCreated(agent: Agent, source: SessionStartSource): Promise<void> {
    const scope: Scope = { level: 'session', id: String(agent.id) }
    const parent = await this.agentParent(agent)
    if (source === 'startup') await this.initialize(scope, parent)
    else this.store.remember(scope, parent)
    await this.sync()
  }

  private source(scope: Scope, id: string): Scope {
    return this.chain(scope).find(candidate => this.store.get(candidate, id)) ?? clientScope
  }

  private accepts(scope: Scope, id: string, sessionId: string): boolean {
    return this.applies(scope, id, { level: 'session', id: sessionId })
  }

  private applies(scope: Scope, id: string, view: Scope): boolean {
    if (this.stopped) return scope.level === 'client'
    const selected = this.source(view, id)
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
    const components = await Promise.all([...this.plugins.values()].map(async adapter => {
      const entry = this.entry(adapter.id)
      const source = this.source(scope, adapter.id)
      const saved = isClientScope(source)
        ? { enabled: this.clientEnabled(adapter.id), config: entry?.options.config ?? {} }
        : this.store.get(source, adapter.id)!
      return {
        id: adapter.id, name: adapter.parentId === adapter.id ? adapter.package : adapter.options.id, package: adapter.package, description: adapter.description, ...saved,
        config: await this.normalize(adapter.id, saved.config),
        configNamespace: adapter.options.id,
        routes: this.services.get(adapter.id)?.paths() ?? [],
        routePrefix: this.services.get(adapter.id)?.routePrefix || undefined,
        managed: this.managed.has(adapter.id),
        verified: adapter.selfCompatible,
        settings: 'registered' as const,
        own: isClientScope(scope) || !!this.store.get(scope, adapter.id), source,
        active: !scope.children && saved.enabled && (isClientScope(source) ? this.entries(adapter.id).some(entry => entry.fiber?.state === 2) : this.instance(source, adapter.id)?.plugin.state === 2),
      }
    }))
    const result: PluginRow[] = []
    for (const row of components) {
      const parent = this.adapter(row.id).parentId
      if (parent === row.id) { result.push(row); continue }
      let group = result.find(item => item.id === parent)
      if (!group) { group = { ...row, id: parent, name: row.package, components: [] }; result.push(group) }
      group.components!.push(row)
    }
    for (const group of result) if (group.components) {
      group.enabled = group.components.every(row => row.enabled)
      group.active = group.components.every(row => row.active)
      group.own = group.components.some(row => row.own)
      group.managed = group.components.some(row => row.managed)
      group.partial = group.components.some(row => row.enabled) && !group.enabled
    }
    return result
  }

  private markEntry(entry: NonNullable<ReturnType<PluginManager['entry']>>): void {
    if (this.stopped || entry.parent?.tree === this.runtime) return
    const mounted = this.clientOwners.find(item => item.entry === entry)
    if (mounted) {
      if (mounted.realm) Object.setPrototypeOf(entry.ctx[Context.isolate], mounted.realm)
      Object.assign(entry.ctx[Context.isolate], mounted.labels)
    }
    const adapter = [...this.plugins.values()].find(item => this.managed.has(item.id) && item.bundle.rows.some(row => row.moduleName === entry.options.name))
    if (adapter) attachRoute(entry.ctx, { accepts: sessionId => this.accepts(clientScope, adapter.id, sessionId) })
  }

  private async manage(id: string): Promise<void> {
    if (this.managed.has(id)) return
    this.managed.add(id)
    const adapter = this.adapter(id)
    this.services.set(id, new ScopedServices(this.ctx, this.pluginIsolation ? id : undefined))
    for (const entry of this.entries(id)) {
      this.markEntry(entry)
      const broker = this.services.get(id)
      const running = !!entry.fiber?.uid
      const disabled = entry.options.disabled ?? null
      if (broker) {
        if (running) await entry.update({ disabled: true })
        const realm = this.pluginIsolation ? this.realm(clientScope, adapter.package) : undefined
        let isolated = realm ? isolateProvidedServices(this.ctx, realm) : this.ctx
        const isolation = entry.ctx[Context.isolate]
        const labels: Record<string, symbol> = {}
        for (const name of [...scopedServiceNames, 'agentPresets', ...(realm ? ['typert'] : [])]) { labels[name] = Symbol(name); isolated = isolated.isolate(name, labels[name]) }
        const owner = await isolated.plugin(async child => { if (realm) await child.plugin(TypertRegistry) })
        await broker.mount(owner.ctx, { scope: clientScope,
          accepts: sessionId => this.accepts(clientScope, id, sessionId), configKey: () => JSON.stringify(entry.options.config ?? {}) })
        this.mountPresets(owner.ctx, clientScope, id)
        entry.ctx[Context.isolate] = Object.assign(Object.create(realm ?? isolation), labels)
        let restore: (() => void) | undefined
        if (realm) {
          const reflect = Object.getOwnPropertyDescriptor(entry.ctx, 'reflect')
          Object.defineProperty(entry.ctx, 'reflect', Object.getOwnPropertyDescriptor(isolateProvidedServices(this.ctx, realm), 'reflect')!)
          const unbind = this.modules.bind(entry, `${scopeKey(clientScope)}/${adapter.package}`, adapter.peers)
          restore = () => {
            unbind()
            if (reflect) Object.defineProperty(entry.ctx, 'reflect', reflect)
            else delete (entry.ctx as any).reflect
          }
        }
        this.clientOwners.push({ entry, owner, isolation, labels, restore, realm })
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
    const registry = this.ctx.workspaceRegistry
    for (const workspace of registry.list()) {
      const scope: Scope = { level: 'workspace', id: String(workspace.id) }
      this.store.remember(scope, this.workspaceParent(scope))
    }
    for (const agent of this.ctx.agents.list()) this.store.remember({ level: 'session', id: String(agent.id) }, await this.agentParent(agent))
    // 工作区没有创建事件；包装公开创建方法，在返回新工作区前写入默认值。
    const created = async (workspace: Awaited<ReturnType<typeof registry.create>> | undefined) => {
      if (workspace) {
        const scope: Scope = { level: 'workspace', id: String(workspace.id) }
        await this.initialize(scope, this.workspaceParent(scope))
        await this.sync()
      }
      return workspace
    }
    const create = registry.create
    const initializeDefault = registry.initializeDefault
    const remove = registry.delete
    registry.create = async (...args) => (await created(await create.apply(registry, args)))!
    registry.initializeDefault = async (...args) => created(await initializeDefault.apply(registry, args))
    registry.delete = async (...args) => { const deleted = await remove.apply(registry, args); await this.sync(); return deleted }
    this.ctx.effect(() => () => { registry.create = create; registry.initializeDefault = initializeDefault; registry.delete = remove })
    installRouting(this.ctx)
    this.ctx.effect(() => this.ctx.inject(['agentPresets'], child => {
      this.presets = new ScopedPresets(child, scope => this.chain(scope), scope => isolateProvidedServices(this.ctx, this.realm(scope)),
        (id, resume) => this.withResumingSession(id, resume))
    }).dispose)
    this.ctx.on('loader/patch-context', async (entry, next) => { this.markEntry(entry); await next() })
    if (this.pluginIsolation) await this.dependencyNodes(clientScope)
    const targets: InstalledPlugin[] = []
    for (const adapter of this.plugins.values()) {
      if (!this.pluginIsolation && !this.store.hasScoped(adapter.id)) continue
      const definition = await this.definition(adapter.id) as Plugin.Object
      if (definition.apply === this.ctx.fiber.runtime?.callback) continue
      targets.push(adapter)
    }
    // Release the old client registrations together before mounting private ones.
    const clients = this.pluginIsolation ? targets.flatMap(adapter => this.entries(adapter.id)).map(entry => ({ entry, disabled: entry.options.disabled ?? null })) : []
    for (const { entry } of clients) await entry.update({ disabled: true })
    for (const adapter of targets) await this.manage(adapter.id)
    if (this.pluginIsolation) this.connectDependencies([clientScope])
    for (const { entry, disabled } of clients) await entry.update({ disabled })
    if (this.pluginIsolation) await this.dependencyNodes(clientScope)
    await this.sync()
    if (this.pluginIsolation) this.ctx.on('loader/entry-init', entry => {
      const init = entry.init
      const restore = () => { if (entry.init === prepare) entry.init = init; this.pendingEntries.delete(restore) }
      const prepare = async () => {
        restore()
        if (!this.stopped && entry.parent.tree !== this.runtime) {
          await this.refresh()
          const plugin = [...this.plugins.values()].find(item => this.entries(item.id).includes(entry))
          if (plugin) {
            await this.dependencyNodes(clientScope)
            await this.manage(plugin.id)
            this.connectDependencies([clientScope])
          }
        }
        // manage() may have wrapped init with the shared private module loader.
        return entry.init()
      }
      entry.init = prepare
      this.pendingEntries.add(restore)
    })
  }

  private checkChange(result: ChangeResult): void {
    if (result.error) throw new Error(result.error.diagnostic ?? result.error.code)
  }

  async configure(scope: Scope, id: string, enabled: boolean, config: PluginConfig, confirmed = false, applyingPlan = false): Promise<void> {
    await this.refresh()
    const targets = this.targets(id)
    if (targets.length > 1) {
      const plan = await this.plan(scope, id, enabled ? 'on' : 'off')
      if (plan.dependencies.length || plan.missing.length) throw new Error('需要处理依赖，请通过菜单确认完整的启停列表')
      for (const change of plan.changes) await this.configure(scope, change.id, enabled, config, confirmed)
      return
    }
    id = this.adapter(id).id
    const adapter = this.adapter(id)
    if (!applyingPlan) {
      const plan = await this.plan(scope, id, enabled ? 'on' : 'off')
      if (plan.missing.length) throw new Error(`缺少依赖，无法启用：${plan.missing.join('、')}`)
      if (plan.dependencies.length) throw new Error(`需要先${enabled ? '启用' : '关闭'}依赖组件：${plan.dependencies.map(change => change.name).join('、')}；请通过菜单确认`)
    }
    if (isClientScope(scope)) {
      if (this.pluginIsolation) await this.manage(id)
      if (!adapter.bundle.enabled) {
        if (!enabled) return
        this.checkChange(await this.ctx.pluginManager.setBundleEnabled(adapter.package, true))
        await this.refresh()
      }
      for (const entry of this.entries(id)) {
        const normalized = enabled
          ? await this.normalize(id, config) : undefined
        this.checkChange(await this.ctx.pluginManager.setPluginEnabled(entry.id as never, enabled))
        // 原生客户端实例由 DSH 管理；只有已复用的配置表会从这里保存配置。
        if (normalized && JSON.stringify(normalized) !== JSON.stringify(await this.normalize(id, entry.options.config ?? {}))) {
          // 开关会重新读取 profile；配置也走持久化编辑，不能只改当前内存入口。
          await this.ctx.configEditor.edit(this.entries(id).find(current => current.id === entry.id)!, () => config)
        }
      }
      await this.services.get(id)?.refresh()
      return
    }
    const previous = this.store.get(scope, id)
    if (enabled && !previous?.enabled && !adapter.selfCompatible && !confirmed) {
      throw new Error('该插件尚未声明自兼容性，请确认后再启用')
    }
    const definition = await this.definition(id)
    if ((definition as Plugin.Object).apply === this.ctx.fiber.runtime?.callback) {
      throw new Error('分级菜单不能在自身管理的作用域内再次加载自己')
    }
    await this.normalize(id, config)
    if (scope.children) {
      if (!this.store.children(scope).independent) throw new Error('请先切换为独立下级设置')
      this.store.set(scope, id, { enabled, config })
      return
    }
    await this.manage(id)
    this.store.set(scope, id, { enabled, config })
    try {
      if (enabled) await this.instance(scope, id)?.plugin.update(config)
      await this.sync()
      await this.services.get(id)?.refresh()
    } catch (error) {
      if (previous) this.store.set(scope, id, previous)
      else this.store.remove(scope, id)
      const failed = this.instance(scope, id)
      if (failed) {
        this.instances.get(scopeKey(scope))!.delete(id)
        await disposeFiber(failed.owner)
      }
      await this.sync()
      await this.services.get(id)?.refresh()
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        throw new Error(`端口已被占用（EADDRINUSE），已恢复原配置。${(error as Error).message}`, { cause: error })
      }
      throw error
    }
  }

  async inherit(scope: Scope, id: string, applyingPlan = false): Promise<void> {
    if (isClientScope(scope)) throw new Error('客户端没有上级配置')
    if (!applyingPlan) {
      const plan = await this.plan(scope, id, 'inherit')
      if (plan.missing.length || plan.dependencies.length) throw new Error('继承会改变组件依赖，请通过菜单确认完整的启停列表')
    }
    const targets = this.targets(id)
    if (targets.length > 1) { for (const target of targets) await this.inherit(scope, target.id, applyingPlan); return }
    this.store.remove(scope, id)
    if (scope.children) return
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
    const sessions = new Set([...this.ctx.agents.list().map(agent => String(agent.id)), ...this.resuming.keys()])
    const scopes: Scope[] = [
      ...this.ctx.workspaceRegistry.list().map(w => ({ level: 'workspace' as const, id: String(w.id) })),
      ...[...sessions].map(id => ({ level: 'session' as const, id })),
    ].sort((a, b) => this.chain(a).length - this.chain(b).length)
    await this.relinkRealms(scopes)
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
      await disposeFiber(instance.owner)
      if (!instances.size) this.instances.delete(key)
    }
    for (const broker of this.services.values()) {
      broker.refreshTools()
      await broker.refreshCommands()
    }
  }

  private realm(scope: Scope, packageName?: string): Record<string, symbol> {
    let labels = this.ctx[Context.isolate]
    const privatePackage = this.pluginIsolation && packageName
    for (const candidate of (privatePackage ? this.chain(scope) : this.chain(scope).slice(0, -1)).reverse()) {
      const key = scopeKey(candidate) + (privatePackage ? `/${packageName}` : '')
      const current = this.realms.get(key) ?? Object.create(labels)
      Object.setPrototypeOf(current, labels)
      this.realms.set(key, current)
      labels = current
    }
    if (privatePackage) {
      const own = [...this.plugins.values()].filter(plugin => plugin.package === packageName)
      for (const plugin of own) for (const name of this.declarations.get(plugin.id)?.provides ?? []) {
        if (!Object.hasOwn(labels, name)) labels[name] = Symbol(name)
      }
    }
    return labels
  }

  /** Explicit service dependencies cross package boundaries; unrelated providers stay private. */
  private connectDependencies(scopes: Scope[]): void {
    const candidatesFor = (scope: Scope, name: string) => [...this.plugins.values()].filter(candidate => {
      if (!this.managed.has(candidate.id)) return false
      if (!this.declarations.get(candidate.id)?.provides.has(name)) return false
      const source = this.source(scope, candidate.id)
      return source.level === 'client' ? this.clientEnabled(candidate.id) : this.store.get(source, candidate.id)?.enabled
    })
    for (const scope of scopes) for (const plugin of this.plugins.values()) {
      const labels = this.realm(scope, plugin.package)
      const declaration = this.declarations.get(plugin.id)
      for (const name of declaration?.requires ?? []) {
        if (declaration?.provides.has(name)) continue
        const candidates = candidatesFor(scope, name)
        const siblings = candidates.filter(candidate => candidate.package === plugin.package)
        const providers = siblings.length ? siblings : candidates
        if (providers.length !== 1) continue
        const provider = providers[0]!
        labels[name] = this.realm(this.source(scope, provider.id), provider.package)[name]!
      }
    }
    // Native host components may explicitly depend on a third-party service.
    // Export only unambiguous dependencies; unrelated package services remain private.
    const entries = new Set([...this.plugins.values()].flatMap(plugin => this.entries(plugin.id)))
    const required = new Set<string>()
    for (const runtime of this.ctx.registry.values()) for (const fiber of runtime.fibers) {
      const entry = fiber.ctx.fiber.entry
      if (entry && (entries.has(entry) || entry.parent.tree === this.runtime)) continue
      for (const name of Object.keys(fiber.inject)) required.add(name)
    }
    const labels = this.ctx.root[Context.isolate]
    for (const name of required) {
      const candidates = candidatesFor(clientScope, name)
      if (candidates.length !== 1) continue
      if (!this.hostLabels.has(name)) this.hostLabels.set(name, Object.getOwnPropertyDescriptor(labels, name))
      labels[name] = this.realm(clientScope, candidates[0]!.package)[name]!
    }
  }

  private async withResumingSession<T>(id: string, resume: () => Promise<T>): Promise<T> {
    if (this.ctx.agents.get(SessionId(id))) return resume()
    this.resuming.set(id, (this.resuming.get(id) ?? 0) + 1)
    try {
      // A session's own preset must exist before DSH resolves its stored preset ID.
      await this.sync()
      return await resume()
    } finally {
      const remaining = this.resuming.get(id)! - 1
      if (remaining) this.resuming.set(id, remaining)
      else this.resuming.delete(id)
      await this.sync()
    }
  }

  private async relinkRealms(scopes: Scope[]): Promise<void> {
    const before = new Map<Fiber, Record<string, symbol>>()
    for (const runtime of this.ctx.registry.values()) for (const fiber of runtime.fibers) {
      before.set(fiber, Object.fromEntries(Object.keys(fiber.inject).map(name => [name, fiber.ctx[Context.isolate][name]!])))
    }
    for (const scope of scopes) {
      this.realm(scope)
      if (this.pluginIsolation) for (const plugin of this.plugins.values()) this.realm(scope, plugin.package)
    }
    if (this.pluginIsolation) this.connectDependencies([clientScope, ...scopes])
    const changed = new Map<Fiber, string[]>()
    for (const [fiber, labels] of before) {
      const names = Object.keys(labels).filter(name => labels[name] !== fiber.ctx[Context.isolate][name])
      if (names.length) changed.set(fiber, names)
    }
    this.ctx.reflect.notify([...new Set([...changed.values()].flat())], (ctx, name) => changed.get(ctx.fiber)?.includes(name) ?? false)
    await Promise.all([...changed.keys()].map(fiber => fiber.await()))
  }

  private mountPresets(ctx: Context, scope: Scope, id: string): void {
    ctx.effect(() => this.ctx.inject(['agentPresets'], () => {
      const facade = this.presets!.facade(ctx, { scope, applies: view => this.applies(scope, id, view) })
      return ctx.provide('agentPresets', facade)
    }).dispose)
  }

  private async mount(scope: Scope, adapter: InstalledPlugin, config: PluginConfig): Promise<void> {
    let isolated = isolateProvidedServices(this.ctx, this.realm(scope, adapter.package))
    for (const service of [...scopedServiceNames, 'settings', 'typert', 'agentPresets']) isolated = isolated.isolate(service)
    const route = { accepts: (sessionId: string) => this.accepts(scope, adapter.id, sessionId) }
    isolated = isolated.extend({ [routing]: route })
    const owner = await isolated.plugin(async (ctx: Context) => {
      ctx.provide('settings', { configure: () => () => {} })
      await ctx.plugin(TypertRegistry)
    })
    this.mountPresets(owner.ctx, scope, adapter.id)
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
      const original = this.entry(adapter.id)
      const tree = original?.parent.tree ?? this.ctx.loader
      const entry = await this.runtime.mount(owner.ctx, encodeURIComponent(`${scopeKey(scope)}/${adapter.id}`),
        { ...adapter.options, config }, name => this.modules.load(tree, name, `${scopeKey(scope)}/${adapter.package}`, adapter.peers))
      plugin = entry.fiber!
      const error = (await Promise.all(failures)).find(Boolean)
      if (error) throw error
    } catch (error) {
      await disposeFiber(owner)
      throw error
    } finally { unwatch() }
    const instances = this.instances.get(scopeKey(scope)) ?? new Map<string, Instance>()
    instances.set(adapter.id, { scope, owner, plugin })
    this.instances.set(scopeKey(scope), instances)
  }

  releaseSession(sessionId: string): Promise<void> {
    const release = async () => {
      const key = scopeKey({ level: 'session', id: sessionId })
      const instances = this.instances.get(key)
      this.instances.delete(key)
      for (const instance of instances?.values() ?? []) await disposeFiber(instance.owner)
      for (const broker of this.services.values()) broker.releaseTools(sessionId)
    }
    // agent/disposed is a notification; the next resume must wait for this cleanup.
    this.syncing = this.syncing.then(release, release)
    return this.syncing
  }

  async call(scope: Scope, id: string, namespace: string, method: string, args: PluginConfig, peer: PeerScope, signal: AbortSignal) {
    id = this.adapter(id).id
    scope = ownScope(scope)
    const source = this.source(scope, id)
    const context = source.level === 'client' ? this.entry(id)?.fiber?.ctx : this.instance(source, id)?.plugin.ctx
    if (!context) throw new Error('此作用域没有运行中的插件实例')
    // The host Gateway keeps its authorization/validation, using this instance's descriptors.
    const invocation = context.extend({ typert: context.get('typert') as Context['typert'] })
    return invocation.get('typertGateway')!.invoke({ namespace, method, args, peer, signal })
  }

  async dispose(): Promise<void> {
    this.stopped = true
    for (const restore of this.pendingEntries) restore()
    for (const instances of this.instances.values()) for (const instance of instances.values()) await disposeFiber(instance.owner)
    this.instances.clear()
    const errors: unknown[] = []
    const clients = this.clientOwners.map(client => ({ ...client,
      running: !!client.entry.fiber?.uid, disabled: client.entry.options.disabled ?? null }))
    // Release private clients before restoring the native labels and registrations.
    for (const { entry, running } of clients) {
      try { if (running) await entry.update({ disabled: true }) }
      catch (error) { errors.push(error) }
    }
    for (const [name, original] of this.hostLabels) {
      if (original) Object.defineProperty(this.ctx.root[Context.isolate], name, original)
      else delete this.ctx.root[Context.isolate][name]
    }
    for (const { entry, owner, isolation, restore, running, disabled } of clients) {
      try {
        restore?.()
        entry.ctx[Context.isolate] = isolation
        // 菜单单独卸载时，把客户端入口交回 DSH；应用退出无需重启入口。
        if (this.ctx.root.fiber.state === 2 && running) { await entry.update({ disabled }); await entry.fiber?.await() }
        else entry.options.disabled = disabled
      } catch (error) { errors.push(error) } finally { await disposeFiber(owner) }
    }
    this.clientOwners = []
    this.presets?.dispose()
    this.modules.dispose()
    if (errors.length) throw new AggregateError(errors, '部分客户端插件恢复失败')
  }
}
