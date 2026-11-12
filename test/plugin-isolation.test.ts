import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as menu from '../packages/core/src/index.ts'
import * as web from '../packages/web/src/index.ts'
import { ConfigStore } from '../packages/core/src/store.ts'
import { resourceName } from '../packages/core/src/resource-names.ts'
import { clientScope } from '../packages/core/src/shared.ts'
import { mountWorkspaces } from './workspaces.ts'
import { mountPluginManagement } from './plugins.ts'

test('experimental isolation lets conflicting client plugins run together in one session using shared lower-instance machinery', async () => {
  const lab = fs.mkdtempSync(path.resolve('work/plugin-isolation-'))
  const names = ['collision-alpha', 'collision-beta']
  for (const name of names) {
    const directory = path.join(lab, 'node_modules', name)
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, type: 'module', main: 'index.js', version: '1.0.0' }))
    fs.writeFileSync(path.join(directory, 'index.js'), `
      import fs from 'node:fs';
      export const inject=['tools','skills','systemPrompt'];
      export const provide='collisionState';
      export function apply(ctx,config){
        fs.mkdirSync(config.directory,{recursive:true});
        const file=config.directory+'/value.txt';
        if(!fs.existsSync(file))fs.writeFileSync(file,config.label);
        const state={label:config.label,get:()=>fs.readFileSync(file,'utf8'),set:value=>fs.writeFileSync(file,value)};
        ctx.provide('collisionState',state);
        ctx.inject(['collisionState'],child=>child.provide('collisionConsumer',child.get('collisionState')));
        ctx.systemPrompt.section({name:'collision_prompt',order:100,text:'Instruction '+config.label});
        ctx.skills.register({name:'collision-skill',description:config.label,content:'Skill '+config.label,source:'runtime'});
        ctx.tools.register({name:'collision_tool',description:config.label,
          parameters:{type:'object',properties:{[config.field]:{type:'string'}},required:[config.field]},
          output:{schema:{type:'string'},render:(_,value)=>[{type:'text',text:config.label+':'+value}]},
          execute:async args=>ctx.get('collisionState').label+':'+args[config.field]+':'+state.get()});
        ctx.provide('ownTool',ctx.tools.get('collision_tool'));
      }
    `)
  }
  fs.writeFileSync(path.join(lab, 'package.json'), JSON.stringify({ name: 'test-profile', dependencies: Object.fromEntries(names.map(name => [name, '*'])) }))
  const dataFile = path.join(lab, 'menu.json')
  const store = new ConfigStore(dataFile)
  assert.deepEqual(store.settings(), { inheritWorkspaceTree: true, pluginIsolation: false })
  store.setPluginIsolation(true)
  store.setWorkspaceTreeInheritance(false)
  assert.deepEqual(new ConfigStore(dataFile).settings(), { inheritWorkspaceTree: false, pluginIsolation: true })
  const config = (label: string, field: string) => ({ label, field, directory: path.join(lab, 'data') })
  const setup = async () => {
    const ctx = new Context()
    ctx.baseUrl = pathToFileURL(path.join(lab, 'cordis.yml')).href
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SkillRegistry)
    await mountWorkspaces(ctx)
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(Loader)
    await ctx.loader.root.update(names.map((name, i) => ({ id: name, name, disabled: true, config: config(name, i ? 'beta' : 'alpha') })))
    mountPluginManagement(ctx, lab)
    await mountAgentLoopTestHarness(ctx)
    return ctx
  }
  const native = await setup()
  try {
    const entries = [...native.loader.entries()]
    await entries[0]!.update({ disabled: false }); await entries[0]!.fiber?.await()
    await entries[1]!.update({ disabled: false })
    await assert.rejects(entries[1]!.fiber!.await(), /collisionState|collision_tool/)
  } finally { await native.fiber.dispose() }
  const original = fs.readFileSync(path.join(lab, 'data/value.txt'), 'utf8')
  const ctx = await setup()
  try {
    const agent = (await ctx.agents.create({ sessionId: SessionId('same-session') })).agent
    await ctx.plugin(menu, { dataFile })
    const manager = ctx.tieredPlugins
    const entries = [...ctx.loader.entries()]
    const aName = resourceName(names[0]!, 'collision_tool'), bName = resourceName(names[1]!, 'collision_tool')
    for (let i = 0; i < names.length; i++) await manager.configure(clientScope, names[i]!, true, config(names[i]!, i ? 'beta' : 'alpha'))
    const a = ctx.tools.get(aName, agent)!, b = ctx.tools.get(bName, agent)!
    assert.ok(a && b)
    assert.notEqual(a.name, b.name)
    assert.equal(ctx.tools.get('collision_tool', agent), undefined)
    assert.deepEqual(a.parameters.required, ['alpha'])
    assert.deepEqual(b.parameters.required, ['beta'])
    assert.equal(await a.execute({ alpha: 'A' }, { agent } as never), 'collision-alpha:A:collision-alpha')
    assert.equal(await b.execute({ beta: 'B' }, { agent } as never), 'collision-beta:B:collision-beta')
    assert.deepEqual(b.output.render({}, 'test'), [{ type: 'text', text: 'collision-beta:test' }])
    assert.equal(ctx.get('collisionState'), undefined)
    for (let i = 0; i < names.length; i++) {
      const own = entries[i]!.fiber!.ctx
      assert.equal((own.get('collisionState') as any).label, names[i])
      assert.equal(own.get('collisionConsumer'), own.get('collisionState'))
      assert.equal((own.get('ownTool') as any).name, 'collision_tool')
      assert.equal((await ctx.skills.get(resourceName(names[i]!, 'collision-skill'), { scope: agent }))?.content, `Skill ${names[i]}`)
      const skills = own.get('skills')!
      const listed = (await skills.list({ scope: agent })).find(skill => skill.description === names[i])!
      assert.equal((await skills.get(listed.name, { scope: agent }))?.content, `Skill ${names[i]}`, 'listed names can be passed back to get')
      assert.equal((await skills.get('collision-skill', { scope: agent }))?.content, `Skill ${names[i]}`, 'plugin-local names keep working too')
    }
    assert.equal(fs.readFileSync(path.join(lab, 'data/value.txt'), 'utf8'), original)
    const admitted = await ctx.tools.resolve({ agent, modelSelection: { provider: 'test', model: 'test' }, signal: new AbortController().signal })
    assert.ok(admitted.view(agent).has(aName) && admitted.view(agent).has(bName))
    admitted.dispose()
    const session = { level: 'session' as const, id: agent.id }
    await manager.configure(session, names[0]!, true, config('LOCAL', 'local'), true)
    assert.equal(await ctx.tools.get(aName, agent)!.execute({ local: 'L' }, { agent } as never), 'LOCAL:L:LOCAL')
    assert.equal(await ctx.tools.get(bName, agent)!.execute({ beta: 'B' }, { agent } as never), 'collision-beta:B:collision-beta')
    await manager.configure(clientScope, names[0]!, false, {})
    assert.equal(await ctx.tools.get(aName, agent)!.execute({ local: 'L' }, { agent } as never), 'LOCAL:L:LOCAL')
    await manager.configure(session, names[0]!, false, {})
    assert.equal(ctx.tools.get(aName, agent), undefined)
    assert.ok(ctx.tools.get(bName, agent))
    await manager.configure(clientScope, names[0]!, true, config('CHANGED', 'alpha'))
    await manager.inherit(session, names[0]!)
    assert.equal(await ctx.tools.get(aName, agent)!.execute({ alpha: 'A' }, { agent } as never), 'CHANGED:A:collision-alpha')
  } finally { await ctx.fiber.dispose() }
})

