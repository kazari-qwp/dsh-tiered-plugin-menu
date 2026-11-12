import { Context, type Fiber } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import z from '@deepseek-ai/schemastery'
import { PluginManager } from './manager.ts'
import { ConfigStore } from './store.ts'
import { remoteContribution } from './remote-contract.ts'
import type { Scope, PluginConfig, ChangeMode } from './shared.ts'

export { PluginManager } from './manager.ts'
export { registrationOwner } from './routing.ts'
export type { RegistrationOwner } from './routing.ts'
export const name = 'tiered-plugin-core'
export const tieredManagerFrontend = true
export const inject = ['agents', 'sessions', 'loader', 'typert', 'workspaceRegistry', 'pluginManager', 'profileContext', 'configEditor']
export const Config = z.object({ dataFile: z.string() })

declare module '@deepseek-ai/cordis' { interface Context { tieredPlugins: PluginManager } }

class MenuService extends TypertRemoteService {
  static inject = ['tieredPlugins']
  constructor(ctx: Context) { super(ctx, 'tieredPluginMenu') }
  settings() { return this.ctx.tieredPlugins.settings() }
  setWorkspaceTreeInheritance(enabled: boolean) { return this.ctx.tieredPlugins.setWorkspaceTreeInheritance(enabled) }
  setPluginIsolation(enabled: boolean) { return this.ctx.tieredPlugins.setPluginIsolation(enabled) }
  context(sessionId: string | null) { return this.ctx.tieredPlugins.context(sessionId) }
  list(scope: Scope) { return this.ctx.tieredPlugins.rows(scope) }
  addMcp(scope: Scope, config: PluginConfig) { return this.ctx.tieredPlugins.addMcp(scope, config) }
  skills(scope: Scope) { return this.ctx.tieredPlugins.skills.rows(scope) }
  skillConfig(scope: Scope, name: string) { return this.ctx.tieredPlugins.skills.config(scope, name) }
  configureSkill(scope: Scope, name: string, enabled: boolean, config: PluginConfig) { return this.ctx.tieredPlugins.skills.configure(scope, name, enabled, config) }
  inheritSkill(scope: Scope, name: string) { return this.ctx.tieredPlugins.skills.inherit(scope, name) }
  childSettings(scope: Scope) { return this.ctx.tieredPlugins.childSettings(scope) }
  setChildSettings(scope: Scope, independent: boolean) { return this.ctx.tieredPlugins.setChildSettings(scope, independent) }
  plan(scope: Scope, id: string, mode: ChangeMode) { return this.ctx.tieredPlugins.plan(scope, id, mode) }
  change(scope: Scope, id: string, mode: ChangeMode, signature: string) { return this.ctx.tieredPlugins.change(scope, id, mode, signature) }
  call(scope: Scope, id: string, namespace: string, method: string, args: PluginConfig, signal: AbortSignal) {
    return this.ctx.tieredPlugins.call(scope, id, namespace, method, args, this.ctx.invocation!.peer, signal)
  }
  inherit(scope: Scope, id: string) { return this.ctx.tieredPlugins.inherit(scope, id) }
  async configure(scope: Scope, id: string, enabled: boolean, config: PluginConfig, confirmed = false) {
    await this.ctx.tieredPlugins.configure(scope, id, enabled, config, confirmed)
  }
}

async function mount(ctx: Context, config: { dataFile: string }): Promise<void> {
  const manager = new PluginManager(ctx, new ConfigStore(config.dataFile))
  ctx.provide('tieredPlugins', manager)
  ctx.effect(() => () => manager.dispose())
  ctx.on('agent/created', async ({ agent, source }) => { await manager.agentCreated(agent, source) })
  ctx.on('agent/disposed', async ({ agent }) => { await manager.releaseSession(String(agent.id)) })
  await manager.start()
  await ctx.plugin(MenuService)
  ctx.effect(() => ctx.typert.register({
    package: remoteContribution.package, face: 'host', schemas: [],
    model: { services: [], events: [], objects: [] }, invocations: remoteContribution.descriptors,
  }))
}

// All UI packages acquire the same host service. Closing one front end must
// not tear down the other front ends or their background session instances.
interface HostLease { users: number; dataFile: string; ready: Promise<Fiber>; closing?: Promise<void> }
// Compatible package copies may coexist after independent adapter updates.
const hostKey = Symbol.for('dsh-tiered-plugin-core.hosts.v1')
const globalHosts = globalThis as typeof globalThis & { [hostKey]?: WeakMap<Context, HostLease> }
const hosts = globalHosts[hostKey] ??= new WeakMap<Context, HostLease>()
export async function acquireCore(ctx: Context, config: { dataFile?: string } = {}): Promise<PluginManager> {
  return acquire(ctx, config, ctx.root)
}

async function acquire(ctx: Context, config: { dataFile?: string }, owner: Context): Promise<PluginManager> {
  const root = ctx.root
  let host = hosts.get(root)
  if (host?.closing) { await host.closing; return acquire(ctx, config, owner) }
  if (host && config.dataFile && config.dataFile !== host.dataFile) throw new Error('分级核心已经使用另一个配置文件')
  if (!host) {
    const dataFile = config.dataFile ?? dshHomePath('plugins', 'tiered-plugin-menu.json')
    host = { users: 0, dataFile, ready: Promise.resolve(owner.plugin({ inject, apply: mount }, { dataFile })) }
    hosts.set(root, host)
  }
  const lease = host
  lease.users++
  ctx.effect(() => () => {
    if (--lease.users) return
    lease.closing = (async () => {
      try {
        const fiber = await lease.ready
        await fiber.dispose()
        await fiber.await()
      } finally { hosts.delete(root) }
    })()
    return lease.closing
  })
  await lease.ready
  return root.get('tieredPlugins')!
}

export async function apply(ctx: Context, config: { dataFile?: string } = {}): Promise<void> {
  // A declared core entry owns its backend directly. Restricted UI hosts can
  // consume this service without asking a UI plugin to mutate the root.
  await acquire(ctx, config, ctx)
}
