import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry, { type SkillProviderControl } from '@deepseek-ai/dsh-skill'
import { ScopedServices, scopedServiceNames } from '../src/scoped-services.ts'

const scope = (id: string) => ({ id })
const invocation = { modelInvocable: true, userInvocable: true }

test('skill providers route per session, invalidate cached catalogs and own their lifecycle', async()=>{
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  const broker = new ScopedServices(ctx)
  const selected: Record<string,string|undefined> = { a:'A', b:'B' }
  const owners = new Map<string,Awaited<ReturnType<ScopedServices['mount']>>>()
  const controls = new Map<string,SkillProviderControl>()
  try {
    ctx.skills.register({name:'base-skill',description:'base',content:'BASE',source:'runtime'})
    for (const id of ['A','B','CLIENT']) {
      let isolated = ctx
      for (const name of scopedServiceNames) isolated = isolated.isolate(name)
      const owner = await broker.mount(isolated, {scope:{level:id==='CLIENT'?'client':'session',id},accepts:sessionId=>selected[sessionId]===id,configKey:()=>id})
      owners.set(id,owner)
      const candidate = {name:'fixture-skill',description:id,source:'bundled',provider:'fixture',rank:600,locator:id,invocation}
      ;(owner.ctx.get('skills') as Context['skills']).registerProvider(control=>{
        controls.set(id,control)
        return {name:'fixture',list:async()=>[candidate],get:async found=>({...found,content:id})}
      })
    }
    assert.equal((await ctx.skills.get('fixture-skill',{scope:scope('a')}))?.content,'A')
    assert.equal((await ctx.skills.get('fixture-skill',{scope:scope('b')}))?.content,'B')
    assert.equal(await ctx.skills.get('fixture-skill',{scope:scope('off')}),undefined)
    assert.equal((await ctx.skills.get('fixture-skill'))?.content,'CLIENT')
    selected.a='B'
    await broker.refresh()
    assert.equal((await ctx.skills.list({scope:scope('a')})).find(skill=>skill.name==='fixture-skill')?.description,'B')
    assert.equal((await ctx.skills.get('fixture-skill',{scope:scope('a')}))?.content,'B')
    await owners.get('B')!.dispose()
    assert.equal(controls.get('B')!.signal.aborted,true)
    assert.equal(controls.get('A')!.signal.aborted,false)
    assert.equal(await ctx.skills.get('fixture-skill',{scope:scope('b')}),undefined)
    assert.equal((await ctx.skills.get('base-skill',{scope:scope('b')}))?.content,'BASE')
  } finally { await ctx.fiber.dispose() }
})

test('runtime skills keep per-instance content and disappear from disabled scopes', async()=>{
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  const broker = new ScopedServices(ctx)
  try {
    for (const id of ['a','b']) {
      let isolated = ctx
      for (const name of scopedServiceNames) isolated = isolated.isolate(name)
      const owner = await broker.mount(isolated,{scope:{level:'session',id},accepts:sessionId=>sessionId===id,configKey:()=>id})
      ;(owner.ctx.get('skills') as Context['skills']).register({name:'runtime-fixture',description:id,source:'runtime',content:id})
    }
    assert.equal((await ctx.skills.get('runtime-fixture',{scope:scope('a')}))?.content,'a')
    assert.equal((await ctx.skills.get('runtime-fixture',{scope:scope('b')}))?.content,'b')
    assert.equal(await ctx.skills.get('runtime-fixture',{scope:scope('off')}),undefined)
    assert.equal(await ctx.skills.get('runtime-fixture'),undefined)
  } finally { await ctx.fiber.dispose() }
})
