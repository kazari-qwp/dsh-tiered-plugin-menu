import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as menu from '../src/index.ts'
import { mountWorkspaces } from './workspaces.ts'
import { mountPluginManagement } from './plugins.ts'

test('different plugins keep same-name tool schemas, executors and lifecycle separate across workspaces', async () => {
  const lab = resolve(mkdtempSync('work/tool-scopes-'))
  const names = ['lookup-one', 'lookup-two']
  for (const name of names) {
    const directory = join(lab, 'node_modules', name)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js' }))
    writeFileSync(join(directory, 'index.js'), '')
  }
  writeFileSync(join(lab, 'package.json'), JSON.stringify({ name: 'test-profile', dependencies: Object.fromEntries(names.map(name => [name, '*'])) }))
  const definitions = new Map<string, ToolDefinition>()
  const plugins = Object.fromEntries(names.map(name => [name, { inject: ['tools'], apply(ctx: Context, config: { field: string }) {
    const definition: ToolDefinition = {
      name: 'shared_lookup', description: `${name}:${config.field}`,
      parameters: { type: 'object', properties: { [config.field]: { type: 'string' } }, required: [config.field] },
      output: { schema: { type: 'string' }, render: (_, value) => [{ type: 'text', text: `${name}:${value}` }] },
      execute: async args => `${name}:${(args as Record<string, string>)[config.field]}`,
    }
    definitions.set(`${name}:${config.field}`, definition)
    ctx.tools.register(definition, { when: ({ agent }) => agent.id !== 'blocked' })
  } }]))
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await mountWorkspaces(ctx)
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(Loader)
    ctx.loader.import = async name => plugins[name]!
    await ctx.loader.root.update(names.map(name => ({ id: name, name, disabled: true })))
    mountPluginManagement(ctx, lab)
    await mountAgentLoopTestHarness(ctx)
    const aPath = join(lab, 'a'), bPath = join(lab, 'b')
    mkdirSync(aPath); mkdirSync(bPath)
    const aWorkspace = await ctx.workspaceRegistry.create(aPath), bWorkspace = await ctx.workspaceRegistry.create(bPath)
    const a = await ctx.agents.create({ sessionId: SessionId('A'), meta: { cwd: aPath } })
    const b = await ctx.agents.create({ sessionId: SessionId('B'), meta: { cwd: bPath } })
    const off = await ctx.agents.create({ sessionId: SessionId('OFF') })
    const menuFiber = await ctx.plugin(menu, { dataFile: join(lab, 'menu.json') })
    const wa = { level: 'workspace' as const, id: String(aWorkspace.id) }
    const wb = { level: 'workspace' as const, id: String(bWorkspace.id) }
    await ctx.tieredPlugins.configure(wa, names[0]!, true, { field: 'alpha' }, true)
    await ctx.tieredPlugins.configure(wb, names[1]!, true, { field: 'beta' }, true)
    const tool = (agent: typeof a.agent) => ctx.tools.get('shared_lookup', agent)!
    assert.equal(tool(a.agent), definitions.get('lookup-one:alpha'))
    assert.equal(tool(b.agent), definitions.get('lookup-two:beta'))
    assert.equal(ctx.tools.get('shared_lookup'), undefined)
    assert.equal(tool(off.agent), undefined)
    assert.deepEqual(ctx.tools.schemas(a.agent).find(t => t.name === 'shared_lookup')?.parameters, tool(a.agent).parameters)
    assert.deepEqual(ctx.tools.schemas(b.agent).find(t => t.name === 'shared_lookup')?.parameters, tool(b.agent).parameters)
    assert.equal(await tool(a.agent).execute({ alpha: 'A' }, { agent: a.agent } as never), 'lookup-one:A')
    assert.equal(await tool(b.agent).execute({ beta: 'B' }, { agent: b.agent } as never), 'lookup-two:B')
    assert.deepEqual(tool(b.agent).output.render({}, 'B'), [{ type: 'text', text: 'lookup-two:B' }])
    const resolveTools = (agent: typeof a.agent) => ctx.tools.resolve({ agent, modelSelection: { provider: 'test', model: 'test' }, signal: new AbortController().signal })
    const admittedA = await resolveTools(a.agent), admittedB = await resolveTools(b.agent)
    await ctx.tieredPlugins.configure(wa, names[0]!, true, { field: 'changed' }, true)
    assert.equal(tool(a.agent), definitions.get('lookup-one:changed'))
    assert.equal(admittedA.view(a.agent).has('shared_lookup'), false)
    assert.equal(admittedB.view(b.agent).has('shared_lookup'), true)
    admittedA.dispose(); admittedB.dispose()
    const later = await ctx.agents.create({ sessionId: SessionId('later'), meta: { cwd: aPath } })
    assert.equal(tool(later.agent), tool(a.agent))
    const blocked = await ctx.agents.create({ sessionId: SessionId('blocked'), meta: { cwd: aPath } })
    const blockedSet = await resolveTools(blocked.agent)
    assert.equal(blockedSet.view(blocked.agent).has('shared_lookup'), false)
    blockedSet.dispose()
    await later.dispose()
    await ctx.tieredPlugins.sync()
    assert.equal(tool(later.agent), undefined)
    await ctx.tieredPlugins.configure({ level: 'session', id: a.agent.id }, names[0]!, false, {})
    assert.equal(tool(a.agent), undefined)
    assert.equal(await tool(b.agent).execute({ beta: 'B' }, { agent: b.agent } as never), 'lookup-two:B')
    const sa = { level: 'session' as const, id: a.agent.id }
    await ctx.tieredPlugins.configure(sa, names[1]!, true, { field: 'local' }, true)
    assert.equal(await tool(a.agent).execute({ local: 'A' }, { agent: a.agent } as never), 'lookup-two:A')
    assert.equal(tool(b.agent).description, 'lookup-two:beta')
    await ctx.tieredPlugins.configure(sa, names[1]!, false, {})
    await menuFiber.restart()
    assert.equal(tool(a.agent), undefined)
    assert.equal(tool(b.agent).description, 'lookup-two:beta')
    await menuFiber.dispose()
    assert.equal(tool(b.agent), undefined)
  } finally { await ctx.fiber.dispose() }
})
