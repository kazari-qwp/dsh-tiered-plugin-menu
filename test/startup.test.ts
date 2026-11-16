import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as menu from '../packages/core/src/index.ts'
import { ConfigStore } from '../packages/core/src/store.ts'
import { clientScope, type PluginRow } from '../packages/core/src/shared.ts'
import { mountWorkspaces } from './workspaces.ts'
import { mountPluginManagement } from './plugins.ts'

async function harness() {
  const root = resolve(mkdtempSync('work/startup-'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'startup-test' }))
  for (const name of ['startup-good', 'startup-broken', 'startup-extra']) {
    const directory = join(root, 'node_modules', name); mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, type: 'module', main: 'index.js' }))
    writeFileSync(join(directory, 'index.js'), '')
  }
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx); await mountWorkspaces(ctx)
  await ctx.plugin(TypertRegistry); await ctx.plugin(RemoteAccess); await ctx.plugin(Gateway); await ctx.plugin(Loader)
  await mountAgentLoopTestHarness(ctx)
  mountPluginManagement(ctx, root)
  return { ctx, dataFile: join(root, 'menu.json') }
}

test('catalog is shared across repeated lists; native changes and an in-flight invalidation are visible', async () => {
  const { ctx, dataFile } = await harness()
  try {
    ctx.loader.import = async () => ({ apply() {} })
    await ctx.loader.root.update([{ id: 'startup-good', name: 'startup-good', config: { text: 'before' } }])
    const original = ctx.pluginManager.listBundles.bind(ctx.pluginManager)
    let calls = 0
    let gate: Promise<void> | undefined
    ctx.pluginManager.listBundles = async () => { calls++; const rows = await original(); await gate; return rows }
    await ctx.plugin(menu, { dataFile })
    const initial = calls
    await Promise.all(Array.from({ length: 20 }, () => ctx.tieredPlugins.rows(clientScope)))
    assert.equal(calls, initial)
    await ctx.loader.resolve('startup-good').update({ config: { text: 'after' } })
    assert.equal((await ctx.tieredPlugins.rows(clientScope))[0]!.config.text, 'after')
    const after = calls
    let release!: () => void
    gate = new Promise<void>(resolve => { release = resolve })
    ctx.emit('plugin-manager/changed', { reason: 'plugin' })
    const listing = ctx.tieredPlugins.rows(clientScope)
    await Promise.resolve(); await Promise.resolve()
    await ctx.loader.root.update([{ id: 'startup-good', name: 'startup-good' }, { id: 'startup-extra', name: 'startup-extra' }])
    release(); gate = undefined
    assert.deepEqual((await listing).map(r => r.id), ['startup-good', 'startup-extra'])
    assert.ok(calls >= after + 2, 'an invalidated in-flight catalog cannot become the current snapshot')
    await ctx.loader.root.update([{ id: 'startup-good', name: 'startup-good' }])
    assert.deepEqual((await ctx.tieredPlugins.rows(clientScope)).map(r => r.id), ['startup-good'])
  } finally { await ctx.fiber.dispose() }
})

test('cold startup contains a leaked native route and a failed child instance; menu RPC and healthy plugin remain usable', async () => {
  for (const failure of ['route', 'child']) {
    const { ctx, dataFile } = await harness()
    try {
      const paths = new Set<string>()
      class Server extends Service {
        constructor(ctx: Context) { super(ctx, 'webServer' as never) }
        register(route: { path: string }) {
          if (paths.has(route.path)) throw new Error(`duplicate prefix route ${route.path}`)
          paths.add(route.path); return () => paths.delete(route.path)
        }
      }
      await ctx.plugin(Server)
      ctx.loader.import = async name => name === 'startup-broken' ? {
        inject: failure === 'route' ? ['webServer'] : [],
        apply(child: Context, config: { fail?: boolean }) {
          if (failure === 'route') (child.get('webServer') as any).register({ path: '/api/leaked-route' })
          if (config.fail) throw new Error('child startup failed')
        },
      } : { apply() {} }
      await ctx.loader.root.update([
        { id: 'startup-broken', name: 'startup-broken', disabled: failure === 'child' },
        { id: 'startup-good', name: 'startup-good' },
      ])
      await ctx.agents.create({ sessionId: SessionId('startup-session') })
      const scope = { level: 'session' as const, id: 'startup-session' }
      const store = new ConfigStore(dataFile)
      store.set(scope, 'startup-broken', { enabled: failure === 'child', config: { fail: true } })
      store.set(scope, 'startup-good', { enabled: true, config: {} })
      await ctx.plugin(menu, { dataFile })
      const peer = new Peer(ctx, { principal: { kind: 'owner' }, interactions: 'none' })
      const list = () => ctx.typertGateway.invoke({ namespace: 'tieredPluginMenu', method: 'list', args: { scope }, peer, signal: AbortSignal.timeout(5000) }) as Promise<PluginRow[]>
      const rows = await list()
      assert.match(rows.find(row => row.id === 'startup-broken')!.error!, failure === 'route' ? /duplicate prefix/ : /child startup failed/)
      assert.equal(ctx.tieredPlugins.instance(scope, 'startup-broken'), undefined)
      assert.equal(ctx.tieredPlugins.instance(scope, 'startup-good')?.plugin.state, 2)
      await ctx.tieredPlugins.configure(scope, 'startup-good', false, {}, true)
      assert.equal((await list()).find(row => row.id === 'startup-good')!.enabled, false)
      if (failure === 'child') {
        await ctx.tieredPlugins.configure(scope, 'startup-broken', true, { fail: false }, true)
        assert.equal(ctx.tieredPlugins.instance(scope, 'startup-broken')?.plugin.state, 2)
        assert.equal((await list()).find(row => row.id === 'startup-broken')!.error, undefined)
      }
    } finally { await ctx.fiber.dispose() }
  }
})
