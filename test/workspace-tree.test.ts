import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as temporary from 'dsh-temporary-messages'
import * as menu from '../src/index.ts'
import { ConfigStore } from '../src/store.ts'
import { childScope, clientScope, type Scope } from '../src/shared.ts'
import { parentWorkspace } from '../src/workspace-tree.ts'
import { mountWorkspaces } from './workspaces.ts'
import { mountPluginManagement } from './plugins.ts'

test('workspace paths follow the native tree boundaries on Windows and POSIX', () => {
  for (const [paths, parent] of [
    [['E:\\repo', 'E:/repo/work/', 'E:\\repo\\work\\task'], 1],
    [['/repo', '/repo-other', '/repo-other/task'], 1],
    [['/', '/repo-other', '/repo/task'], 0],
    [['E:\\Repo', 'E:\\repo-other', 'E:\\repo\\task'], undefined],
    [['\\\\server\\share\\', '\\\\server\\share\\work', '\\\\server\\share\\work\\task'], 1],
  ] as const) {
    const workspaces = paths.map((path, i) => ({ id: String(i), path }))
    assert.equal(parentWorkspace('2', workspaces)?.id, parent === undefined ? undefined : String(parent))
  }
})

test('deep workspace inheritance, live toggles, defaults, reparenting and restart', { timeout: 30000 }, async () => {
  mkdirSync('work', { recursive: true })
  const directory = resolve(mkdtempSync('work/workspace-tree-'))
  const dataFile = resolve(directory, 'settings.json')
  const ctx = new Context()
  const id = 'temporary-messages'
  const requests: GenerateOptions[] = []
  try {
    await mountAgentLoopTestDependencies(ctx)
    await mountWorkspaces(ctx)
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
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }())
    await mountAgentLoopTestHarness(ctx)
    const fiber = await ctx.plugin(menu, { dataFile })
    let manager = ctx.tieredPlugins
    const workspace = async (path: string) => {
      const cwd = resolve(directory, path)
      mkdirSync(cwd, { recursive: true })
      return ctx.workspaceRegistry.create(cwd)
    }
    const ws = (workspace: { id: string }): Scope => ({ level: 'workspace', id: workspace.id })
    const create = async (name: string, cwd: string) => (await ctx.agents.create({
      sessionId: SessionId(name), meta: { cwd }, agentOptions: { provider: 'test', model: 'test' },
    })).agent
    const send = async (agent: Agent, text: string) => {
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'menu-test' } }))
      await agent.whenIdle()
      assert.deepEqual(requests.findLast(request => request.sessionId === agent.id)!.messages.at(-1)!.content.at(-1), { type: 'text', text })
    }
    const root = await workspace('root')
    await manager.configure(ws(root), id, true, { template: 'ROOT' }, true)
    const deepest = await workspace('root/a/b/c/d/e/f')
    const agent = await create('deep', deepest.path)
    const other = await create('other', (await workspace('root-other')).path)
    await send(agent, 'ROOT'); await send(other, 'GLOBAL')
    for (const path of ['root/a', 'root/a/b', 'root/a/b/c', 'root/a/b/c/d', 'root/a/b/c/d/e']) await workspace(path)
    const middle = await workspace('root/a/b/c')
    await manager.configure(ws(middle), id, true, { template: 'MIDDLE' }, true)
    await send(agent, 'MIDDLE')
    assert.deepEqual((await manager.rows(ws(deepest)))[0]!.source, ws(middle))
    const instance = manager.instance(ws(middle), id)
    assert.equal(manager.instance(ws(deepest), id), undefined, 'inheritance shares the ancestor instance')
    await manager.setWorkspaceTreeInheritance(false)
    await send(agent, 'GLOBAL')
    assert.equal(manager.instance(ws(middle), id), instance, 'changing the tree does not restart explicit instances')
    assert.equal(new ConfigStore(dataFile).settings().inheritWorkspaceTree, false)
    await fiber.restart(); manager = ctx.tieredPlugins
    assert.equal(manager.settings().inheritWorkspaceTree, false)
    await send(agent, 'GLOBAL')
    await manager.setWorkspaceTreeInheritance(true)
    await send(agent, 'MIDDLE')
    await manager.configure(ws(middle), id, false, { template: 'OFF' }, true)
    await send(agent, 'hello')
    await manager.configure(ws(deepest), id, true, { template: 'LEAF' }, true)
    await send(agent, 'LEAF')
    await manager.inherit(ws(deepest), id)
    await send(agent, 'hello')
    await manager.inherit(ws(middle), id)
    await send(agent, 'ROOT')
    manager.setChildSettings(ws(middle), true)
    await manager.configure(childScope(ws(middle)), id, true, { template: 'NEW CHILD' }, true)
    const next = await workspace('root/a/b/c/next')
    assert.equal((await manager.rows(ws(next)))[0]!.own, true)
    const child = await create('new-child', next.path)
    await send(child, 'NEW CHILD'); await send(agent, 'ROOT')
    assert.deepEqual(manager.childSettings(ws(next)).source, ws(middle))
    const late = await workspace('root/a/b/c/next/more')
    assert.equal((await manager.rows(ws(late)))[0]!.config.template, 'NEW CHILD')
    await manager.configure(ws(middle), id, true, { template: 'MIDDLE AGAIN' }, true)
    manager.setChildSettings(ws(middle), false)
    const removedWorkspaceSession = await create('removed-workspace', middle.path)
    await send(agent, 'MIDDLE AGAIN')
    await ctx.workspaceRegistry.delete(middle.id)
    await send(agent, 'ROOT')
    await send(removedWorkspaceSession, 'GLOBAL')
    await send(child, 'NEW CHILD')
    await manager.configure(clientScope, id, false, {}, true)
    await send(agent, 'ROOT'); await send(other, 'hello')
    await fiber.restart(); manager = ctx.tieredPlugins
    await send(agent, 'ROOT'); await send(child, 'NEW CHILD')
    assert.equal(manager.settings().inheritWorkspaceTree, true)
  } finally { await ctx.fiber.dispose() }
})
