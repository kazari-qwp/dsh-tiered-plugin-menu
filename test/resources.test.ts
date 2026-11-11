import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import * as filesystem from '@deepseek-ai/dsh-skill-filesystem'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as menu from '../src/index.ts'
import { childScope, clientScope, type Scope } from '../src/shared.ts'
import { resourceHarness as harness } from './resources-harness.ts'
import { ConfigStore } from '../src/store.ts'
import { resourceName } from '../src/resource-names.ts'
import { ScopedServices, scopedServiceNames } from '../src/scoped-services.ts'
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry'

const session = (agent: Agent): Scope => ({ level: 'session', id: agent.id })
const config = (label: string) => ({ serverName: 'fixture', transport: 'stdio', command: process.execPath,
  args: [resolve('test/fixtures/mcp-server.mjs')], env: { TIERED_TEST_LABEL: label }, failOnStartupError: true, reconnect: { enabled: false } })

for (const isolation of [false, true]) test(`MCP: native discovery, independent connections, inherited tools/resources, defaults and restart (isolation ${isolation})`, { timeout: 60000 }, async () => {
  const { ctx, workspace, create, dataFile } = await harness()
  try {
    await ctx.loader.root.update([{ id: 'mcp-fixture', name: '@deepseek-ai/dsh-mcp-client', config: config('CLIENT') }])
    await ctx.loader.await()
    const one = await workspace('one'), two = await workspace('two')
    const a = await create('mcp-a', one.path), b = await create('mcp-b', one.path), c = await create('mcp-c', two.path)
    new ConfigStore(dataFile).setPluginIsolation(isolation)
    const fiber = await ctx.plugin(menu, { dataFile })
    let managed = true
    let manager = ctx.tieredPlugins
    const id = (await manager.rows(clientScope)).find(row => row.kind === 'mcp')!.id
    const ws: Scope = { level: 'workspace', id: one.id }
    const call = async (agent: Agent) => {
      const tools = await ctx.tools.resolve({ agent, modelSelection: { provider: 'test', model: 'test' }, signal: AbortSignal.timeout(5000) })
      try {
        const tool = tools.view(agent).get(isolation && managed ? resourceName(id, 'mcp__fixture__echo') : 'mcp__fixture__echo')
        return tool && await tool.execute({}, { agent, signal: AbortSignal.timeout(5000) } as never)
      } finally { tools.dispose() }
    }
    const read = (agent: Agent) => ctx.tools.get('read_mcp_resource', agent)!.execute({ server: isolation ? resourceName(id, 'fixture') : 'fixture', uri: 'fixture://label' }, { agent, signal: AbortSignal.timeout(5000) } as never)
    await manager.configure(ws, id, true, config('WORKSPACE'), true)
    await manager.configure(session(a), id, true, config('SESSION'), true)
    assert.match(JSON.stringify(await call(a)), /SESSION/)
    assert.match(JSON.stringify(await call(b)), /WORKSPACE/)
    assert.match(JSON.stringify(await call(c)), /CLIENT/)
    assert.match(JSON.stringify(await read(a)), /SESSION/)
    assert.match(JSON.stringify(await read(b)), /WORKSPACE/)
    assert.match(JSON.stringify(await read(c)), /CLIENT/)
    const prompt = async (agent: Agent) => JSON.stringify(await ctx.systemPrompt.assemble({ scope: agent }))
    assert.match(await prompt(a), /Only SESSION instructions/)
    assert.doesNotMatch(await prompt(a), /Only (CLIENT|WORKSPACE) instructions/)
    assert.match(await prompt(b), /Only WORKSPACE instructions/)
    await manager.configure(session(a), id, false, config('SESSION'), true)
    assert.equal(await call(a), undefined)
    assert.equal(ctx.tools.get('read_mcp_resource', a), undefined)
    assert.doesNotMatch(await prompt(a), /Only (SESSION|CLIENT|WORKSPACE) instructions/)
    assert.match(JSON.stringify(await call(b)), /WORKSPACE/)
    await manager.inherit(session(a), id)
    assert.match(JSON.stringify(await call(a)), /WORKSPACE/)
    const original = manager.instance(ws, id)
    assert.equal(manager.instance(session(a), id), undefined, 'inherited workspace connection is shared')
    assert.ok(original)
    manager.setChildSettings(ws, true)
    await manager.configure(childScope(ws), id, true, config('DEFAULT'), true)
    const d = await create('mcp-new', one.path)
    assert.match(JSON.stringify(await call(d)), /DEFAULT/)
    manager.setChildSettings(session(d), true)
    await manager.configure(childScope(session(d)), id, true, config('SUBAGENT'), true)
    const sub = await create('mcp-child', one.path, d), grandchild = await create('mcp-grandchild', one.path, sub)
    assert.match(JSON.stringify(await call(grandchild)), /SUBAGENT/)
    await fiber.restart(); manager = ctx.tieredPlugins
    assert.match(JSON.stringify(await call(b)), /WORKSPACE/)
    assert.match(JSON.stringify(await call(grandchild)), /SUBAGENT/)
    await manager.configure(clientScope, id, false, config('SAVED WHILE OFF'), true)
    const offRow = (await manager.rows(clientScope)).find(row => row.id === id)!
    assert.equal(offRow.enabled, false)
    assert.equal((offRow.config.env as Record<string, string>).TIERED_TEST_LABEL, 'SAVED WHILE OFF')
    await manager.configure(clientScope, id, true, config('CLIENT'), true)
    await fiber.dispose()
    managed = false
    assert.match(JSON.stringify(await call(a)), /CLIENT/, 'menu disposal restores the native MCP connection')
  } finally { await ctx.fiber.dispose() }
})

