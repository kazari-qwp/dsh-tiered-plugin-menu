import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createScope } from '@deepseek-ai/dsh-scope'
import { ScopedPresets } from '../packages/core/src/scoped-presets.ts'
import { isolateProvidedServices } from '../packages/core/src/isolation.ts'
import { clientScope, scopeKey, type Scope } from '../packages/core/src/shared.ts'
import { mountWorkspaces } from './workspaces.ts'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import * as menu from '../packages/core/src/index.ts'
import { SessionId } from '@deepseek-ai/dsh-session'

test('native Agent presets: same IDs, inherited lookup, concurrent composition and retained revisions', { timeout: 10000 }, async () => {
  const root = new Context()
  try {
    await mountAgentLoopTestDependencies(root)
    await mountWorkspaces(root)
    await root.plugin(Loader)
    root.provide('realmValue', 'GLOBAL SERVICE')
    root.loader.internal = { import: async () => ({ apply(ctx: Context, config: { marker: string }) {
      ctx.provide('presetValue', `${config.marker}/${ctx.get('realmValue')}`)
    } }) } as never
    await mountAgentLoopTestHarness(root)
    await root.plugin(AgentPresetRegistry, { default: 'shared' })
    const native = root.agentPresets
    const definition = (name: string) => ({ id: 'shared', name, plugins: [
      { id: 'marker', name: 'test-marker', isolate: { presetValue: true as const }, config: { marker: name } },
    ] })
    const removeGlobal = await native.register(definition('GLOBAL'))
    const a: Scope = { level: 'workspace', id: 'a' }
    const b: Scope = { level: 'workspace', id: 'b' }
    const chain = (scope: Scope): Scope[] => scope.level === 'client' ? [clientScope]
      : scope.level === 'session' ? [scope, scope.id.startsWith('a') ? a : b, clientScope] : [scope, clientScope]
    const realms = new Map<string, Context>()
    for (const scope of [a, b]) realms.set(scopeKey(scope), isolateProvidedServices(root, Object.create(root[Context.isolate])))
    realms.get(scopeKey(a))!.provide('realmValue', 'A SERVICE')
    realms.get(scopeKey(b))!.provide('realmValue', 'B SERVICE')
    const owner = await root.plugin(() => {})
    const router = new ScopedPresets(owner.ctx, chain, scope => realms.get(scopeKey(scope)) ?? root)
    const ctxA = realms.get(scopeKey(a))!.isolate('agentPresets')
    const ctxB = realms.get(scopeKey(b))!.isolate('agentPresets')
    for (const [ctx, scope] of [[ctxA, a], [ctxB, b]] as const) {
      ctx.provide('agentPresets', router.facade(ctx, { scope, applies: view => chain(view).some(item => scopeKey(item) === scopeKey(scope)) }) as any)
    }
    const removeA = await ctxA.agentPresets.register(definition('A'))
    const removeB = await ctxB.agentPresets.register(definition('B'))
    assert.equal((await native.list())[0]!.name, 'GLOBAL')
    assert.equal((await ctxA.agentPresets.list())[0]!.name, 'A')
    assert.equal((await ctxB.agentPresets.list())[0]!.name, 'B')
    await assert.rejects(ctxA.agentPresets.register({ id: 'shared', plugins: [] }), /Duplicate agent preset/)
    const [agentA, agentB] = [createScope(root, { id: 'agent-a' }), createScope(root, { id: 'b-agent' })]
    await Promise.all([native.mount(agentA.ctx, 'shared'), native.mount(agentB.ctx, 'shared')])
    assert.equal(native.composedPreset(agentA.ctx), 'shared')
    assert.equal(native.composedPreset(agentB.ctx), 'shared')
    const marker = (ctx: Context) => native.serviceFor({ ctx }, 'presetValue' as never)
    assert.equal(marker(agentA.ctx), 'A/A SERVICE')
    assert.equal(marker(agentB.ctx), 'B/B SERVICE')
    await removeA()
    assert.equal((await ctxA.agentPresets.list())[0]!.name, 'GLOBAL')
    assert.equal(native.composedPreset(agentA.ctx), 'shared', 'live Agents retain their native revision lease')
    const child = createScope(root, { id: 'a-child' })
    assert.equal(native.composeFrom(child.ctx, agentA.ctx), 'shared')
    const removeA2 = await ctxA.agentPresets.register(definition('A2'))
    await native.recompose(agentA.ctx, 'shared')
    assert.equal(marker(agentA.ctx), 'A2/A SERVICE')
    assert.equal(marker(child.ctx), 'A/A SERVICE')
    assert.equal(marker(agentB.ctx), 'B/B SERVICE')
    assert.equal((await ctxB.agentPresets.list())[0]!.name, 'B')
    await removeB(); await removeA2()
    await Promise.all([agentA.dispose(), agentB.dispose(), child.dispose()])
    await owner.dispose()
    router.dispose()
    assert.equal((await native.list())[0]!.name, 'GLOBAL')
    await removeGlobal()
  } finally { await root.fiber.dispose() }
})

