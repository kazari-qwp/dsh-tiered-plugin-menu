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
import * as menu from '../packages/core/src/index.ts'
import { ConfigStore } from '../packages/core/src/store.ts'
import { childScope, clientScope, type Scope } from '../packages/core/src/shared.ts'
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
    await manager.configure(sessionScope('preconfigured'), id, true, { template: 'BEFORE FIRST MESSAGE' }, true)
    const preconfigured = await create('preconfigured', one.path)
    await send(preconfigured.agent, 'BEFORE FIRST MESSAGE')
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
    manager.skills.configure(childScope(sessionScope(a.agent.id)), 'parent-skill', false, {})
    manager.skills.configure(childScope(sessionScope(child.agent.id)), 'child-skill', false, {})
    assert.equal((await row(childScope(sessionScope(child.agent.id)))).config.template, 'CHILD', 'editing one default retains inherited defaults for other items')
    await defaults(sessionScope(child.agent.id), 'NEAREST')
    const next = await create('grandchild-next', one.path, child.agent)
    assert.equal(manager.store.get(sessionScope(next.agent.id), 'skill:parent-skill')?.enabled, false)
    assert.equal(manager.store.get(sessionScope(next.agent.id), 'skill:child-skill')?.enabled, false)
    manager.resetChildSettings(sessionScope(child.agent.id))
    const resetChild = await create('grandchild-reset', one.path, child.agent)
    await send(resetChild.agent, 'CHILD')
    assert.equal(manager.store.get(sessionScope(resetChild.agent.id), 'skill:child-skill'), undefined)
    assert.equal(manager.store.get(sessionScope(resetChild.agent.id), 'skill:parent-skill')?.enabled, false)
    await defaults(sessionScope(child.agent.id), 'NEAREST')
    const great = await create('great-grandchild', one.path, next.agent)
    await send(next.agent, 'NEAREST'); await send(great.agent, 'NEAREST')
    await send(grandchild.agent, 'CHILD')
    const sibling = await create('sibling', one.path, a.agent)
    await send(sibling.agent, 'CHILD')
    const fork = await create('ordinary-fork', one.path, undefined, a.agent)
    await send(fork.agent, 'SESSION B')

    manager.resetChildSettings(ws)
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
    await send(preconfigured.agent, 'BEFORE FIRST MESSAGE')
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
  for (const id of ['official', 'mcp:example', 'skill:example']) reloaded.set(childScope(parent), id, { enabled: false, config: {} })
  reloaded.resetChildren(parent)
  const reset = new ConfigStore(file)
  assert.deepEqual(reset.keys(childScope(parent)), [])
  assert.equal(reset.get(parent, 'sample')!.config.text, 'OLD')
  assert.equal(reset.get(second, 'sample')!.config.text, 'NEW')
  reset.set(childScope(parent), 'sample', { enabled: false, config: {} })
  assert.deepEqual(reset.keys(childScope(parent)), ['sample'], 'new edits never restore discarded overrides')
  reset.setChildren(parent, false)
  const legacy = new ConfigStore(file)
  legacy.set(childScope(parent), 'different', { enabled: true, config: {} })
  assert.deepEqual(legacy.keys(childScope(parent)), ['different'], 'editing old inherited defaults does not revive dormant settings')
})
