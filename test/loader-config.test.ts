import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import z from '@deepseek-ai/schemastery'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as core from '../packages/core/src/index.ts'
import { clientScope, type Scope } from '../packages/core/src/shared.ts'
import { mountWorkspaces } from './workspaces.ts'

test('未加载插件读取包内声明配置，运行配置和分级覆盖仍优先且保留校验', async () => {
  mkdirSync('work', { recursive: true })
  const directory = resolve(mkdtempSync('work/declared-config-'))
  const bundleDir = resolve(directory, 'node_modules/declared-config-fixture')
  mkdirSync(bundleDir, { recursive: true })
  writeFileSync(resolve(directory, 'package.json'), '{}')
  writeFileSync(resolve(bundleDir, 'package.json'), JSON.stringify({
    name: 'declared-config-fixture', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  const options = { id: 'required-config', name: 'fixture/plugin', config: { id: 'declared' } }
  writeFileSync(resolve(bundleDir, 'cordis.patch.yml'), JSON.stringify([{ insert: [options] }]))
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await mountWorkspaces(ctx)
    await ctx.plugin(Loader)
    await ctx.plugin(TypertRegistry)
    ctx.loader.import = async () => ({ Config: z.object({ id: z.string().required() }), apply() {} })
    ctx.provide('profileContext', { dir: directory, installAnchor: resolve(directory, 'package.json') } as any)
    ctx.provide('configEditor', {} as any)
    ctx.provide('pluginManager', {
      listBundles: async () => [{ name: 'declared-config-fixture', installed: true, enabled: false,
        rows: [{ rowId: options.id, moduleName: options.name }] }],
    } as any)
    await mountAgentLoopTestHarness(ctx)
    await ctx.plugin(core, { dataFile: resolve(directory, 'settings.json') })
    const workspace: Scope = { level: 'workspace', id: 'new-workspace' }
    const session: Scope = { level: 'session', id: 'new-session' }
    for (const scope of [clientScope, workspace, session]) {
      const [row] = await ctx.tieredPlugins.rows(scope)
      assert.deepEqual(row!.config, { id: 'declared' })
      assert.deepEqual(row!.source, clientScope)
      assert.equal(row!.enabled, false)
    }
    assert.equal([...ctx.loader.entries()].some(entry => entry.options.name === options.name), false, '列出配置不启动插件')
    await ctx.loader.root.update([{ ...options, config: { id: 'live' }, disabled: true }])
    assert.deepEqual((await ctx.tieredPlugins.rows(session))[0]!.config, { id: 'live' })
    ctx.tieredPlugins.store.set(workspace, options.id, { enabled: false, config: { id: 'saved' } })
    assert.deepEqual((await ctx.tieredPlugins.rows(workspace))[0]!.config, { id: 'saved' })
    ctx.tieredPlugins.store.set(workspace, options.id, { enabled: false, config: {} })
    await assert.rejects(ctx.tieredPlugins.rows(workspace), /id missing required value/)
  } finally { await ctx.fiber.dispose() }
})

test('真实 Loader：禁用的缺失组件和 !!js 配置不阻断列表或其他组件操作', async () => {
  mkdirSync('work', { recursive: true })
  const directory = resolve(mkdtempSync('work/loader-config-'))
  const ctx = new Context()
  const expression = { __jsExpr: "'resolved-root'" }
  try {
    await mountAgentLoopTestDependencies(ctx)
    await mountWorkspaces(ctx)
    await ctx.plugin(Loader)
    await ctx.plugin(TypertRegistry)
    const present = { Config: z.object({ root: z.string().required() }), apply() {} }
    ctx.loader.import = async name => {
      if (name === 'sample/present') return present
      throw Object.assign(new Error(`Cannot find module ${name}`), { code: 'ERR_MODULE_NOT_FOUND' })
    }
    const entries = [
      { id: 'present', name: 'sample/present', config: { root: expression } },
      { id: 'missing', name: 'sample/missing', disabled: true },
    ]
    await ctx.loader.root.update(entries)
    await ctx.loader.await()
    ctx.provide('profileContext', { dir: directory, installAnchor: resolve(directory, 'package.json') } as any)
    ctx.provide('configEditor', { edit: async (entry: any, fn: any) => entry.update({ config: fn(entry.options.config ?? {}) }) } as any)
    ctx.provide('pluginManager', {
      listBundles: async () => [{ name: 'sample', installed: true, enabled: true, description: '',
        rows: entries.map(entry => ({ rowId: entry.id, moduleName: entry.name, entryId: entry.id })) }],
      setPluginEnabled: async (id: string, enabled: boolean) => { await ctx.loader.resolve(id).update({ disabled: !enabled }); return {} },
    } as any)
    await mountAgentLoopTestHarness(ctx)
    const workspace = await ctx.workspaceRegistry.create(directory)
    const scope: Scope = { level: 'workspace', id: String(workspace.id) }
    await ctx.plugin(core, { dataFile: resolve(directory, 'settings.json') })
    const rows = await ctx.tieredPlugins.rows(clientScope)
    assert.equal(rows[0]!.components!.length, 2)
    assert.equal(rows[0]!.components![0]!.config.root, 'resolved-root')
    assert.equal(rows[0]!.components![1]!.enabled, false)
    assert.deepEqual(ctx.loader.resolve('present').options.config, { root: expression }, '读取不能改写原始表达式')
    await ctx.tieredPlugins.configure(scope, 'sample#present', true, { root: expression }, true)
    assert.equal((await ctx.tieredPlugins.rows(scope))[0]!.components![0]!.config.root, 'resolved-root')
    await assert.rejects(ctx.tieredPlugins.configure(scope, 'sample#missing', true, {}, true), /Cannot find module/)
  } finally { await ctx.fiber.dispose() }
})
