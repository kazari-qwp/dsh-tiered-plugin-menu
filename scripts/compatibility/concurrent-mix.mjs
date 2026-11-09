import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { configFor } from './scoped-mix.mjs'
import { resourceName } from '../../src/resource-names.ts'

export async function concurrentMix(ctx, report, names, home, save) {
  report.concurrent = []
  const check = async (name, run) => {
    try { await run(); report.concurrent.push({ name, ok: true }) }
    catch (error) { report.concurrent.push({ name, ok: false, error: String(error.stack ?? error).slice(0, 1800) }) }
    save()
  }
  const workspace = async relative => {
    const directory = path.join(home, relative)
    fs.mkdirSync(directory, { recursive: true })
    return ctx.workspaceRegistry.create(directory)
  }
  const root = await workspace('projects'), nested = await workspace('projects/a/b'), other = await workspace('other'), outside = await workspace('outside')
  const scope = workspace => ({ level: 'workspace', id: String(workspace.id) })
  const handles = []
  for (const [id, workspace] of [['A', nested], ['B', other], ['S', nested], ['OFF',outside]]) {
    const handle = await ctx.agents.create({ sessionId: `concurrent-${id}`, meta: { cwd: workspace.path } })
    await workspace.attachSession(handle.agent.id)
    handles.push(handle)
  }
  const [a, b, sibling] = handles.map(handle => handle.agent)
  const session = agent => ({ level: 'session', id: agent.id })
  const client = { level: 'client', id: '' }
  const manager = () => ctx.tieredPlugins
  const rows = async selected => (await manager().rows(selected)).flatMap(row=>row.components ?? [row])
  const configured = []
  const named = (packageName, name) => process.argv.includes('--plugin-isolation')
    ? resourceName(configured.find(item => item.name === packageName).id, name) : name
  for (const name of names.filter(name=>name !== 'dsh-tiered-plugin-menu')) {
    const group = (await manager().rows(client)).find(row=>row.package===name)
    if (!group) { await check(`discover ${name}`, ()=>{throw Error('not discovered')}); continue }
    const components = group.components ?? [group]
    await check(`mount both workspaces ${name}`, async () => {
      for (const [selected, marker] of [[scope(root),'A'],[scope(other),'B']]) {
        const plan = await manager().plan(selected, group.id, 'on')
        assert.deepEqual(plan.missing, [])
        await manager().change(selected, group.id, 'on', plan.signature)
        const first = components[0]
        await manager().configure(selected, first.id, true, configFor(name, marker), true)
      }
      for (const component of components) {
        assert.ok(manager().instance(scope(root), component.id))
        assert.ok(manager().instance(scope(other), component.id))
        assert.notEqual(manager().instance(scope(root), component.id).plugin, manager().instance(scope(other), component.id).plugin)
      }
    })
    configured.push(...components.map(row=>({name,id:row.id})))
  }
  await check('all packages remain active together and nested workspaces inherit', async()=>{
    for (const [agent, expected] of [[a,scope(root)],[b,scope(other)],[sibling,scope(root)]]) {
      const selected = await rows(session(agent))
      for (const item of configured) {
        const row = selected.find(row=>row.id===item.id)
        assert.equal(row.active,true,item.name)
        assert.deepEqual(row.source,expected,item.name)
      }
    }
    assert.ok(ctx.clientModules.graph().entries.length)
  })
  await check('packaged and runtime skills load only in enabled sessions',async()=>{
    for(const agent of [a,b]) {
      const options = {scope:agent,cwd:agent.session.header.cwd}
      const listed = await ctx.skills.list(options)
      const packaged = listed.find(skill=>skill.provider===named('@changfenhuang/dsh-genui','dsh-genui'))
      assert.ok(packaged,'GenUI provider is visible')
      assert.ok((await ctx.skills.get(packaged.name,options))?.content.length)
      assert.ok((await ctx.skills.get(named('@dsh-external/dsh-normify','normify-gen'),options))?.content.length)
    }
    const off = handles[3].agent
    const disabled = await ctx.skills.list({scope:off,cwd:outside.path})
    assert.equal(disabled.some(skill=>skill.provider===named('@changfenhuang/dsh-genui','dsh-genui')||skill.name===named('@dsh-external/dsh-normify','normify-gen')),false)
    const genui = configured.find(item=>item.name==='@changfenhuang/dsh-genui')
    await manager().configure(session(a),genui.id,false,{})
    assert.equal((await ctx.skills.list({scope:a,cwd:nested.path})).some(skill=>skill.provider===named('@changfenhuang/dsh-genui','dsh-genui')),false)
    assert.equal((await ctx.skills.list({scope:b,cwd:other.path})).some(skill=>skill.provider===named('@changfenhuang/dsh-genui','dsh-genui')),true)
    await manager().inherit(session(a),genui.id)
  })
  const call = async (agent, name, args={}) => {
    const tool = ctx.tools.get(named('dsh-npm',name), agent)
    assert.ok(tool, `${name} is registered`)
    return tool.execute(args, { agent })
  }
  const npm = configured.find(item=>item.name==='dsh-npm')
  if (npm) {
    await check('real npm_config writes stay separate at the same logical path',async()=>{
      await call(a,'npm_config',{registry:'https://workspace-a.invalid/'})
      await call(b,'npm_config',{registry:'https://workspace-b.invalid/'})
      assert.equal((await call(a,'npm_status')).registry,'https://workspace-a.invalid/')
      assert.equal((await call(b,'npm_status')).registry,'https://workspace-b.invalid/')
      assert.equal((await call(sibling,'npm_status')).registry,'https://workspace-a.invalid/')
    })
    await check('independent session storage and inheritance restore',async()=>{
      await manager().configure(session(a),npm.id,true,{},true)
      assert.equal((await call(a,'npm_status')).registry,'https://registry.npmjs.org/')
      await call(a,'npm_config',{registry:'https://session-a.invalid/'})
      assert.equal((await call(sibling,'npm_status')).registry,'https://workspace-a.invalid/')
      await manager().inherit(session(a),npm.id)
      assert.equal((await call(a,'npm_status')).registry,'https://workspace-a.invalid/')
      await manager().configure(session(a),npm.id,true,{},true)
      assert.equal((await call(a,'npm_status')).registry,'https://session-a.invalid/')
    })
    await check('parent off keeps explicit session working',async()=>{
      await manager().configure(scope(root),npm.id,false,{})
      const selected = await rows(session(sibling))
      assert.equal(selected.find(row=>row.id===npm.id).enabled,false)
      assert.equal((await call(a,'npm_status')).registry,'https://session-a.invalid/')
      assert.equal((await call(b,'npm_status')).registry,'https://workspace-b.invalid/')
      await manager().configure(scope(root),npm.id,true,{},true)
    })
    await check('child defaults create fresh independent data',async()=>{
      manager().setChildSettings(scope(root),true)
      await manager().configure({...scope(root),children:true},npm.id,true,{},true)
      const handle = await ctx.agents.create({sessionId:'concurrent-new-child',meta:{cwd:root.path}})
      handles.push(handle)
      await root.attachSession(handle.agent.id)
      const selected = await rows(session(handle.agent))
      assert.equal(selected.find(row=>row.id===npm.id).own,true)
      assert.equal((await call(handle.agent,'npm_status')).registry,'https://registry.npmjs.org/')
    })
  }
  await check('menu disable and re-enable release and restore all lower instances',async()=>{
    const entry = [...ctx.loader.entries()].find(entry=>entry.options.id==='compat-menu')
    const previous = entry.fiber
    await entry.update({disabled:true}); await previous.await(); await ctx.loader.await()
    assert.equal(ctx.get('tieredPlugins'),undefined)
    if(npm)assert.equal(ctx.tools.get(named('dsh-npm','npm_status'),a),undefined)
    await entry.update({disabled:false}); await ctx.loader.await()
    if(npm){
      assert.equal((await call(a,'npm_status')).registry,'https://session-a.invalid/')
      assert.equal((await call(b,'npm_status')).registry,'https://workspace-b.invalid/')
    }
  })
  for (const handle of handles) await handle.dispose()
}
