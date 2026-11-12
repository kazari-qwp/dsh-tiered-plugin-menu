// Run against a checked-out official dsh-Go SDK/bridge; no Android emulator or live profile.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as core from '../packages/core/src/index.ts'
import { installNativeRouting } from '../packages/dsh-go/src/routing.ts'
import { mountMenu } from '../packages/dsh-go/src/menu.ts'
import { mountWorkspaces } from '../test/workspaces.ts'
import { mountPluginManagement } from '../test/plugins.ts'

const repo = path.resolve(process.argv[2] ?? '../research/dsh-go')
const load = (file: string) => import(pathToFileURL(path.join(repo, file)).href)
const { createTestHost } = await load('sdk/plugin-kit/lib/testing.js')
const { checkView } = await load('sdk/plugin-kit/lib/check.js')
const { NativeCore } = await load('runtime/bridge/dsh-go-bridge/lib/native/core.js')
const { LIMITS } = await load('runtime/bridge/dsh-go-bridge/lib/native/limits.js')
const { normalizeScope } = await load('runtime/bridge/dsh-go-bridge/lib/native/util.js')
fs.mkdirSync('work', { recursive: true })
const lab = fs.mkdtempSync(path.resolve('work/go-sdk-'))
const pkg = path.join(lab, 'node_modules/native-example')
fs.mkdirSync(pkg, { recursive: true })
const manifest = { name: 'native-example', version: '1.0.0', type: 'module', main: 'index.js', dsh: { bundle: { patch: './cordis.patch.yml' } },
  dshGo: { v: 1, title: 'Example', contributes: { panels: [{ id: 'status', title: 'Status', placement: ['session.tab'] }] } } }
fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify(manifest))
fs.writeFileSync(path.join(pkg, 'cordis.patch.yml'), '- insert:\n    - id: native-example\n      name: native-example\n')
fs.writeFileSync(path.join(pkg, 'index.js'), `
export function apply(ctx, config) {
  ctx.inject(['dshGo'], child => {
    child.dshGo.panel('status', {
      view: () => ({v:1,type:'text',text:config.label}),
      data: (scope,emit) => {emit({label:config.label}); return () => {}},
      actions: {read: () => ({toast:config.label})}
    });
  });
}
`)
fs.writeFileSync(path.join(lab, 'package.json'), JSON.stringify({ name: 'test-profile', dependencies: { 'native-example': '*' } }))
const ctx = new Context()
ctx.baseUrl = pathToFileURL(path.join(lab, 'cordis.yml')).href
const native = new NativeCore(ctx, LIMITS, 'test')
const refreshes: any[] = []
const nativeRefresh = native.service.refresh
native.service.refresh = function (...args: any[]) { refreshes.push(args); return nativeRefresh.apply(this, args) }
const menuHost = createTestHost({ dir: path.resolve('packages/dsh-go') })
try {
  await mountAgentLoopTestDependencies(ctx)
  await mountWorkspaces(ctx)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(Loader)
  ctx.provide('dshGo', native.service)
  await ctx.loader.root.update([{ id: 'native-example', name: 'native-example', config: { label: 'CLIENT' } }])
  await ctx.loader.await()
  mountPluginManagement(ctx, lab)
  await mountAgentLoopTestHarness(ctx)
  const ws = await ctx.workspaceRegistry.create(lab)
  for (const id of ['A', 'B']) {
    await ctx.agents.create({ sessionId: SessionId(id), meta: { cwd: lab } })
    await ws.attachSession(SessionId(id))
  }
  const coreFiber = await ctx.plugin(core, { dataFile: path.join(lab, 'config.json') })
  const manager = ctx.tieredPlugins
  for (const id of ['A', 'B']) await manager.configure({ level: 'session', id }, 'native-example', true, { label: id }, true)
  const panel = () => native.registration('native-example', 'panels', 'status').def
  assert.equal(panel().view({ sessionId: 'A' }).text, 'B', '对照：原生服务按包名覆盖，未适配时串到 B')
  await manager.adaptService('dshGo', installNativeRouting)
  for (const id of ['A', 'B']) {
    assert.equal((await panel().view({ sessionId: id })).text, id)
    assert.equal((await panel().actions.read({ sessionId: id }, {})).toast, id)
  }
  assert.equal((await panel().view({})).text, 'CLIENT')
  const bFeed = native.feed('native-example', 'status', 'panel', normalizeScope({ sessionId: 'B' }))
  await manager.configure({ level: 'session', id: 'A' }, 'native-example', false, {})
  assert.ok(native.feeds.get(bFeed.key) === bFeed, '关闭 A 不应终止 B 的原生数据流')
  assert.match((await panel().view({ sessionId: 'A' })).text, /未启用/)
  assert.equal((await panel().view({ sessionId: 'B' })).text, 'B')
  await manager.inherit({ level: 'session', id: 'A' }, 'native-example')
  assert.equal((await panel().view({ sessionId: 'A' })).text, 'CLIENT')
  // An inherited client's live data must stop reaching a session after that session turns it off.
  let streamed: any
  const stop = await panel().data({ sessionId: 'A' }, (value: any) => { streamed = value })
  assert.equal(streamed.label, 'CLIENT')
  await manager.configure({ level: 'session', id: 'A' }, 'native-example', false, {})
  assert.equal(streamed, null, '关闭继承插件也必须撤下已订阅的数据')
  assert.ok(refreshes.some(([id, scope]) => id === 'status' && scope.sessionId === 'A'), '切换订阅时也通知 App 重读静态视图')
  stop()
  mountMenu(menuHost.ctx, manager)
  const scope = { sessionId: 'A' }
  const feed = menuHost.subscribe('menu', scope); await feed.settled
  const verify = async () => {
    const { view } = await menuHost.view('menu', scope)
    const checked = checkView(view, { budget: 'panel', data: feed.data })
    // The official renderer adjusts its own default accent in dark mode.
    assert.deepEqual(checked.issues.filter((issue: any) => issue.path !== 'view.accent' || issue.kind !== 'note'), [], JSON.stringify(checked))
    assert.equal(checked.placeholders + checked.truncated, 0)
  }
  const tap = async (action: string, value: any = {}, userGesture = true) => {
    const reply = await menuHost.invoke('menu', { action, value, scope, surface: 'panel', userGesture })
    assert.deepEqual(reply.issues, [])
    if (reply.settled) { const result = await reply.settled; assert.equal(result.t, 'done'); assert.deepEqual(result.issues ?? [], []) }
    await verify()
  }
  await verify()
  await tap('scope', { bind: 'data.nav.scope', value: JSON.stringify({ level: 'client', id: '' }) }, false)
  await tap('scope', { bind: 'data.nav.scope', value: JSON.stringify({ level: 'session', id: 'A' }) }, false)
  await tap('change', { id: 'native-example', mode: 'on' }); await tap('confirm')
  await tap('edit', { id: 'native-example' })
  await tap('save', { values: { 'data.form.json': '{"label":"MOBILE"}' } })
  assert.equal((await panel().view(scope)).text, 'MOBILE')
  await tap('children', { value: true }); await tap('policy', { value: true })
  await tap('kind', { value: 'mcp' }); await tap('add'); await tap('back')
  await tap('kind', { value: 'skill' })
  assert.deepEqual(menuHost.violations, [])
  menuHost.dispose()
  await coreFiber.dispose(); await coreFiber.await()
  assert.equal((await panel().view({ sessionId: 'B' })).text, 'CLIENT', '核心关闭后客户端原生入口恢复')
  console.log('PASS: official NativeCore multi-instance routing, live data, disposal and SDK menu views/actions')
} finally {
  menuHost.dispose()
  await ctx.fiber.dispose()
  native.dispose()
}