test('experimental isolation preserves explicit package dependencies, restart and later client installs', async () => {
  const lab = fs.mkdtempSync(path.resolve('work/plugin-dependencies-'))
  const packages = {
    'private-provider': `export const provide='sharedValue'; export function apply(ctx,config){ctx.provide('sharedValue',config.label)}`,
    'private-consumer': `export const inject=['sharedValue']; export const provide='received'; export function apply(ctx){ctx.provide('received',ctx.get('sharedValue'))}`,
    'later-plugin': `import z from '@deepseek-ai/schemastery'; export const Config=z.object({note:z.string().default('later'),rules:z.dict(z.string()).default({default:'rule'})}); Object.assign(Config.meta,{volatile:true}); export const inject=['tools']; export function apply(ctx,config){ctx.tools.register({name:'late_tool',description:'late',parameters:{type:'object',properties:{}},output:{schema:{type:'string'},render:()=>[]},execute:async()=>config.get().note})}`,
  }
  for (const [name, source] of Object.entries(packages)) {
    const directory = path.join(lab, 'node_modules', name)
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, type: 'module', main: 'index.js', version: '1.0.0' }))
    fs.writeFileSync(path.join(directory, 'index.js'), source)
  }
  fs.writeFileSync(path.join(lab, 'package.json'), JSON.stringify({ name: 'test-profile', dependencies: Object.fromEntries(Object.keys(packages).map(name => [name, '*'])) }))
  const dataFile = path.join(lab, 'menu.json')
  new ConfigStore(dataFile).setPluginIsolation(true)
  const ctx = new Context()
  try {
    ctx.baseUrl = pathToFileURL(path.join(lab, 'cordis.yml')).href
    await mountAgentLoopTestDependencies(ctx)
    await mountWorkspaces(ctx)
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(Loader)
    const options = [{ id: 'private-provider', name: 'private-provider', config: { label: 'CLIENT' } }, { id: 'private-consumer', name: 'private-consumer' }]
    await ctx.loader.root.update(options)
    mountPluginManagement(ctx, lab)
    await mountAgentLoopTestHarness(ctx)
    const observed: unknown[] = []
    await ctx.plugin({ inject: ['sharedValue'], apply(child: Context) { observed.push(child.get('sharedValue')) } })
    const agent = (await ctx.agents.create({ sessionId: SessionId('dependency-session') })).agent
    let menuFiber = await ctx.plugin(menu, { dataFile });
    const entry = (name: string) => [...ctx.loader.entries()].find(entry => entry.options.name === name)!
    assert.equal(entry('private-consumer').fiber!.ctx.get('received'), 'CLIENT')
    assert.equal(observed.at(-1), 'CLIENT', 'native host consumers retain declared dependencies')
    const session = { level: 'session' as const, id: agent.id }
    await ctx.tieredPlugins.configure(session, 'private-consumer', true, {}, true);
    assert.equal(ctx.tieredPlugins.instance(session, 'private-consumer')!.plugin.ctx.get('received'), 'CLIENT')
    await ctx.tieredPlugins.configure(session, 'private-provider', true, { label: 'LOCAL' }, true);
    assert.equal(ctx.tieredPlugins.instance(session, 'private-consumer')!.plugin.ctx.get('received'), 'LOCAL')
    assert.equal(entry('private-consumer').fiber!.ctx.get('received'), 'CLIENT')
    await ctx.tieredPlugins.inherit(session, 'private-provider')
    assert.equal(ctx.tieredPlugins.instance(session, 'private-consumer')!.plugin.ctx.get('received'), 'CLIENT')
    await menuFiber.dispose(); await menuFiber.await();
    assert.equal(ctx.get('sharedValue'), 'CLIENT')
    menuFiber = await ctx.plugin(menu, { dataFile });
    assert.equal(observed.at(-1), 'CLIENT')
    assert.equal(ctx.tieredPlugins.instance(session, 'private-consumer')!.plugin.ctx.get('received'), 'CLIENT')
    // Also cover installation through DSH itself, without a menu configure call.
    await ctx.loader.root.update([...options, { id: 'later-plugin', name: 'later-plugin' }])
    await entry('later-plugin').fiber!.await()
    const row = (await ctx.tieredPlugins.rows(clientScope)).find(row => row.id === 'later-plugin')!
    assert.deepEqual(row.config, { note: 'later', rules: { default: 'rule' } })
    await ctx.tieredPlugins.configure(clientScope, row.id, true, row.config)
    assert.equal(await ctx.tools.get(resourceName('later-plugin', 'late_tool'), agent)!.execute({}, { agent } as never), 'later')
    assert.equal(ctx.tools.get('late_tool', agent), undefined)
  } finally { await ctx.fiber.dispose() }
})

