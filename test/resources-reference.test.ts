import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as filesystem from '@deepseek-ai/dsh-skill-filesystem'
import * as menu from '../packages/core/src/index.ts'
import { clientScope, type Scope } from '../packages/core/src/shared.ts'
import { resourceHarness } from './resources-harness.ts'

const entry = (name: string) => resolve(`work/mcp-lab/node_modules/@modelcontextprotocol/server-${name}/dist/index.js`)

test('reference filesystem + memory MCP servers mixed with file skills and temporary messages', {
  timeout: 60000, skip: !existsSync(entry('filesystem')) || !existsSync(entry('memory')),
}, async () => {
  const { ctx, directory, workspace, create, dataFile } = await resourceHarness()
  try {
    await ctx.loader.root.update([{ id: 'temporary-messages', name: 'dsh-temporary-messages', config: { template: 'SANDBOX' } }])
    await ctx.loader.await()
    const w = await workspace('workspace'), a = await create('reference-a', w.path), b = await create('reference-b', w.path)
    const session = (agent: Agent): Scope => ({ level: 'session', id: agent.id })
    const aFiles = resolve(directory, 'files-a'), bFiles = resolve(directory, 'files-b'), skills = resolve(directory, 'skills')
    for (const dir of [aFiles, bFiles, skills]) mkdirSync(dir)
    writeFileSync(resolve(aFiles, 'hello.txt'), 'FILES-A')
    writeFileSync(resolve(bFiles, 'hello.txt'), 'FILES-B')
    for (const name of ['file-review', 'memory-notes', 'summary-format']) {
      writeFileSync(resolve(skills, `${name}.md`), `---\nname: ${name}\ndescription: Sandbox ${name}\n---\nUse only the fixture data.`)
    }
    await ctx.plugin(filesystem, { includeDefaultRoots: false, customSkillDirs: [skills], watch: false })
    const fiber = await ctx.plugin(menu, { dataFile })
    let manager = ctx.tieredPlugins
    const fsConfig = (dir: string) => ({ serverName: 'files', transport: 'stdio', command: process.execPath, args: [entry('filesystem'), dir], failOnStartupError: true, reconnect: { enabled: false } })
    const memoryConfig = (file: string) => ({ serverName: 'memory', transport: 'stdio', command: process.execPath, args: [entry('memory')],
      env: { MEMORY_FILE_PATH: resolve(directory, file) }, failOnStartupError: true, reconnect: { enabled: false } })
    const files = await manager.addMcp(clientScope, fsConfig(bFiles))
    const memory = await manager.addMcp(clientScope, memoryConfig('memory-b.jsonl'))
    await manager.configure(session(a), files, true, fsConfig(aFiles), true)
    await manager.configure(session(a), memory, true, memoryConfig('memory-a.jsonl'), true)
    manager.skills.configure(session(a), 'file-review', false, {})
    manager.skills.configure(session(b), 'memory-notes', true, { content: 'SESSION B NOTES' })
    await manager.configure(session(a), 'temporary-messages', true, { template: 'SESSION A TEMPORARY' }, true)
    const invoke = async (agent: Agent, name: string, args: object) => ctx.tools.get(name, agent)!.execute(args, { agent, signal: AbortSignal.timeout(5000) } as never)
    assert.match(JSON.stringify(await invoke(a, 'mcp__files__read_text_file', { path: resolve(aFiles, 'hello.txt') })), /FILES-A/)
    assert.match(JSON.stringify(await invoke(b, 'mcp__files__read_text_file', { path: resolve(bFiles, 'hello.txt') })), /FILES-B/)
    await assert.rejects(invoke(a, 'mcp__files__read_text_file', { path: resolve(bFiles, 'hello.txt') }), /Access denied/)
    for (const [agent, name] of [[a, 'Memory-A'], [b, 'Memory-B']] as const) await invoke(agent, 'mcp__memory__create_entities', {
      entities: [{ name, entityType: 'fixture', observations: ['sandbox observation'] }],
    })
    const graph = (agent: Agent) => invoke(agent, 'mcp__memory__read_graph', {})
    assert.match(JSON.stringify(await graph(a)), /Memory-A/)
    assert.doesNotMatch(JSON.stringify(await graph(a)), /Memory-B/)
    assert.match(JSON.stringify(await graph(b)), /Memory-B/)
    assert.doesNotMatch(JSON.stringify(await graph(b)), /Memory-A/)
    assert.equal(await ctx.skills.get('file-review', { scope: a }), undefined)
    assert.equal((await ctx.skills.get('memory-notes', { scope: b }))!.content, 'SESSION B NOTES')
    await manager.configure(session(a), files, false, fsConfig(aFiles), true)
    const resolved = await ctx.tools.resolve({ agent: a, modelSelection: { provider: 'test', model: 'test' }, signal: AbortSignal.timeout(5000) })
    assert.equal(resolved.view(a).has('mcp__files__read_text_file'), false)
    resolved.dispose()
    assert.match(JSON.stringify(await graph(a)), /Memory-A/)
    await fiber.restart(); manager = ctx.tieredPlugins
    assert.match(JSON.stringify(await graph(a)), /Memory-A/)
    assert.match(JSON.stringify(await graph(b)), /Memory-B/)
    assert.equal((await manager.rows(session(a))).find(row => row.package === 'dsh-temporary-messages')!.config.template, 'SESSION A TEMPORARY')
    assert.equal((await ctx.skills.list({ scope: a })).length, 2)
  } finally { await ctx.fiber.dispose() }
})
