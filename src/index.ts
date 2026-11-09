import { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import z from '@deepseek-ai/schemastery'
import { PluginManager } from './manager.ts'
import { ConfigStore } from './store.ts'
import { remoteContribution } from './remote-contract.ts'
import type { Scope, PluginConfig, ChangeMode } from './shared.ts'

export { PluginManager } from './manager.ts'
export const inject = ['agents', 'sessions', 'loader', 'typert', 'workspaceRegistry', 'pluginManager', 'profileContext', 'configEditor']
export const Config = z.object({ dataFile: z.string().default(dshHomePath('plugins', 'tiered-plugin-menu.json')) })

declare module '@deepseek-ai/cordis' { interface Context { tieredPlugins: PluginManager } }

class MenuService extends TypertRemoteService {
  static inject = ['tieredPlugins']
  constructor(ctx: Context) { super(ctx, 'tieredPluginMenu') }
  settings() { return this.ctx.tieredPlugins.settings() }
  setWorkspaceTreeInheritance(enabled: boolean) { return this.ctx.tieredPlugins.setWorkspaceTreeInheritance(enabled) }
  context(sessionId: string | null) { return this.ctx.tieredPlugins.context(sessionId) }
  list(scope: Scope) { return this.ctx.tieredPlugins.rows(scope) }
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

export async function apply(ctx: Context, config: { dataFile: string }): Promise<void> {
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
