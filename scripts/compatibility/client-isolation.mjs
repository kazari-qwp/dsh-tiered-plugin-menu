// Unmodified memory plugins, one shared Agent. Run only in the offline VM.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { resourceName } from '../../packages/core/src/resource-names.ts'

export async function clientIsolation(ctx, report, home, save) {
  report.clientIsolation = []
  const check = async (name, run) => {
    try { await run(); report.clientIsolation.push({ name, ok: true }) }
    catch (error) { report.clientIsolation.push({ name, ok: false, error: String(error.stack ?? error).slice(0, 1800) }) }
    save()
  }
  const cwd = path.join(home, 'same-session'); fs.mkdirSync(cwd)
  const workspace = await ctx.workspaceRegistry.create(cwd)
  const handle = await ctx.agents.create({ sessionId: 'same-session', meta: { cwd } })
  await workspace.attachSession(handle.agent.id)
  const agent = handle.agent
  const rows = await ctx.tieredPlugins.rows({ level: 'client', id: '' })
  const plugins = ['@fooxe/dsh-memory', 'meow-memory'].map(name => rows.find(row => row.package === name))
  const names = plugins.map(plugin => resourceName(plugin.id, 'memory_search'))
  const exec = { agent, signal: new AbortController().signal }
  await check('both conflicting memory tools register in the same session', async () => {
    for (const name of names) assert.ok(ctx.tools.get(name, agent), name)
    assert.notEqual(ctx.tools.get(names[0], agent).execute, ctx.tools.get(names[1], agent).execute)
    const admitted = await ctx.tools.resolve({ agent, modelSelection: { provider: 'test', model: 'test' }, signal: new AbortController().signal })
    try {
      const schemas = ctx.tools.schemas(agent, admitted)
      for (const name of names) {
        assert.ok(admitted.view(agent).has(name))
        assert.deepEqual(schemas.find(tool => tool.name === name).parameters, ctx.tools.get(name, agent).parameters)
      }
    } finally { admitted.dispose() }
  })
  await check('initialize the memory trust gate through its own registered command', async () => {
    const trust = ctx.commands.find(agent, resourceName(plugins[1].id, 'meow-trust'))
    assert.ok(trust)
    assert.equal((await trust.handler({ ...exec, rawInput: '', attachments: [] })).kind, 'success')
  })
  for (let i = 0; i < plugins.length; i++) await check(`execute empty-index search in ${plugins[i].package}`, async () => {
    const tool = ctx.tools.get(names[i], agent)
    const result = await tool.execute({ query: 'isolation-empty-index-probe' }, exec)
    assert.notEqual(result, undefined)
  })
  await check('session override disables only one of the conflicting tools', async () => {
    const scope = { level: 'session', id: agent.id }
    await ctx.tieredPlugins.configure(scope, plugins[0].id, false, {})
    const admitted = await ctx.tools.resolve({ ...exec, modelSelection: { provider: 'test', model: 'test' } })
    try {
      assert.equal(admitted.view(agent).has(names[0]), false)
      assert.ok(admitted.view(agent).has(names[1]))
    } finally { admitted.dispose() }
    await assert.rejects(async () => ctx.tools.get(names[0], agent).execute({ query: 'disabled' }, exec), /未启用/)
    assert.ok(ctx.tools.get(names[1], agent))
    await ctx.tieredPlugins.inherit(scope, plugins[0].id)
    assert.ok(ctx.tools.get(names[0], agent))
    assert.ok(ctx.tools.get(names[1], agent))
  })
  await handle.dispose()
}