test('menu restart and removal release local presets without removing the native preset', { timeout: 10000 }, async () => {
  mkdirSync('work', { recursive: true })
  const directory = resolve(mkdtempSync('work/preset-lifecycle-'))
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(directory + '/').href
  try {
    await mountAgentLoopTestDependencies(ctx)
    await mountWorkspaces(ctx)
    await ctx.plugin(Loader)
    await ctx.plugin(TypertRegistry)
    await mountAgentLoopTestHarness(ctx)
    await ctx.plugin(AgentPresetRegistry, { default: 'sample' })
    ctx.loader.import = async () => ({ inject: ['agentPresets'], async apply(child: Context, config: { name: string }) {
      const dispose = await child.agentPresets.register({ id: 'sample', name: config.name, plugins: [] })
      child.effect(() => async () => { await dispose(); await new Promise(resolve => setTimeout(resolve, 5)) })
    } })
    await ctx.loader.root.update([{ id: 'sample', name: 'sample', config: { name: 'GLOBAL' } }])
    await ctx.loader.await()
    ctx.provide('profileContext', { dir: directory, installAnchor: resolve(directory, 'package.json') } as any)
    ctx.provide('configEditor', { edit: async (entry: any, fn: any) => entry.update({ config: fn(entry.options.config ?? {}) }) } as any)
    ctx.provide('pluginManager', {
      listBundles: async () => [{ name: 'sample', installed: true, enabled: true, description: '',
        rows: [{ rowId: 'sample', moduleName: 'sample', entryId: 'sample' }] }],
      setPluginEnabled: async (id: string, enabled: boolean) => { await ctx.loader.resolve(id).update({ disabled: !enabled }); return {} },
    } as any)
    const workspace = await ctx.workspaceRegistry.create(directory)
    const scope: Scope = { level: 'workspace', id: workspace.id }
    const resumed = new Map<string, Awaited<ReturnType<typeof ctx.agents.create>>>()
    ctx.provide('sessionController', {
      create: async () => {},
      async resolveAgent(id: string) {
        await ctx.agentPresets.resolve('sample')
        const handle = await ctx.agents.create({ sessionId: SessionId(id), meta: { cwd: directory },
          setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'sample') } })
        resumed.set(id, handle)
        return { agent: handle.agent }
      },
    } as any)
    const fiber = await ctx.plugin(menu, { dataFile: resolve(directory, 'menu.json') })
    await ctx.tieredPlugins.configure(scope, 'sample', true, { name: 'LOCAL' }, true)
    const local = () => ctx.tieredPlugins.instance(scope, 'sample')!.plugin.ctx.agentPresets.list()
    assert.equal((await local())[0]!.name, 'LOCAL')
    assert.equal((await ctx.agentPresets.list())[0]!.name, 'GLOBAL')
    await ctx.tieredPlugins.configure(clientScope, 'sample', false, { name: 'GLOBAL' }, true)
    const agent = await ctx.agents.create({ sessionId: SessionId('direct-preset'), meta: { cwd: directory },
      setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'sample') } })
    assert.equal(ctx.agentPresets.composedPreset(agent.agent.ctx), 'sample')
    const session: Scope = { level: 'session', id: agent.agent.id }
    await ctx.tieredPlugins.configure(session, 'sample', true, { name: 'SESSION ONLY' }, true)
    const localOwner = ctx.tieredPlugins.instance(session, 'sample')!.owner
    const stopping = localOwner.dispose()
    await agent.dispose()
    assert.equal(ctx.tieredPlugins.instance(session, 'sample'), undefined)
    const controller = ctx.get('sessionController') as any
    await controller.resolveAgent(session.id)
    assert.equal(localOwner.inertia, undefined, 'resume waits even when another owner already started teardown')
    await stopping
    assert.equal((await ctx.tieredPlugins.instance(session, 'sample')!.plugin.ctx.agentPresets.list())[0]!.name, 'SESSION ONLY')
    await resumed.get(session.id)!.dispose()
    await assert.rejects(controller.resolveAgent('missing-session'), /Unknown agent preset/)
    assert.equal(ctx.tieredPlugins.instances.has('session:missing-session'), false)
    await ctx.tieredPlugins.configure(clientScope, 'sample', true, { name: 'GLOBAL' }, true)
    await fiber.restart()
    assert.equal((await local())[0]!.name, 'LOCAL')
    assert.equal((await ctx.agentPresets.list())[0]!.name, 'GLOBAL')
    await fiber.dispose()
    assert.deepEqual((await ctx.agentPresets.list()).map(item => item.name), ['GLOBAL'])
  } finally { await ctx.fiber.dispose() }
})
