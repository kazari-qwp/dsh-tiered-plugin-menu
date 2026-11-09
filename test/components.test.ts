import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { mountWorkspaces } from './workspaces.ts'
import * as menu from '../src/index.ts'
import { childScope, clientScope, type Scope } from '../src/shared.ts'
import { SessionId } from '@deepseek-ai/dsh-session'

test('package switches, component switches and dependency confirmation use the same independent instances', { timeout: 15000 }, async () => {
  mkdirSync('work', { recursive: true })
  const directory = resolve(mkdtempSync('work/components-'))
  const ctx = new Context()
  const modules = {
    'sample/provider': { provide: 'sampleData', apply(ctx: Context) { ctx.provide('sampleData', { key: Symbol('instance') }) } },
    'sample/consumer': { inject: ['sampleData'], apply(ctx: Context) { ctx.provide('sampleResult', ctx.get('sampleData')) } },
    'sample/independent': { apply() {} },
  }
  try {
    await mountAgentLoopTestDependencies(ctx)
    await mountWorkspaces(ctx)
    await ctx.plugin(Loader)
    await ctx.plugin(TypertRegistry)
    ctx.loader.import = async name => modules[name as keyof typeof modules]
    const rows = Object.keys(modules).map(name => ({ id: name.split('/')[1]!, name, disabled: true }))
    await ctx.loader.root.update(rows)
    await ctx.loader.await()
    ctx.provide('profileContext', { dir: directory, installAnchor: resolve(directory, 'package.json') } as any)
    ctx.provide('configEditor', { edit: async (entry: any, fn: any) => entry.update({ config: fn(entry.options.config ?? {}) }) } as any)
    ctx.provide('pluginManager', {
      listBundles: async () => [{ name: 'sample', installed: true, enabled: true, description: '',
        rows: rows.map(row => ({ rowId: row.id, moduleName: row.name, entryId: row.id })) }],
      setPluginEnabled: async (id: string, enabled: boolean) => { await ctx.loader.resolve(id).update({ disabled: !enabled }); return {} },
    } as any)
    await mountAgentLoopTestHarness(ctx)
    const workspace = await ctx.workspaceRegistry.create(directory)
    const scope: Scope = { level: 'workspace', id: String(workspace.id) }
    await ctx.plugin(menu, { dataFile: resolve(directory, 'config.json') })
    const manager = ctx.tieredPlugins
    const rowsBefore = await manager.rows(scope)
    assert.equal(rowsBefore.length, 1)
    assert.equal(rowsBefore[0]!.components!.length, 3)
    const plan = await manager.plan(scope, 'sample#consumer', 'on')
    assert.deepEqual(plan.dependencies.map(item => item.id), ['sample#provider'])
    assert.equal(manager.store.get(scope, 'sample#provider'), undefined, 'preparing/cancelling a dialog must not mutate configuration')
    await manager.change(scope, plan.id, plan.mode, plan.signature)
    const provider = manager.instance(scope, 'sample#provider')!.plugin.ctx.get('sampleData')
    const consumer = manager.instance(scope, 'sample#consumer')!.plugin.ctx.get('sampleResult')
    assert.equal(provider, consumer)
    assert.equal(manager.instance(scope, 'sample#independent'), undefined)
    assert.equal((await manager.rows(scope))[0]!.partial, true)
    const stop = await manager.plan(scope, 'sample#provider', 'off')
    assert.deepEqual(stop.dependencies.map(item => item.id), ['sample#consumer'])
    assert.ok(manager.instance(scope, 'sample#provider'), 'cancel leaves running instances alone')
    await assert.rejects(manager.configure(scope, 'sample#provider', false, {}), /需要先关闭/)
    await manager.change(scope, stop.id, stop.mode, stop.signature)
    assert.equal(manager.instance(scope, 'sample#provider'), undefined)
    assert.equal(manager.instance(scope, 'sample#consumer'), undefined)
    const all = await manager.plan(scope, 'sample', 'on')
    assert.equal(all.dependencies.length, 0)
    await manager.change(scope, all.id, all.mode, all.signature)
    assert.ok((await manager.rows(scope))[0]!.enabled)
    assert.equal((await manager.rows(clientScope))[0]!.enabled, false)
    const allOff = await manager.plan(scope, 'sample', 'off')
    await manager.change(scope, allOff.id, allOff.mode, allOff.signature)
    assert.equal(manager.instances.get(`workspace:${workspace.id}`), undefined)
    await manager.configure(scope, 'sample#provider', true, {}, true)
    const handle = await ctx.agents.create({ sessionId: SessionId('dependent-session'), meta: { cwd: directory } })
    await workspace.attachSession(handle.agent.id)
    const session: Scope = { level: 'session', id: handle.agent.id }
    await manager.configure(session, 'sample#consumer', true, {}, true)
    assert.equal(manager.instance(session, 'sample#consumer')!.plugin.ctx.get('sampleResult'), manager.instance(scope, 'sample#provider')!.plugin.ctx.get('sampleData'))
    const crossScope = await manager.plan(scope, 'sample#provider', 'off')
    assert.ok(crossScope.dependencies.some(change => change.scope.id === session.id && change.id === 'sample#consumer'))
    await manager.change(scope, crossScope.id, crossScope.mode, crossScope.signature)
    assert.equal(manager.instance(session, 'sample#consumer'), undefined)
    manager.setChildSettings(scope, true)
    const defaults = childScope(scope)
    const childPlan = await manager.plan(defaults, 'sample#consumer', 'on')
    assert.deepEqual(childPlan.dependencies.map(item => item.id), ['sample#provider'])
    await manager.change(defaults, childPlan.id, childPlan.mode, childPlan.signature)
    assert.equal(manager.instance(defaults, 'sample#provider'), undefined)
    assert.equal(manager.instance(scope, 'sample#provider'), undefined)
    const child = await ctx.agents.create({ sessionId: SessionId('new-dependent-session'), meta: { cwd: directory } })
    const childView: Scope = { level: 'session', id: child.agent.id }
    assert.equal(manager.instance(childView, 'sample#consumer')!.plugin.ctx.get('sampleResult'), manager.instance(childView, 'sample#provider')!.plugin.ctx.get('sampleData'))
    assert.equal((await manager.rows(session))[0]!.components!.find(row => row.id === 'sample#consumer')!.enabled, false)
    await child.dispose()
    await handle.dispose()
    modules['sample/consumer'].inject = ['notInstalledService']
    const missing = await manager.plan(scope, 'sample#consumer', 'on')
    assert.ok(missing.missing.some(name => name.includes('notInstalledService')))
    const before = manager.store.get(scope, 'sample#consumer')
    await assert.rejects(manager.change(scope, missing.id, missing.mode, missing.signature), /依赖不可用/)
    assert.equal(manager.store.get(scope, 'sample#consumer'), before)
  } finally { await ctx.fiber.dispose() }
})
