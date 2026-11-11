import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmdirSync, writeFileSync } from 'node:fs'
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
import { mountWorkspaces } from './workspaces.ts'
import { mountPluginManagement } from './plugins.ts'

for (const ownership of ['registry', 'session-header']) {
test(`new-child defaults: workspaces, sessions, recursive subagents, inheritance and restart (${ownership})`, { timeout: 30000 }, async () => {
  mkdirSync('work', { recursive: true })
  const directory = resolve(mkdtempSync('work/child-defaults-'))
  const dataFile = resolve(directory, 'settings.json')
  const ctx = new Context()
  const id = 'temporary-messages'
  const sessionScope = (id: string): Scope => ({ level: 'session', id })
  const requests: GenerateOptions[] = []
  try {
    await mountAgentLoopTestDependencies(ctx)
    if (ownership === 'session-header') Object.defineProperty(ctx.agents, 'isOwnedBy', { value: undefined })
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
    const workspace = async (name: string) => {
      const path = resolve(directory, name)
      mkdirSync(path, { recursive: true })
      return ctx.workspaceRegistry.create(path)
    }
    const create = (name: string, cwd: string, parentAgent?: Agent, lineage?: Agent) => ctx.agents.create({
      sessionId: SessionId(name), parentAgent, meta: { cwd,
        ...(parentAgent ? { origin: 'subagent', parentSession: parentAgent.id } : lineage ? { parentSession: lineage.id } : {}) },
      agentOptions: { provider: 'test', model: 'test' },
    })
    const oldWorkspace = await workspace('old')
    const old = await create('old-session', oldWorkspace.path)
    const fiber = await ctx.plugin(menu, { dataFile })
    let manager = ctx.tieredPlugins
    const row = async (scope: Scope) => (await manager.rows(scope))[0]!
    const defaults = async (scope: Scope, template: string, enabled = true) => {
      manager.setChildSettings(scope, true)
      await manager.configure(childScope(scope), id, enabled, { template }, true)
    }
    const send = async (agent: Agent, text: string) => {
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'menu-test' } }))
      await agent.whenIdle()
      const request = requests.findLast(request => request.sessionId === agent.id)!
      assert.deepEqual(request.messages.at(-1)!.content.at(-1), { type: 'text', text })
    }
    assert.equal(manager.childSettings(clientScope).independent, false)
    await defaults(clientScope, 'NEW WORKSPACE')
    assert.equal(manager.instances.size, 0, 'editing defaults must not start a preview instance')
    const orphan = await ctx.agents.create({ sessionId: SessionId('no-workspace'), agentOptions: { provider: 'test', model: 'test' } })
    assert.equal((await row(sessionScope(orphan.agent.id))).config.template, 'NEW WORKSPACE', 'unassigned sessions are direct children of the client')
    await send(orphan.agent, 'NEW WORKSPACE')
    assert.equal((await row({ level: 'workspace', id: oldWorkspace.id })).config.template, 'GLOBAL')
    const one = await workspace('one')
    const ws: Scope = { level: 'workspace', id: one.id }
    assert.equal((await row(ws)).config.template, 'NEW WORKSPACE')
    await defaults(clientScope, 'LATER WORKSPACE')
    await ctx.workspaceRegistry.create(one.path)
    assert.equal((await row(ws)).config.template, 'NEW WORKSPACE', 'reopening a workspace is not creation')
    const two = await workspace('two')
    assert.equal((await row({ level: 'workspace', id: two.id })).config.template, 'LATER WORKSPACE')
    const before = await create('before-default', one.path)
    await defaults(ws, 'SESSION A')
    const a = await create('a', one.path)
    // The original DSH API has not attached this session yet; first model call already sees its defaults.
    await send(a.agent, 'SESSION A')
    assert.equal((await row(sessionScope(before.agent.id))).config.template, 'NEW WORKSPACE')
    await defaults(ws, 'SESSION B')
    const b = await create('b', one.path)
    assert.equal((await row(sessionScope(a.agent.id))).config.template, 'SESSION A')
    await send(b.agent, 'SESSION B')
    assert.notEqual(manager.instance(sessionScope(a.agent.id), id), manager.instance(sessionScope(b.agent.id), id))

    await defaults(sessionScope(a.agent.id), 'CHILD')
    const child = await create('child', one.path, a.agent)
    const grandchild = await create('grandchild', one.path, child.agent)
    await send(child.agent, 'CHILD'); await send(grandchild.agent, 'CHILD')
    assert.equal(manager.childSettings(sessionScope(child.agent.id)).independent, false)
    assert.deepEqual(manager.childSettings(sessionScope(child.agent.id)).source, sessionScope(a.agent.id))
    assert.notEqual(manager.instance(sessionScope(child.agent.id), id), manager.instance(sessionScope(grandchild.agent.id), id))
    await defaults(sessionScope(child.agent.id), 'NEAREST')
    const next = await create('grandchild-next', one.path, child.agent)
    const great = await create('great-grandchild', one.path, next.agent)
    await send(next.agent, 'NEAREST'); await send(great.agent, 'NEAREST')
    await send(grandchild.agent, 'CHILD')
    const sibling = await create('sibling', one.path, a.agent)
    await send(sibling.agent, 'CHILD')
    const fork = await create('ordinary-fork', one.path, undefined, a.agent)
    await send(fork.agent, 'SESSION B')

    manager.setChildSettings(ws, false)
    const inherited = await create('inherited', one.path)
    await send(inherited.agent, 'NEW WORKSPACE')
    assert.equal((await row(sessionScope(inherited.agent.id))).own, false)
    await defaults(ws, 'OFF', false)
    const off = await create('off', one.path)
    await send(off.agent, 'hello')
    await send(old.agent, 'GLOBAL')

    await defaults(ws, 'AFTER RESTART')
    await fiber.restart()
    manager = ctx.tieredPlugins
    await send(a.agent, 'SESSION A'); await send(child.agent, 'CHILD'); await send(off.agent, 'hello')
    const fresh = await create('after-restart', one.path)
    await send(fresh.agent, 'AFTER RESTART')
    const later = await create('great-after-restart', one.path, next.agent)
    await send(later.agent, 'NEAREST')
    await b.dispose()
    const restored = await create('b', one.path)
    await send(restored.agent, 'SESSION B')
    // A cold menu has never seen these IDs; replay sources must still skip defaults.
    const cold = new menu.PluginManager(ctx, new ConfigStore(resolve(directory, 'cold.json')))
    cold.setChildSettings(ws, true)
    cold.store.set(childScope(ws), id, { enabled: true, config: { template: 'MUST NOT APPLY' } })
    for (const [agent, source] of [[a.agent, 'resume'], [child.agent, 'clear'], [off.agent, 'compact']] as const) {
      await cold.agentCreated(agent, source)
      assert.equal(cold.store.get(sessionScope(agent.id), id), undefined)
    }
    rmdirSync(one.path)
    await fiber.restart()
    assert.equal((await ctx.tieredPlugins.rows(sessionScope(a.agent.id)))[0]!.config.template, 'SESSION A', 'a missing workspace directory must not break menu restart')
  } finally { await ctx.fiber.dispose() }
})
}

