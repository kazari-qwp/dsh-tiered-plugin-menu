// Execute the unmodified memory packages only in the offline disposable VM.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

export async function toolScopes(ctx, report, home, save) {
  report.toolScopes = []
  const check = async (name, run) => {
    try { await run(); report.toolScopes.push({ name, ok: true }) }
    catch (error) { report.toolScopes.push({ name, ok: false, error: String(error.stack ?? error).slice(0, 1800) }) }
    save()
  }
  const workspace = async name => {
    const directory = path.join(home, name)
    fs.mkdirSync(directory)
    return ctx.workspaceRegistry.create(directory)
  }
  const wa = await workspace('a'), wb = await workspace('b'), outside = await workspace('outside')
  const handles = []
  const create = async (id, workspace) => {
    const handle = await ctx.agents.create({ sessionId: `tools-${id}`, meta: { cwd: workspace.path } })
    handles.push(handle)
    await workspace.attachSession(handle.agent.id)
    return handle.agent
  }
  const a = await create('A', wa), b = await create('B', wb), sibling = await create('sibling', wa), off = await create('OFF', outside)
  const scope = workspace => ({ level: 'workspace', id: String(workspace.id) })
  const session = agent => ({ level: 'session', id: agent.id })
  const manager = () => ctx.tieredPlugins
  const rows = await manager().rows({ level: 'client', id: '' })
  const first = rows.find(row => row.package === '@fooxe/dsh-memory')
  const second = rows.find(row => row.package === 'meow-memory')
  assert.ok(first && second)
  const tool = agent => ctx.tools.get('memory_search', agent)
  let one, two
  await check('same-name memory tools mount in different workspaces', async () => {
    await manager().configure(scope(wa), first.id, true, {}, true)
    one = tool(a)
    assert.ok(one)
    await manager().configure(scope(wb), second.id, true, {}, true)
    two = tool(b)
    assert.ok(two)
    assert.notEqual(one, two)
    assert.notEqual(one.execute, two.execute)
    assert.equal(tool(a), one)
    assert.equal(tool(sibling), one)
    assert.equal(tool(off), undefined)
    assert.equal(ctx.tools.get('memory_search'), undefined)
  })
  await check('model tool sets use each workspace definition and schema', async () => {
    for (const [agent, definition] of [[a, one], [b, two]]) {
      assert.ok(definition)
      const admitted = await ctx.tools.resolve({ agent, modelSelection: { provider: 'test', model: 'test' }, signal: new AbortController().signal })
      try {
        assert.ok(admitted.view(agent).has('memory_search'))
        assert.deepEqual(ctx.tools.schemas(agent, admitted).find(item => item.name === 'memory_search')?.parameters, definition.parameters)
        assert.equal(tool(agent).execute, definition.execute)
        assert.equal(tool(agent).output, definition.output)
      } finally { admitted.dispose() }
    }
  })
  await check('agents created later inherit their workspace tool', async () => {
    const later = await create('later', wa)
    assert.equal(tool(later), one)
  })
  await check('different sessions in one workspace can use the conflicting packages', async () => {
    await manager().configure(session(a), first.id, false, {})
    assert.equal(tool(a), undefined)
    await manager().configure(session(a), second.id, true, {}, true)
    assert.ok(tool(a))
    assert.notEqual(tool(a), one)
    assert.notEqual(tool(a), two)
    assert.equal(tool(sibling), one)
    assert.equal(tool(b), two)
  })
  await check('disabling one workspace leaves the other workspace and explicit session intact', async () => {
    const local = tool(a)
    await manager().configure(scope(wa), first.id, false, {})
    assert.equal(tool(sibling), undefined)
    assert.equal(tool(a), local)
    assert.equal(tool(b), two)
  })
  await check('menu disable and re-enable release and restore scoped tools', async () => {
    const entry = [...ctx.loader.entries()].find(entry => entry.options.name === 'dsh-tiered-plugin-menu')
    const previous = entry.fiber
    await entry.update({ disabled: true }); await previous.await(); await ctx.loader.await()
    for (const agent of [a, b, sibling, off]) assert.equal(tool(agent), undefined)
    await entry.update({ disabled: false }); await ctx.loader.await()
    assert.ok(tool(a)); assert.ok(tool(b))
    assert.notEqual(tool(a), tool(b))
    assert.equal(tool(sibling), undefined)
    assert.equal(tool(off), undefined)
    assert.equal(ctx.tools.get('memory_search'), undefined)
  })
  for (const handle of handles) await handle.dispose()
}
