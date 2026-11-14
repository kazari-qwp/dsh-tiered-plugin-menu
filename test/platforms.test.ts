import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as temporary from 'dsh-temporary-messages'
import { acquireCore } from '../packages/core/src/index.ts'
import * as core from '../packages/core/src/index.ts'
import * as coreHost from '../packages/core/src/host.ts'
import { attachRoute } from '../packages/core/src/routing.ts'
import { MenuModel } from '../packages/core/src/model.ts'
import { installNativeRouting } from '../packages/dsh-go/src/routing.ts'
import { mountWorkspaces } from './workspaces.ts'
import { mountPluginManagement } from './plugins.ts'

test('显式核心供多个界面租用：不调用根挂载，核心更新后重新连接', async () => {
  mkdirSync('work', { recursive: true })
  const dataFile = resolve(mkdtempSync('work/core-owner-'), 'settings.json')
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await mountWorkspaces(ctx)
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(Loader)
    ctx.loader.import = async () => temporary
    await ctx.loader.root.update([{ id: 'temporary', name: 'dsh-temporary-messages', disabled: true }])
    await ctx.loader.await()
    mountPluginManagement(ctx)
    await mountAgentLoopTestHarness(ctx)
    const owner = await ctx.plugin(coreHost, { dataFile })
    const plugin = ctx.plugin
    // TUI rejects root capabilities from plugin apply. The declared host must
    // own the backend beneath its own Context, including after an update.
    Object.defineProperty(ctx, 'plugin', { configurable: true, value: function(this: Context, ...args: any[]) {
      assert.notEqual(this, ctx, 'plugin activation must not mount on ctx.root')
      return Reflect.apply(plugin, this, args)
    } })
    const holders: unknown[] = []
    const front = { inject: ['tieredCore'], async apply(child: Context) { holders.push(await acquireCore(child)) } }
    const frontend = await plugin.call(ctx, front)
    const second = await plugin.call(ctx, front)
    const manager = ctx.tieredPlugins
    assert.ok(manager)
    assert.equal(holders[0], holders[1])
    manager.setWorkspaceTreeInheritance(false)
    await frontend.dispose(); await frontend.await()
    assert.equal(ctx.tieredPlugins, manager)
    await owner.dispose(); await owner.await()
    assert.equal(ctx.get('tieredPlugins'), undefined)
    const reopened = await plugin.call(ctx, coreHost, { dataFile })
    await second.await()
    assert.notEqual(ctx.tieredPlugins, manager)
    assert.ok(ctx.tieredPlugins)
    assert.equal(ctx.tieredPlugins.settings().inheritWorkspaceTree, false)
    await second.dispose(); await second.await()
    assert.equal(ctx.get('tieredPlugins'), undefined, 'last interface releases the backend')
    delete (ctx as any).plugin
    await reopened.dispose()
  } finally { await ctx.fiber.dispose() }
})

test('三个界面共用核心：跨界面配置、先关闭一个、最后释放、重开恢复', async () => {
  mkdirSync('work', { recursive: true })
  const dataFile = resolve(mkdtempSync('work/frontends-'), 'config.json')
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await mountWorkspaces(ctx)
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(Loader)
    ctx.loader.import = async () => temporary
    await ctx.loader.root.update([{ id: 'temporary', name: 'dsh-temporary-messages', disabled: true, config: { template: 'GLOBAL' } }])
    await ctx.loader.await()
    mountPluginManagement(ctx)
    await mountAgentLoopTestHarness(ctx)
    await ctx.agents.create({ sessionId: SessionId('A') })
    const holders: Awaited<ReturnType<typeof acquireCore>>[] = []
    const open = () => ctx.plugin(async child => { holders.push(await acquireCore(child, { dataFile })) })
    const web = await open(), tui = await open(), mobile = await open()
    const otherCopy = await import(pathToFileURL(resolve('packages/core/dist/index.js')).href + '?separate-install=1')
    const fourth = await ctx.plugin(async child => {
      assert.equal(await otherCopy.acquireCore(child, { dataFile }), holders[0], '兼容核心副本也必须共享一个宿主实例')
    })
    await fourth.dispose(); await fourth.await()
    assert.equal(new Set(holders).size, 1)
    const manager = holders[0]!
    const menu = new MenuModel(manager, 'A')
    await menu.change('temporary', 'on')
    assert.ok(menu.pending, '未声明兼容性，需要二次确认')
    await menu.confirm()
    await menu.save('temporary', '{"template":"MOBILE"}')
    assert.equal((await new MenuModel(holders[1]!, 'A').config('temporary')).template, 'MOBILE')
    const running = manager.instance({ level: 'session', id: 'A' }, 'temporary')!
    const scopedEntry = () => [...ctx.loader.entries()].find(entry => entry.fiber === running.plugin)
    assert.ok(scopedEntry(), '共享核心创建的下级入口必须可被宿主发现，才能加载其前端')
    assert.equal(ctx.loader.resolve(scopedEntry()!.id), scopedEntry())
    assert.equal(ctx.loader.root.data.length, 1, '运行时入口不能写入客户端持久化配置')
    await web.dispose(); await web.await()
    assert.equal(ctx.tieredPlugins, manager)
    assert.ok(running.plugin.uid, '其他界面仍打开时，下级实例继续运行')
    assert.ok(scopedEntry(), '首个界面关闭后，其他界面仍能发现下级入口')
    await tui.dispose(); await tui.await()
    assert.ok(running.plugin.uid)
    await mobile.dispose(); await mobile.await()
    assert.equal(running.plugin.uid, null)
    assert.equal(scopedEntry(), undefined, '最后一个界面关闭后，运行时入口一起移除')
    assert.equal([...ctx.loader.entries()].length, 1)
    assert.equal(ctx.get('tieredPlugins'), undefined)
    const reopened = await open()
    assert.notEqual(holders.at(-1), manager)
    assert.equal((await new MenuModel(holders.at(-1)!, 'A').config('temporary')).template, 'MOBILE')
    const closing = reopened.dispose()
    const replacement = await open()
    await closing
    assert.equal(ctx.tieredPlugins, holders.at(-1), '最后一个界面关闭与新界面打开交错时，核心仍可用')
    assert.equal((await new MenuModel(holders.at(-1)!, 'A').config('temporary')).template, 'MOBILE')
    await replacement.dispose()
  } finally { await ctx.fiber.dispose() }
})