test('stored defaults migrate legacy configs and survive reload without sharing mutable config objects', () => {
  mkdirSync('work', { recursive: true })
  const file = resolve(mkdtempSync('work/default-store-'), 'settings.json')
  const parent: Scope = { level: 'session', id: 'parent' }
  const first: Scope = { level: 'session', id: 'first' }
  const second: Scope = { level: 'session', id: 'second' }
  writeFileSync(file, JSON.stringify({ 'session:parent': { sample: { enabled: true, config: { text: 'OLD' } } } }))
  const store = new ConfigStore(file)
  store.setChildren(parent, true)
  store.set(childScope(parent), 'sample', { enabled: true, config: { text: 'NEW' } })
  store.initialize(first, parent, store.children(parent).plugins)
  store.initialize(second, parent, store.children(parent).plugins)
  store.get(first, 'sample')!.config.text = 'EDIT'
  assert.equal(store.get(second, 'sample')!.config.text, 'NEW')
  assert.equal(store.get(childScope(parent), 'sample')!.config.text, 'NEW')
  const reloaded = new ConfigStore(file)
  assert.equal(reloaded.get(parent, 'sample')!.config.text, 'OLD')
  assert.equal(reloaded.get(second, 'sample')!.config.text, 'NEW')
  assert.equal(reloaded.children(parent).independent, true)
  assert.deepEqual(reloaded.parent(second), parent)
})
