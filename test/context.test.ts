import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as contextPlugin from 'dsh-context'
import * as menu from '../src/index.ts'
import { clientScope } from '../src/shared.ts'
import { mountWorkspaces } from './workspaces.ts'
import { mountPluginManagement } from './plugins.ts'
import { ConfigStore } from '../src/store.ts'
import { resourceName } from '../src/resource-names.ts'

for (const pluginIsolation of [false, true]) test(`原版 dsh-context：多层配置、统计、HTTP 和卸载恢复（隔离 ${pluginIsolation}）`, { timeout: 15000 }, async () => {
  mkdirSync('work', { recursive: true })
  const root = resolve(mkdtempSync('work/context-test-'))
  const ctx = new Context()
  const requests = new Map<string, any>()
  const errors: string[] = []
  ctx.on('internal/status', fiber => { if (fiber.state === 3) void fiber.await().catch(error => errors.push(error.message)) })
  try {
    await mountAgentLoopTestDependencies(ctx)
    ctx.provide('sessionQuery', { observeSession: async (id: string) => ({ events: ctx.sessions.get(SessionId(id))!.snapshotEvents() }) } as never)
    await mountWorkspaces(ctx)
    await ctx.plugin(TypertRegistry)
    await ctx.plugin((child: Context) => { new HostConnectionService(child, [], {} as any) })
    const workspaces = []
    for (const name of ['one', 'two', 'three']) { mkdirSync(resolve(root, name)); workspaces.push(await ctx.workspaceRegistry.create(resolve(root, name))) }
    await ctx.plugin(Loader)
    ctx.loader.import = async () => contextPlugin
    await ctx.loader.root.update([{ id: 'dsh-context', name: 'dsh-context', config: { promptPrefix: 'PREFIX_CLIENT', maxRequestSteps: 4 } }])
    await ctx.loader.await()
    mountPluginManagement(ctx)
    ctx.llm.registerAdapter(['test'], new class extends LlmAdapter {
      async resolveModel(provider: string, model: string) { return { provider, id: model, name: model } }
      async *stream(request: any): AsyncIterable<any> {
        requests.set(request.sessionId, request)
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'answer' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'answer' } }
        yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }())
    await mountAgentLoopTestHarness(ctx)
    const agents: import('@deepseek-ai/dsh-agent').Agent[] = []
    for (const [name, index] of [['A', 0], ['B', 0], ['C', 1], ['D', 2]] as const) {
      const workspace = workspaces[index]!
      const { agent } = await ctx.agents.create({ sessionId: SessionId(name), meta: { cwd: workspace.path }, agentOptions: { provider: 'test', model: 'test' } })
      await workspace.attachSession(SessionId(name)); agents.push(agent)
    }
    const dataFile = resolve(root, 'settings.json')
    new ConfigStore(dataFile).setPluginIsolation(pluginIsolation)
    let fiber = await ctx.plugin(menu, { dataFile })
    const manager = ctx.tieredPlugins
    const one = { level: 'workspace' as const, id: String(workspaces[0]!.id) }
    const two = { level: 'workspace' as const, id: String(workspaces[1]!.id) }
    const a = { level: 'session' as const, id: 'A' }
    await manager.configure(one, 'dsh-context', true, { promptPrefix: 'PREFIX_ONE', maxRequestSteps: 2 }, true)
    await manager.configure(two, 'dsh-context', true, { promptPrefix: 'PREFIX_TWO', maxRequestSteps: 3 }, true)
    await manager.configure(a, 'dsh-context', true, { promptPrefix: 'PREFIX_A', maxRequestSteps: 1 }, true)
    const round = async () => Promise.all(agents.map(async agent => {
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'probe' }], source: { kind: 'probe' } as any }))
      await agent.whenIdle()
    }))
    for (let i = 0; i < 5; i++) await round()
    const prompt = (id: string) => requests.get(id).messages.filter((m: any) => m.role === 'system')
      .flatMap((m: any) => m.content).map((b: any) => b.text ?? '').join('\n')
    for (const [id, prefix] of [['A', 'A'], ['B', 'ONE'], ['C', 'TWO'], ['D', 'CLIENT']]) {
      assert.deepEqual(prompt(id!).match(/PREFIX_\w+/g), [`PREFIX_${prefix}`])
    }
    const post = async (path: string, id: string) => {
      const row = (await ctx.tieredPlugins.rows({ level: 'session', id }))[0]!
      const url = (row.routePrefix ?? '') + '/api/dsh-context/' + path
      const route = (ctx.connection as any).fetchRoutes.get(url)
      const response = await route.fetch(new Request('http://localhost' + url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: id }),
      }))
      return response.json()
    }
    for (const [id, count] of [['A', 1], ['B', 2], ['C', 3], ['D', 4]] as const) {
      const detail = await post('detail', id)
      assert.equal(detail.ok, true, JSON.stringify(detail))
      assert.equal(detail.value.requests.length, count, id)
    }
    // 改配置必须采用新 fold，不能继续使用最早注册实例的闭包。
    const savedA = ctx.sessionProjections.checkpoint(agents[0]!.session)
    const savedB = ctx.sessionProjections.checkpoint(agents[1]!.session)
    await manager.configure(one, 'dsh-context', true, { promptPrefix: 'PREFIX_UPDATED', maxRequestSteps: 4 })
    assert.equal((await post('detail', 'B')).value.requests.length, 4)
    const projectionKey = pluginIsolation ? resourceName('dsh-context', 'contextTimeline') : 'contextTimeline'
    assert.ok(Reflect.get(ctx.sessionProjections.viewCheckpoint(savedA), projectionKey), '不相关作用域的缓存仍然可用')
    assert.equal(Reflect.get(ctx.sessionProjections.viewCheckpoint(savedB), projectionKey), undefined, '本层配置变化使旧缓存失效')
    await manager.configure(two, 'dsh-context', false, {})
    await manager.configure(clientScope, 'dsh-context', false, {})
    await round()
    assert.equal(prompt('C').includes('PREFIX_'), false)
    assert.equal(prompt('D').includes('PREFIX_'), false)
    assert.equal(Reflect.get(ctx.sessionProjections.snapshot(agents[2]!.session).values, projectionKey), null)
    assert.equal((await post('detail', 'C')).error.code, 'plugin-disabled')
    await manager.inherit(a, 'dsh-context')
    await round()
    assert.deepEqual(prompt('A').match(/PREFIX_\w+/g), ['PREFIX_UPDATED'])
    await manager.configure(a, 'dsh-context', true, { promptPrefix: 'PREFIX_A', maxRequestSteps: 1 }, true)
    const saved = readFileSync(dataFile, 'utf8')
    for (let cycle = 0; cycle < 2; cycle++) {
      const current = ctx.tieredPlugins
      const instances = [...current.instances.values()].flatMap(instances => [...instances.values()])
      await fiber.dispose()
      assert.ok(instances.every(instance => !instance.owner.uid && !instance.plugin.uid), '关闭菜单回收全部下级实例')
      assert.equal(current.instances.size, 0)
      assert.equal(ctx.get('tieredPlugins'), undefined)
      assert.equal((ctx.connection as any).fetchRoutes.has('/api/dsh-context/detail'), false, '全局未启用时，下级 HTTP 注册一起释放')
      assert.equal((ctx.connection as any).fetchRoutes.has('/api/__tiered/dsh-context/api/dsh-context/detail'), false)
      assert.equal(readFileSync(dataFile, 'utf8'), saved, '卸载不删除持久化配置')
      await round()
      for (const agent of agents) assert.equal(prompt(String(agent.id)).includes('PREFIX_'), false)
      fiber = await ctx.plugin(menu, { dataFile })
      await round()
      assert.deepEqual(prompt('A').match(/PREFIX_\w+/g), ['PREFIX_A'])
      assert.deepEqual(prompt('B').match(/PREFIX_\w+/g), ['PREFIX_UPDATED'])
      for (const id of ['C', 'D']) assert.equal(prompt(id).includes('PREFIX_'), false)
      assert.notEqual(ctx.tieredPlugins.instance(a, 'dsh-context'), instances.find(instance => instance.scope.id === 'A'))
    }
    // 菜单卸载后恢复原生客户端服务，不残留隔离注册。
    await ctx.tieredPlugins.configure(clientScope, 'dsh-context', true, { promptPrefix: 'PREFIX_RESTORED' })
    await fiber.dispose()
    await round()
    for (const agent of agents) assert.deepEqual(prompt(String(agent.id)).match(/PREFIX_\w+/g), ['PREFIX_RESTORED'])
    assert.deepEqual(errors, [])
  } finally { await ctx.fiber.dispose() }
})
