import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as menu from '../packages/core/src/index.ts'
import { clientScope, childScope, type Scope } from '../packages/core/src/shared.ts'
import { mountWorkspaces } from './workspaces.ts'
import { mountPluginManagement } from './plugins.ts'

test('menu directory isolation follows instance ownership and persists across disable, child defaults and restart', async () => {
  const lab = fs.mkdtempSync(path.resolve('work/directory-menu-'))
  const name = 'arbitrary-directory-plugin', pkg = path.join(lab, 'node_modules', name)
  fs.mkdirSync(pkg, { recursive: true })
  fs.writeFileSync(path.join(lab, 'package.json'), JSON.stringify({ name: 'test-profile', dependencies: { [name]: '*' } }))
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name, type: 'module', main: 'index.js', version: '1.0.0' }))
  fs.writeFileSync(path.join(pkg, 'index.js'), `
    import fs from 'node:fs';
    export function apply(ctx,config){
      fs.mkdirSync(config.arbitraryLocation,{recursive:true});
      const file=config.arbitraryLocation+'/value.txt';
      if(!fs.existsSync(file))fs.writeFileSync(file,'EMPTY');
      ctx.provide('directoryProbe',{get:()=>fs.readFileSync(file,'utf8'),set:value=>fs.writeFileSync(file,value),
        logical:()=>fs.realpathSync(config.arbitraryLocation)});
    }
  `)
  const location = path.join(lab, 'data'), config = { arbitraryLocation: location }
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(path.join(lab, 'cordis.yml')).href
  try {
    await mountAgentLoopTestDependencies(ctx)
    await mountWorkspaces(ctx)
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(Loader)
    await ctx.loader.root.update([{ id: name, name, config }]); await ctx.loader.await()
    mountPluginManagement(ctx, lab)
    await mountAgentLoopTestHarness(ctx)
    const workspace = await ctx.workspaceRegistry.create(lab)
    const ws: Scope = { level: 'workspace', id: workspace.id }
    const a = await ctx.agents.create({ sessionId: SessionId('A'), meta: { cwd: lab } })
    const session: Scope = { level: 'session', id: a.agent.id }
    const fiber = await ctx.plugin(menu, { dataFile: path.join(lab, 'menu.json') })
    const probe = (scope: Scope) => ctx.tieredPlugins.instance(scope, name)!.plugin.ctx.get('directoryProbe') as any
    ;(ctx.get('directoryProbe') as any).set('CLIENT')
    await ctx.tieredPlugins.configure(ws, name, true, config, true)
    probe(ws).set('WORKSPACE')
    assert.deepEqual((await ctx.tieredPlugins.rows(session))[0]!.source, ws)
    assert.equal(ctx.tieredPlugins.instance(session, name), undefined)
    await ctx.tieredPlugins.configure(session, name, true, config, true)
    assert.equal(probe(session).get(), 'EMPTY')
    probe(session).set('SESSION')
    assert.equal(probe(ws).get(), 'WORKSPACE')
    assert.equal(probe(session).logical(), location)
    assert.deepEqual((await ctx.tieredPlugins.rows(session))[0]!.config, config)
    assert.equal(fs.readFileSync(path.join(location, 'value.txt'), 'utf8'), 'CLIENT')
    await ctx.tieredPlugins.configure(session, name, false, config)
    await ctx.tieredPlugins.configure(session, name, true, config, true)
    assert.equal(probe(session).get(), 'SESSION')
    ctx.tieredPlugins.setChildSettings(ws, true)
    await ctx.tieredPlugins.configure(childScope(ws), name, true, config, true)
    const b = await ctx.agents.create({ sessionId: SessionId('B'), meta: { cwd: lab } })
    const second: Scope = { level: 'session', id: b.agent.id }
    assert.equal(probe(second).get(), 'EMPTY')
    probe(second).set('CHILD')
    await fiber.restart(); await ctx.loader.await()
    assert.equal(probe(session).get(), 'SESSION')
    assert.equal(probe(second).get(), 'CHILD')
    assert.equal(probe(ws).get(), 'WORKSPACE')
    await ctx.tieredPlugins.inherit(session, name)
    assert.deepEqual((await ctx.tieredPlugins.rows(session))[0]!.source, ws)
    assert.equal(probe(ws).get(), 'WORKSPACE')
    assert.equal((await ctx.tieredPlugins.rows(clientScope))[0]!.config.arbitraryLocation, location)
  } finally { await ctx.fiber.dispose() }
})
