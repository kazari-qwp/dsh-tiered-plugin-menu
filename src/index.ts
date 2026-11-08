import { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import z from '@deepseek-ai/schemastery'
import { PluginManager } from './manager.ts'
import { ConfigStore } from './store.ts'
import { remoteContribution } from './remote-contract.ts'
import type { Scope, PluginConfig } from './shared.ts'

export { PluginManager } from './manager.ts'
export const inject = ['agents', 'loader', 'typert', 'workspaceRegistry', 'pluginManager', 'profileContext', 'configEditor']
export const Config = z.object({ dataFile: z.string().default(dshHomePath('plugins', 'tiered-plugin-menu.json')) })

declare module '@deepseek-ai/cordis' { interface Context { tieredPlugins: PluginManager } }

class MenuService extends TypertRemoteService {
  static inject = ['tieredPlugins']
  constructor(ctx: Context) { super(ctx, 'tieredPluginMenu') }
  context(sessionId: string | null) { return this.ctx.tieredPlugins.context(sessionId) }
  list(scope: Scope) { return this.ctx.tieredPlugins.rows(scope) }
  inherit(scope: Scope, id: string) { return this.ctx.tieredPlugins.inherit(scope, id) }
  async configure(scope: Scope, id: string, enabled: boolean, config: PluginConfig, confirmed = false) {
    await this.ctx.tieredPlugins.configure(scope, id, enabled, config, confirmed)
  }
  invoke(scope: Scope, sessionId: string | null, id: string, method: 'catalog' | 'preview', args: unknown[], signal: AbortSignal) {
    if (method !== 'catalog' && method !== 'preview') throw new Error('未知设置页方法')
    return this.ctx.tieredPlugins.invoke(scope, sessionId, id, method, args, signal)
  }
}

export async function apply(ctx: Context, config: { dataFile: string }): Promise<void> {
  const manager = new PluginManager(ctx, new ConfigStore(config.dataFile))
  ctx.provide('tieredPlugins', manager)
  ctx.effect(() => () => manager.dispose())
  ctx.on('agent/created', async () => { await manager.sync() })
  ctx.on('agent/disposed', async ({ agent }) => { await manager.releaseSession(String(agent.id)) })
  await manager.start()
  await ctx.plugin(MenuService)
  ctx.effect(() => ctx.typert.register({
    package: remoteContribution.package, face: 'host', schemas: [],
    model: { services: [], events: [], objects: [] }, invocations: remoteContribution.descriptors,
  }))
}