test('an installed menu keeps its private helper services out of the host dependency graph', async () => {
  const lab = fs.mkdtempSync(path.resolve('work/installed-menu-isolation-'))
  for (const name of ['menu-fixture', 'service-fixture']) {
    const directory = path.join(lab, 'node_modules', name)
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', main: 'index.js' }))
    fs.writeFileSync(path.join(directory, 'index.js'), `export function apply(ctx) { ctx.provide('publicValue', 'public'); ctx.isolate('privateValue').provide('privateValue', 'private') }`)
  }
  fs.writeFileSync(path.join(lab, 'package.json'), JSON.stringify({ name: 'test-profile', dependencies: { 'menu-fixture': '*', 'service-fixture': '*' } }))
  const dataFile = path.join(lab, 'menu.json')
  new ConfigStore(dataFile).setPluginIsolation(true)
  const ctx = new Context()
  try {
    ctx.baseUrl = pathToFileURL(path.join(lab, 'cordis.yml')).href
    await mountAgentLoopTestDependencies(ctx)
    await mountWorkspaces(ctx)
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(Loader)
    mountPluginManagement(ctx, lab)
    await mountAgentLoopTestHarness(ctx)
    const nativeImport = ctx.loader.import.bind(ctx.loader)
    ctx.loader.import = async name => name === 'menu-fixture' ? web : nativeImport(name)
    const names = ['tools', 'sessions', 'systemPrompt', 'sessionProjections', 'typert'] as const
    const labels = names.map(name => ctx[Context.isolate][name])
    const first = (await ctx.agents.create({ sessionId: SessionId('already-open') })).agent
    // The menu must appear in the installed package inventory, as it does in DSH.
    await ctx.loader.root.update([
      { id: 'menu-fixture', name: 'menu-fixture', config: { dataFile } },
      { id: 'service-fixture', name: 'service-fixture' },
    ])
    await ctx.loader.await()
    const manager = ctx.tieredPlugins
    const plan = await manager.plan(clientScope, 'service-fixture', 'on')
    assert.deepEqual(plan.missing, [])
    const declarations = (manager as any).declarations as Map<string, { provides: Set<string> }>
    assert.deepEqual([...declarations.get('menu-fixture')!.provides], [], '共享服务由独立核心持有，界面包不再提供这些服务')
    assert.deepEqual([...declarations.get('service-fixture')!.provides], ['publicValue'])
    const second = (await ctx.agents.create({ sessionId: SessionId('opened-later') })).agent
    await manager.sync()
    assert.deepEqual(names.map(name => ctx[Context.isolate][name]), labels)
    assert.equal(ctx.agents.get(first.id), first)
    assert.equal(ctx.agents.get(second.id), second)
    assert.ok(names.every(name => ctx.get(name)))
    await ctx.loader.resolve('menu-fixture')!.update({ disabled: true })
    assert.deepEqual(names.map(name => ctx[Context.isolate][name]), labels)
    assert.equal(ctx.agents.get(first.id), first)
    await ctx.loader.resolve('menu-fixture')!.update({ disabled: false })
    assert.deepEqual(names.map(name => ctx[Context.isolate][name]), labels)
    assert.equal(ctx.agents.get(second.id), second)
  } finally { await ctx.fiber.dispose() }
})