test('dshGo 原生同名注册：会话隔离、动作、数据与卸载后的存活实例', async () => {
  const ctx = new Context()
  const registrations = new Map<string, { value: any; token: object }>()
  const native: any = { ctx, refresh() {} }
  Object.defineProperty(native, Symbol.for('cordis.tracker'), { value: { associate: 'dshGo', property: 'ctx' } })
  for (const method of ['panel', 'strip', 'turnNote', 'on', 'media', 'micro', 'onCapability']) {
    native[method] = function (this: { ctx: Context }, id: any, value?: any) {
      if (method === 'onCapability') { value = id; id = 'events' }
      const key = `${method}/${id}`, token = {}
      return this.ctx.effect(() => {
        registrations.set(key, { value, token })
        return () => { if (registrations.get(key)?.token === token) registrations.delete(key) }
      })
    }
  }
  ctx.provide('dshGo', native)
  try {
    const router = await ctx.plugin(installNativeRouting)
    const stopped: string[] = [], clicked: string[] = []
    const mount = (id: string) => ctx.plugin(child => {
      const accepts = (sessionId: string) => sessionId === id
      attachRoute(child, { accepts, owner: { scope: { level: 'session', id }, pluginId: 'example', package: 'example', accepts } })
      const service = child.get('dshGo') as any
      const data = (_scope: unknown, emit: (data: unknown) => void) => { emit({ text: id }); return () => stopped.push(id) }
      service.panel('same', { view: () => ({ v: 1, type: 'text', text: id }), data,
        actions: { click: () => { clicked.push(id); return { toast: id } } } })
      for (const method of ['strip', 'turnNote', 'micro']) service[method]('same', { data })
      for (const method of ['on', 'media']) service[method]('same', () => id)
      service.onCapability(() => { clicked.push(id) })
    })
    const a = await mount('A'), b = await mount('B')
    const panel = () => registrations.get('panel/same')!.value
    assert.equal(panel().view({ sessionId: 'A' }).text, 'A')
    assert.equal(panel().view({ sessionId: 'B' }).text, 'B')
    assert.match(panel().view({ sessionId: 'C' }).text, /未启用/)
    assert.deepEqual(panel().actions.click({ sessionId: 'A' }, {}), { toast: 'A' })
    assert.deepEqual(panel().actions.click({ sessionId: 'B' }, {}), { toast: 'B' })
    let data: unknown
    const stop = await panel().data({ sessionId: 'B' }, (value: unknown) => data = value)
    assert.deepEqual(data, { text: 'B' }); stop(); assert.deepEqual(stopped, ['B'])
    for (const method of ['strip', 'turnNote', 'micro']) {
      const cancel = await registrations.get(`${method}/same`)!.value.data({ sessionId: 'A' }, (value: unknown) => data = value)
      cancel()
      assert.deepEqual(data, { text: 'A' })
    }
    assert.equal(registrations.get('on/same')!.value({ sessionId: 'B' }, {}), 'B')
    registrations.get('onCapability/events')!.value({ sessionId: 'B' }, {})
    assert.deepEqual(clicked, ['A', 'B', 'B'])
    await a.dispose(); await a.await()
    assert.equal(panel().view({ sessionId: 'B' }).text, 'B', '首个注册实例释放后，入口归于存活实例')
    await b.dispose(); await b.await()
    assert.equal(registrations.size, 0)
    await router.dispose()
    const plain = await ctx.plugin(child => (child.get('dshGo') as any).panel('same', { view: { v: 1, type: 'text', text: 'native' } }))
    assert.equal(panel().view.text, 'native')
    await plain.dispose()
  } finally { await ctx.fiber.dispose() }
})
