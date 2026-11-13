import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import NativePluginManager from '@deepseek-ai/dsh-plugin-manager'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as contextPlugin from 'dsh-context'
import * as temporary from 'dsh-temporary-messages'
import * as menu from '../packages/core/src/index.ts'
import { installedPlugins } from '../packages/core/src/catalog.ts'
import { clientScope } from '../packages/core/src/shared.ts'
import { mountWorkspaces } from './workspaces.ts'
import { mountPluginManagement } from './plugins.ts'

test('原生插件清单：禁用包仍被发现，自兼容状态只取元数据，自有插件没有特例', async () => {
  mkdirSync('work', { recursive: true })
  const root = resolve(mkdtempSync('work/discovery-'))
  const custom = join(root, 'node_modules', 'declared-test-plugin')
  mkdirSync(custom, { recursive: true })
  const manifest = { name: 'declared-test-plugin', version: '1.0.0', main: 'index.js',
    dsh: { bundle: { patch: './cordis.patch.yml' }, tieredPluginMenu: { selfCompatible: true } } }
  writeFileSync(join(custom, 'package.json'), JSON.stringify(manifest))
  writeFileSync(join(custom, 'index.js'), 'module.exports = {}')
  writeFileSync(join(custom, 'cordis.patch.yml'), '- insert:\n    - id: declared-test-plugin\n      name: declared-test-plugin\n')
  const packages = ['dsh-temporary-messages', 'dsh-context', 'dsh-tiered-plugin-menu', manifest.name]
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'test-profile', private: true,
    dependencies: Object.fromEntries(packages.map(name => [name, '*'])),
    dsh: { profile: { bundles: packages.filter(name => name !== 'dsh-context') } },
  }))
  writeFileSync(join(root, 'cordis.patch.yml'), '[]')
  const ctx = new Context()
  try {
    await ctx.plugin(Loader)
    await ctx.plugin(TypertRegistry)
    ctx.provide('profileContext', {
      name: 'test', dir: root, patchPath: join(root, 'cordis.patch.yml'), installAnchor: resolve('package.json'),
      cwd: root, home: root, startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
    })
    await ctx.plugin(NativePluginManager)
    const found = await installedPlugins(ctx)
    assert.deepEqual([...new Set(found.map(plugin => plugin.package))].sort(), packages.sort())
    assert.equal(found.filter(plugin => plugin.package === 'dsh-tiered-plugin-menu').length, 2)
    for (const name of ['dsh-temporary-messages', 'dsh-context', 'dsh-tiered-plugin-menu']) {
      assert.equal(found.find(plugin => plugin.package === name)!.selfCompatible, false)
    }
    assert.equal(found.find(plugin => plugin.package === 'dsh-context')!.bundle.enabled, false)
    const declared = found.find(plugin => plugin.package === manifest.name)!
    assert.equal(declared.selfCompatible, true)
    manifest.dsh.tieredPluginMenu.selfCompatible = false
    writeFileSync(join(custom, 'package.json'), JSON.stringify(manifest))
    assert.equal((await installedPlugins(ctx)).find(plugin => plugin.package === manifest.name)!.selfCompatible, false)
  } finally { await ctx.fiber.dispose() }
})

test('原版第三方插件：客户端开关直接生效，分层需确认，适配成功仍不冒充元数据认证', async () => {
  mkdirSync('work', { recursive: true })
  const root = resolve(mkdtempSync('work/discovery-host-'))
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await mountWorkspaces(ctx)
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(Loader)
    ctx.loader.import = async name => name === 'dsh-context' ? contextPlugin : temporary
    await ctx.loader.root.update([
      { id: 'temporary-messages', name: 'dsh-temporary-messages', config: { template: 'TEMP' } },
      { id: 'dsh-context', name: 'dsh-context', config: { promptPrefix: 'GLOBAL CONTEXT' } },
    ])
    await ctx.loader.await()
    const native = mountPluginManagement(ctx)
    await mountAgentLoopTestHarness(ctx)
    await ctx.agents.create({ sessionId: SessionId('discovery-session') })
    await ctx.plugin(menu, { dataFile: join(root, 'settings.json') })
    const manager = ctx.tieredPlugins
    const scope = { level: 'session' as const, id: 'discovery-session' }
    const rows = await manager.rows(scope)
    assert.deepEqual(rows.map(row => row.package), ['dsh-temporary-messages', 'dsh-context'])
    assert.ok(rows.every(row => !row.verified))
    await manager.configure(clientScope, 'dsh-context', false, {})
    assert.equal((await manager.rows(clientScope)).find(row => row.id === 'dsh-context')!.enabled, false)
    await manager.configure(clientScope, 'dsh-context', true, {})
    assert.equal((await manager.rows(clientScope)).find(row => row.id === 'dsh-context')!.enabled, true)
    assert.equal(native.calls.length, 2)
    for (const id of ['temporary-messages', 'dsh-context']) {
      await assert.rejects(manager.configure(scope, id, true, {}), /请确认/)
      assert.equal(manager.store.get(scope, id), undefined)
    }
    await manager.configure(scope, 'dsh-context', true, { promptPrefix: 'SESSION CONTEXT' }, true)
    assert.equal(manager.instance(scope, 'dsh-context')!.plugin.state, 2)
    await manager.configure(scope, 'temporary-messages', true, { template: 'CONFIRMED' }, true)
    assert.equal(manager.instance(scope, 'temporary-messages')!.plugin.state, 2)
    assert.equal((await manager.rows(scope))[0]!.verified, false, '启用成功不会擅自把插件标成已验证')
  } finally { await ctx.fiber.dispose() }
})
