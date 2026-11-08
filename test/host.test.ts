import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as temporary from 'dsh-temporary-messages'
import * as menu from '../src/index.ts'
import { ConfigStore } from '../src/store.ts'
import { clientScope, type Scope } from '../src/shared.ts'
import { mountWorkspaces } from './workspaces.ts'
import { mountPluginManagement } from './plugins.ts'

declare module '@deepseek-ai/dsh-llm' { interface MessageSourceMap { 'menu-test': { kind: 'menu-test' } } }

test('真实插件 + 原生工作区：共享实例、跨区隔离、逐层覆盖、取消覆盖和重新加载', { timeout: 20000 }, async () => {
  mkdirSync('work', { recursive: true })
  const root = resolve(mkdtempSync('work/host-'))
  const dataFile = resolve(root, 'config.json')
  const ctx = new Context()
  const requests: GenerateOptions[] = []
  const id = 'temporary-messages'
  const sessionScope = (id: string): Scope => ({ level: 'session', id })
  try {
    await mountAgentLoopTestDependencies(ctx)
    await mountWorkspaces(ctx)
    mkdirSync(resolve(root, 'one')); mkdirSync(resolve(root, 'two'))
    const one = await ctx.workspaceRegistry.create(resolve(root, 'one'), '工作区一')
    const two = await ctx.workspaceRegistry.create(resolve(root, 'two'), '工作区二')
    const ws1: Scope = { level: 'workspace', id: String(one.id) }
    const ws2: Scope = { level: 'workspace', id: String(two.id) }
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(Loader)
    ctx.loader.import = async () => temporary
    await ctx.loader.root.update([{ id, name: 'dsh-temporary-messages', config: { template: 'GLOBAL' } }])
    await ctx.loader.await()
    mountPluginManagement(ctx)
    ctx.llm.registerAdapter(['test'], new class extends LlmAdapter {
      async resolveModel(provider: string, model: string) { return { provider, id: model, name: model } }
      async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
        requests.push(request)
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'answer' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'answer' } }
        yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }())
    await mountAgentLoopTestHarness(ctx)
    const menuFiber = await ctx.plugin(menu, { dataFile })
    const manager = ctx.tieredPlugins
    await manager.configure(ws1, id, true, { template: 'ONE {{ session.id }}' }, true)
    await manager.configure(ws2, id, true, { template: 'TWO {{ session.id }}' }, true)
    // 和 DSH 的创建顺序一致：先创建 Agent，再归入工作区。
    const create = async (name: string, workspace?: typeof one) => {
      const handle = await ctx.agents.create({ sessionId: SessionId(name), meta: { cwd: workspace?.path },
        agentOptions: { provider: 'test', model: 'test' } })
      if (workspace) await workspace.attachSession(SessionId(name))
      return handle
    }
    const a = await create('A', one)
    const b = await create('B', one)
    const c = await create('C', two)
    const d = await create('D')
    const send = async (agent: typeof a.agent) => {
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'menu-test' } }))
      await agent.whenIdle()
    }
    const tail = (name: string) => requests.findLast(request => request.sessionId === name)!.messages.at(-1)!.content.at(-1)
    const expectTail = (name: string, text: string) => assert.deepEqual(tail(name), { type: 'text', text })
    const effectiveInstance = async (name: string) => manager.instance((await manager.rows(sessionScope(name)))[0]!.source, id)!
    const shared = await effectiveInstance('A')
    assert.equal(shared, await effectiveInstance('B'))
    assert.notEqual(shared.plugin.ctx.get('temporaryMessages'), (await effectiveInstance('C')).plugin.ctx.get('temporaryMessages'))
    await Promise.all([send(a.agent), send(b.agent), send(c.agent), send(d.agent)])
    expectTail('A', 'ONE A'); expectTail('B', 'ONE B'); expectTail('C', 'TWO C'); expectTail('D', 'GLOBAL')
    for (const request of requests) {
      const injected = request.messages.flatMap(message => message.content).filter(block =>
        block.type === 'text' && /^(ONE|TWO|GLOBAL)/.test(block.text))
      assert.equal(injected.length, 1, '每个请求只执行一个层级的插件')
    }

    await manager.configure(ws1, id, true, { template: 'ONE CHANGED {{ session.id }}' })
    await Promise.all([send(a.agent), send(b.agent), send(c.agent)])
    expectTail('A', 'ONE CHANGED A'); expectTail('B', 'ONE CHANGED B'); expectTail('C', 'TWO C')
    await manager.configure(sessionScope('A'), id, true, { template: 'SESSION A' }, true)
    const ownA = await effectiveInstance('A')
    assert.notEqual(ownA, shared)
    await Promise.all([send(a.agent), send(b.agent)])
    expectTail('A', 'SESSION A'); expectTail('B', 'ONE CHANGED B')

    const signal = new AbortController().signal
    assert.equal(await manager.invoke(ws1, 'B', id, 'preview', [null, '{{ session.id }} {{ 6 * 7 }}'], signal), 'B 42')
    const catalog = await manager.invoke(ws1, null, id, 'catalog', [], signal) as { sessions: string[] }
    assert.deepEqual(catalog.sessions.sort(), ['A', 'B'])
    await manager.configure(sessionScope('A'), id, false, { template: 'OFF' })
    assert.equal(ownA.owner.uid, null)
    await send(a.agent)
    assert.equal((tail('A') as { text: string }).text, 'hello')
    await manager.inherit(sessionScope('A'), id)
    assert.equal(await effectiveInstance('A'), shared)
    await send(a.agent)
    expectTail('A', 'ONE CHANGED A')

    await a.dispose()
    assert.ok(shared.owner.uid, '关闭同区的一个会话不能卸载共享实例')
    await send(b.agent)
    expectTail('B', 'ONE CHANGED B')
    await manager.configure(sessionScope('C'), id, true, { template: 'SESSION C' }, true)
    const oldC = await effectiveInstance('C')
    await c.dispose()
    assert.equal(oldC.owner.uid, null)
    const resumed = await create('C', two)
    assert.notEqual(await effectiveInstance('C'), oldC)
    await send(resumed.agent)
    expectTail('C', 'SESSION C')
    assert.equal(new ConfigStore(dataFile).get(ws1, id)!.config.template, 'ONE CHANGED {{ session.id }}')

    await menuFiber.restart()
    assert.equal(shared.owner.uid, null)
    await Promise.all([send(b.agent), send(resumed.agent)])
    expectTail('B', 'ONE CHANGED B'); expectTail('C', 'SESSION C')
    await ctx.tieredPlugins.configure(ws1, id, false, {})
    await send(b.agent)
    assert.equal((tail('B') as { text: string }).text, 'hello')
    await ctx.tieredPlugins.inherit(ws1, id)
    await send(b.agent)
    expectTail('B', 'GLOBAL')
    assert.equal((await ctx.tieredPlugins.rows(clientScope))[0]!.config.template, 'GLOBAL')

    await ctx.tieredPlugins.configure(sessionScope('E'), id, true, { template: 'SESSION E' }, true)
    await ctx.tieredPlugins.configure(sessionScope('F'), id, true, { template: 'SESSION F' }, true)
    const [e, f] = await Promise.all([create('E', one), create('F', one)])
    await Promise.all([send(e.agent), send(f.agent)])
    for (const name of ['E', 'F']) {
      const blocks = requests.findLast(request => request.sessionId === name)!.messages.flatMap(message => message.content)
      assert.equal(blocks.filter(block => block.type === 'text' && block.text === `SESSION ${name}`).length, 1,
        '同时恢复会话不能重复 apply 同一个会话插件')
    }
  } finally { await ctx.fiber.dispose() }
})