test('menu-owned HTTP MCP: headers differ per session, failed startup rolls back, reload persists', { timeout: 60000 }, async () => {
  const { ctx, workspace, create, dataFile } = await harness()
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return }
    const parts: Buffer[] = []; for await (const part of req) parts.push(part)
    const request = JSON.parse(Buffer.concat(parts).toString())
    if (request.id === undefined) { res.writeHead(202).end(); return }
    const result = request.method === 'initialize' ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'http-fixture', version: '1' } }
      : request.method === 'tools/list' ? { tools: [{ name: 'identity', description: 'configured header', inputSchema: { type: 'object' } }] }
      : { content: [{ type: 'text', text: req.headers['x-fixture-label'] ?? 'NONE' }] }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`
  try {
    const w = await workspace('http'), a = await create('http-a', w.path), b = await create('http-b', w.path)
    const fiber = await ctx.plugin(menu, { dataFile })
    let manager = ctx.tieredPlugins
    const base = { transport: 'streamable-http', serverName: 'http', url, headers: { 'X-Fixture-Label': 'CLIENT' }, failOnStartupError: true, reconnect: { enabled: false } }
    const id = await manager.addMcp(clientScope, base)
    await manager.configure(session(a), id, true, { ...base, headers: { 'X-Fixture-Label': 'SESSION' } }, true)
    const call = (agent: Agent) => ctx.tools.get('mcp__http__identity', agent)!.execute({}, { agent, signal: AbortSignal.timeout(5000) } as never)
    assert.match(JSON.stringify(await call(a)), /SESSION/)
    assert.match(JSON.stringify(await call(b)), /CLIENT/)
    await assert.rejects(manager.configure(session(a), id, true, { ...base, url: 'invalid-url' }, true))
    assert.match(JSON.stringify(await call(a)), /SESSION/)
    const count = (await manager.rows(clientScope)).length
    await assert.rejects(manager.addMcp(clientScope, { ...base, url: 'invalid-url' }))
    assert.equal((await manager.rows(clientScope)).length, count)
    await fiber.restart(); manager = ctx.tieredPlugins
    assert.match(JSON.stringify(await call(a)), /SESSION/)
    assert.match(JSON.stringify(await call(b)), /CLIENT/)
    await fiber.dispose()
    assert.equal(ctx.tools.get('mcp__http__identity', b), undefined)
  } finally { await ctx.fiber.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('filesystem and registered skills: edits, disables, invocation policy, tree/defaults and restart', { timeout: 30000 }, async () => {
  const { ctx, directory, workspace, create, dataFile } = await harness()
  try {
    const root = resolve(directory, 'skills'); mkdirSync(root)
    const file = resolve(root, 'local-review.md')
    const original = '---\nname: local-review\ndescription: Review fixture files\n---\nORIGINAL BODY'
    writeFileSync(file, original)
    await ctx.plugin(filesystem, { includeDefaultRoots: false, customSkillDirs: [root], watch: false })
    ctx.skills.register({ name: 'registered-helper', description: 'runtime skill', content: 'RUNTIME BODY', source: 'runtime' })
    const one = await workspace('one'), two = await workspace('two'), nested = await workspace('one/nested')
    const a = await create('skill-a', one.path), b = await create('skill-b', one.path), c = await create('skill-c', two.path), tree = await create('skill-tree', nested.path)
    const fiber = await ctx.plugin(menu, { dataFile })
    let manager = ctx.tieredPlugins
    const ws: Scope = { level: 'workspace', id: one.id }
    const get = (agent: Agent, name = 'local-review') => ctx.skills.get(name, { scope: agent, cwd: agent.session.header.cwd })
    assert.equal((await manager.skills.rows(ws)).length, 2)
    manager.skills.configure(ws, 'local-review', true, { content: 'WORKSPACE', description: 'workspace description' })
    manager.skills.configure(session(a), 'local-review', true, { content: 'SESSION', modelInvocable: false, userInvocable: true })
    assert.equal((await get(a))!.content, 'SESSION')
    assert.equal((await get(b))!.content, 'WORKSPACE')
    assert.equal((await get(c))!.content, 'ORIGINAL BODY')
    assert.equal((await get(tree))!.content, 'WORKSPACE')
    assert.equal((await ctx.skills.snapshot({ scope: a })).skills.find(s => s.name === 'local-review')!.invocation.modelInvocable, false)
    manager.skills.configure(session(a), 'registered-helper', false, {})
    assert.equal(await get(a, 'registered-helper'), undefined)
    assert.equal((await ctx.skills.list({ scope: a })).some(s => s.name === 'registered-helper'), false)
    assert.equal((await get(b, 'registered-helper'))!.content, 'RUNTIME BODY')
    manager.skills.inherit(session(a), 'local-review')
    assert.equal((await get(a))!.content, 'WORKSPACE')
    await manager.setWorkspaceTreeInheritance(false)
    assert.equal((await get(tree))!.content, 'ORIGINAL BODY')
    manager.setChildSettings(ws, true)
    manager.skills.configure(childScope(ws), 'local-review', true, { content: 'DEFAULT' })
    const d = await create('skill-new', one.path)
    assert.equal((await get(d))!.content, 'DEFAULT')
    manager.setChildSettings(session(d), true)
    manager.skills.configure(childScope(session(d)), 'local-review', true, { content: 'SUBAGENT' })
    const sub = await create('skill-child', one.path, d), grandchild = await create('skill-grandchild', one.path, sub)
    assert.equal((await get(grandchild))!.content, 'SUBAGENT')
    await fiber.restart(); manager = ctx.tieredPlugins
    assert.equal((await get(a))!.content, 'WORKSPACE')
    assert.equal((await get(grandchild))!.content, 'SUBAGENT')
    assert.equal(await get(a, 'registered-helper'), undefined)
    assert.equal(readFileSync(file, 'utf8'), original)
    await fiber.dispose()
    assert.equal((await get(a))!.content, 'ORIGINAL BODY')
    assert.equal((await get(a, 'registered-helper'))!.content, 'RUNTIME BODY')
  } finally { await ctx.fiber.dispose() }
})

test('workspace skill catalog includes scoped plugin registrations before an agent exists', async () => {
  const { ctx, workspace, dataFile } = await harness()
  try {
    const one = await workspace('one'), two = await workspace('two')
    const scope: Scope = { level: 'workspace', id: one.id }
    const broker = new ScopedServices(ctx)
    let isolated = ctx
    for (const name of scopedServiceNames) isolated = isolated.isolate(name)
    const owner = await broker.mount(isolated, { scope, accepts: () => false,
      applies: view => view.level === 'workspace' && view.id === one.id, configKey: () => '' })
    ;(owner.ctx.get('skills') as typeof ctx.skills).register({ name: 'workspace-skill', description: 'workspace provider', content: 'SCOPED BODY', source: 'runtime' })
    await ctx.plugin(menu, { dataFile })
    assert.equal((await ctx.tieredPlugins.skills.rows(scope))[0]?.id, 'workspace-skill')
    assert.equal((await ctx.tieredPlugins.skills.config(scope, 'workspace-skill')).content, 'SCOPED BODY')
    assert.deepEqual(await ctx.tieredPlugins.skills.rows({ level: 'workspace', id: two.id }), [])
    assert.deepEqual(await ctx.tieredPlugins.skills.rows(clientScope), [])
    assert.equal(ctx.agents.list().length, 0, 'catalog preview must not create a hidden agent')
  } finally { await ctx.fiber.dispose() }
})

test('client and workspace skill menus borrow the native default preset without creating an agent', async () => {
  const { ctx, directory, workspace, dataFile } = await harness()
  try {
    const w = await workspace('project')
    const user = resolve(directory, 'user')
    mkdirSync(resolve(w.path, '.git'))
    for (const dir of [resolve(w.path, '.dsh/skills'), resolve(user, 'skills')]) mkdirSync(dir, { recursive: true })
    const file = (name: string) => `---\nname: ${name}\ndescription: Preset filesystem\n---\n${name} body`
    writeFileSync(resolve(w.path, '.dsh/skills/project-skill.md'), file('project-skill'))
    writeFileSync(resolve(user, 'skills/user-skill.md'), file('user-skill'))
    ctx.loader.internal = { import: async () => filesystem } as never
    ctx.baseUrl = pathToFileURL(resolve('package.json')).href
    await ctx.plugin(AgentPresetRegistry, { default: 'standard' })
    await ctx.agentPresets.register({ id: 'standard', plugins: [{ id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem',
      config: { dshHome: user, agentsHome: resolve(directory, 'agents'), watch: false } }] })
    await ctx.plugin(menu, { dataFile })
    const manager = ctx.tieredPlugins, scope: Scope = { level: 'workspace', id: w.id }
    assert.ok((await manager.skills.rows(clientScope)).some(row => row.id === 'user-skill' && row.available))
    assert.ok((await manager.skills.rows(scope)).some(row => row.id === 'project-skill' && row.available))
    assert.equal((await manager.skills.config(scope, 'project-skill')).content, 'project-skill body')
    manager.skills.configure(scope, 'project-skill', true, { content: 'WORKSPACE OVERRIDE' })
    assert.equal((await manager.skills.config(scope, 'project-skill')).content, 'WORKSPACE OVERRIDE')
    assert.equal(ctx.agents.list().length, 0)
  } finally { await ctx.fiber.dispose() }
})
