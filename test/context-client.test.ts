import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createElement, Fragment, act, useState } from 'react'
import { create, type ReactTestRenderer } from 'react-test-renderer'
import { JSDOM } from 'jsdom'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { sessionForm } from '../packages/web/src/client/form.ts'
import { captureRegisteredSettings } from '../packages/web/src/client/registered-settings.tsx'
import { ContextClient } from '../packages/web/src/client/context-client.tsx'
import type { MenuRemote } from '../packages/core/src/remote-contract.ts'
import { clientScope, type PluginRow, type Scope } from '../packages/core/src/shared.ts'

const require = createRequire(import.meta.url)
function load<T>(filename: string, modules: Record<string, unknown> = {}): T {
  let exported!: T
  new Function('window', readFileSync(filename, 'utf8'))({ __ModuleLoader__: {
    load({ factory }: { factory(lookup: (id: string) => unknown): T }) {
      exported = factory(id => modules[id] ?? (id === '@deepseek-ai/dsh-client-ui-primitives'
        ? { Menu: ({ anchor }: any) => anchor, PluginArtworkDefault: () => null } : require(id)))
    },
  } })
  return exported
}

function locale(ctx: Context) {
  const dictionaries = new Map<string, any>()
  ctx.provide('locale', {
    register(ns: string, dicts: any) { dictionaries.set(ns, dicts); return () => { dictionaries.delete(ns) } },
    bind: () => (key: string) => key,
    getLocale: () => ({ active: 'zh-CN' }), subscribe: () => () => {},
  } as never)
}

test('isolated conversation panels read their own projections while sharing native title data', async () => {
  const ctx = new Context()
  const renderer = load<Plugin>(require.resolve('@deepseek-ai/dsh-client-ui-renderer/client'))
  const controllers: ContextClient[] = []
  let tree: ReactTestRenderer | undefined
  const rows = ['first', 'second'].map((id, index) => ({
    id, name: id, package: id, description: '', source: clientScope, own: false,
    enabled: true, active: true, verified: false, managed: true, settings: 'registered', config: {},
    projections: { statistics: `private-${index}` },
  }))
  const api = { list: async () => ({ ok: true, value: rows }) } as unknown as MenuRemote
  try {
    await ctx.plugin(renderer)
    await ctx.plugin(Loader)
    ctx.slots.register({ name: 'root', children: { 'conversation.view': { kind: 'list', scope: 'session' } } } as any, () => null)
    for (const row of rows) {
      const plugin = { inject: ['slots'], apply(child: Context) {
        child.slots.inject('conversation.view', () => child.slots.register({ name: 'conversation.view', id: row.id } as any,
          ({ useProjection }: any) => createElement('span', null, `${useProjection('title')}:${useProjection('statistics')}`)))
      } }
      const controller = new ContextClient(ctx, api, plugin, row.id)
      controllers.push(controller)
      await controller.select('inherited-session')
    }
    const values: Record<string, unknown> = { title: 'shared', 'private-0': 11, 'private-1': 22 }
    const useProjection = (key: string) => values[key]
    const render = () => createElement(Fragment, null, ...ctx.slots.entriesOfSlot('conversation.view')
      .map((entry, index) => createElement(entry.component as any, { key: index, useProjection })))
    await act(async () => { tree = create(render()) })
    assert.deepEqual(tree!.root.findAllByType('span').map(item => item.children[0]), ['shared:11', 'shared:22'])
    values['private-0'] = 33
    await act(async () => { tree!.update(render()) })
    assert.deepEqual(tree!.root.findAllByType('span').map(item => item.children[0]), ['shared:33', 'shared:22'])
    assert.equal(useProjection('statistics'), undefined, 'the host projection reader stays unchanged')
  } finally {
    await act(async () => tree?.unmount())
    for (const controller of controllers) await controller.dispose()
    await ctx.fiber.dispose()
  }
})

test('settings and detail cards render together, separated, against the selected form', async () => {
  const ctx = new Context()
  locale(ctx)
  let view: ReactTestRenderer | undefined
  const saved: unknown[] = []
  const form = sessionForm({ text: 'SESSION' }, async value => { saved.push(value) })
  const plugin = { inject: ['slots'], apply(child: Context) {
    for (const [slot, key, title] of [
      ['settings.section', '', 'settings'], ['plugins.bundle.config', 'sample-package', 'bundle'],
      ['plugins.row.config', 'sample-package#component-a', 'component'], ['settings.general.item', '', 'general'],
      ['plugins.row.config', 'sample-package#component-b', 'other-component'],
      ['plugins.bundle.config', 'another-package', 'other-package'], ['conversation.view', '', 'not-settings'],
    ]) child.slots.inject(slot as any, () => child.slots.register({ name: slot, key, id: title } as any,
      ({ form }: any) => createElement('button', { onClick: () => form.set('text', title) }, `${title}:${form.state.value.text}`)))
  } }
  try {
    const capture = await captureRegisteredSettings(ctx, plugin, 'component-a', form, undefined, 'sample-package')
    await act(async () => { view = create(createElement(capture.Page)) })
    assert.deepEqual(view!.root.findAllByType('button').map(button => button.children[0]),
      ['component:SESSION', 'bundle:SESSION', 'settings:SESSION', 'general:SESSION'])
    assert.equal(view!.root.findAllByType('hr').length, 3)
    await act(async () => { await view!.root.findAllByType('button')[2]!.props.onClick() })
    assert.deepEqual(saved, [{ text: 'settings' }])
    assert.ok(view!.root.findAllByType('button').every(button => String(button.children[0]).endsWith(':settings')))
    await capture.dispose()
  } finally {
    await act(async () => view?.unmount())
    await ctx.fiber.dispose()
  }
})

test('原版 dsh-context 配置卡：精确复用配置插槽，两份表单独立保存，不执行其它注册', async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>')
  Object.assign(globalThis, { window: dom.window, document: dom.window.document })
  const original = load<Plugin>(require.resolve('dsh-context/client'))
  const ctx = new Context()
  locale(ctx)
  const saved: unknown[] = []
  const formA = sessionForm({ promptPrefix: 'A', defaultGranularity: 'step' }, async value => { saved.push(['A', value]) })
  const formB = sessionForm({ promptPrefix: 'B', defaultGranularity: 'turn' }, async value => { saved.push(['B', value]) })
  let first: ReactTestRenderer | undefined
  let second: ReactTestRenderer | undefined
  try {
    const a = await captureRegisteredSettings(ctx, original, 'dsh-context', formA)
    const b = await captureRegisteredSettings(ctx, original, 'dsh-context', formB)
    await act(async () => { first = create(createElement(a.Page)); second = create(createElement(b.Page)) })
    assert.equal(first!.root.findAllByType('textarea')[0]!.props.value, 'A')
    assert.equal(second!.root.findAllByType('textarea')[0]!.props.value, 'B')
    await act(async () => { first!.root.findAllByType('textarea')[0]!.props.onFocus() })
    await act(async () => { first!.root.findAllByType('textarea')[0]!.props.onChange({ target: { value: 'A changed' } }) })
    await act(async () => { first!.root.findAllByType('textarea')[0]!.props.onBlur() })
    assert.equal(formA.getSnapshot().value!.promptPrefix, 'A changed')
    assert.equal(formB.getSnapshot().value!.promptPrefix, 'B')
    assert.equal(saved.length, 1)
  } finally {
    await act(async () => { first?.unmount(); second?.unmount() })
    await ctx.fiber.dispose(); dom.window.close()
  }
})

test('原版 dsh-context 客户端：跟随当前会话的配置，关闭移除面板，详情页始终编辑客户端配置', async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>')
  Object.assign(globalThis, { window: dom.window, document: dom.window.document })
  const original = load<Plugin>(require.resolve('dsh-context/client'))
  const renderer = load<Plugin>(require.resolve('@deepseek-ai/dsh-client-ui-renderer/client'))
  const ctx = new Context()
  locale(ctx)
  const makeRow = (source: Scope, config: Record<string, unknown>, enabled = true): PluginRow => ({
    id: 'dsh-context', name: 'dsh-context', package: 'dsh-context', description: '', source, own: true,
    enabled, active: enabled, verified: false, managed: true, settings: 'registered', config,
  })
  const rows = new Map([
    ['', makeRow(clientScope, { promptPrefix: 'CLIENT', defaultPlacement: 'all', fleetTab: 'show' })],
    ['A', makeRow({ level: 'session', id: 'A' }, { promptPrefix: 'A', defaultPlacement: 'hide', fleetTab: 'hide' })],
    ['B', makeRow({ level: 'workspace', id: 'B-workspace' }, { promptPrefix: 'B', defaultPlacement: 'tab', fleetTab: 'show' })],
    ['C', makeRow({ level: 'session', id: 'C' }, {}, false)],
  ])
  const api = {
    list: async (scope: Scope) => ({ ok: true, value: [rows.get(scope.level === 'client' ? '' : scope.id)!] }),
    configure: async (scope: Scope, _id: string, enabled: boolean, config: any) => {
      const row = [...rows.values()].find(row => row.source.level === scope.level && row.source.id === scope.id)!
      Object.assign(row, { config, enabled }); return { ok: true, value: undefined }
    },
  } as unknown as MenuRemote
  let controller: ContextClient | undefined
  let tree: ReactTestRenderer | undefined
  try {
    await ctx.plugin(renderer)
    ctx.slots.register({ name: 'root', children: {
      'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
      'conversation.view': { kind: 'list', scope: 'session' },
      'conversation.input.overlay': { kind: 'list', scope: 'session' },
      'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
    } } as any, () => null)
    ctx.provide('configForms', { get: () => sessionForm(rows.get('')!.config, async () => {}), whileServed: (_ids: any, mount: any) => mount() } as any)
    await ctx.plugin(Loader)
    ctx.loader.import = async () => original
    await ctx.loader.root.update([{ id: 'dsh-context', name: 'dsh-context' }])
    await ctx.loader.await()
    controller = new ContextClient(ctx, api, original, 'dsh-context')
    await controller.select('A')
    assert.equal(ctx.slots.entriesOfSlot('conversation.view').length, 0, 'A 隐藏两个面板入口')
    await controller.select('B')
    assert.equal(ctx.slots.entriesOfSlot('conversation.view').length, 2)
    const globalCard = ctx.slots.entriesOfSlot('plugins.bundle.config')[0]!.component as any
    await act(async () => { tree = create(createElement(globalCard)) })
    assert.equal(tree!.root.findAllByType('textarea')[0]!.props.value, 'CLIENT')
    await act(async () => { tree!.unmount() })
    await controller.select('C')
    assert.equal(ctx.slots.entriesOfSlot('conversation.view').length, 0)
    assert.equal(ctx.slots.entriesOfSlot('conversation.chat.assistant-actions' as any).length, 0)
    await controller.dispose(); controller = undefined
    assert.equal(ctx.slots.entriesOfSlot('conversation.view').length, 2, '卸载菜单恢复原生客户端面板')
    assert.equal(ctx.slots.entries('plugins.bundle.config').length, 1, '卸载不留下额外配置卡')
  } finally {
    await controller?.dispose(); await ctx.fiber.dispose(); dom.window.close()
  }
})

test('打包入口：第三方全局从未启用，会话面板和配置卡也可用', async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>')
  Object.assign(globalThis, { window: dom.window, document: dom.window.document })
  const bundled = load<Plugin>('packages/web/dist/client/index.js')
  const renderer = load<Plugin>(require.resolve('@deepseek-ai/dsh-client-ui-renderer/client'))
  const ctx = new Context()
  locale(ctx)
  let view: ReactTestRenderer | undefined
  try {
    await ctx.plugin(renderer)
    ctx.slots.register({ name: 'root', children: {
      'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
      'conversation.view': { kind: 'list', scope: 'session' },
      'conversation.input.overlay': { kind: 'list', scope: 'session' },
      'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
      'shell.overlay': { kind: 'list', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
      'sidebar.workspaces.session.row.action': { kind: 'list', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
      'main': { kind: 'keyed', scope: 'root' },
    } } as any, () => null)
    const form = sessionForm({ promptPrefix: 'CLIENT' }, async () => {})
    ctx.provide('configForms', { get: () => form, whileServed: (_ids: any, mount: any) => mount() } as any)
    await ctx.plugin(Loader)
    // A lower host Loader entry contributes the original client to DSH's graph, even with no global host instance.
    ctx.loader.import = async () => load<Plugin>(require.resolve('dsh-context/client'))
    await ctx.loader.await()
    const api = { list: async (scope: Scope) => ({ ok: true, value: [{
      id: 'dsh-context', package: 'dsh-context', name: 'dsh-context', settings: 'registered', managed: true,
      source: scope, enabled: scope.level === 'session' && scope.id === 'A', own: true,
      config: { promptPrefix: scope.level === 'client' ? 'CLIENT' : 'SESSION' },
    }] }) }
    ctx.provide('remote', { $mount: async () => () => {}, tieredPluginMenu: api } as any)
    ctx.provide('remote.tieredPluginMenu', api as any)
    ctx.provide('pluginNavigation', { openBundle() {} } as any)
    let fiber = await ctx.plugin(bundled)
    // The module arrives after the menu has already started (first lower-scope activation).
    await ctx.loader.root.update([{ id: 'dsh-context', name: 'dsh-context' }])
    // 等待客户端的依赖注入子入口完成；不是浏览器操作。
    await ctx.loader.await()
    for (let i = 0; i < 10 && !ctx.slots.entries('tiered-plugin-menu.active-session' as any).some(e => e.options.id === 'tiered-observer:dsh-context'); i++) {
      await new Promise(resolve => setImmediate(resolve))
    }
    const observer = ctx.slots.entries('tiered-plugin-menu.active-session' as any).find(e => e.options.id === 'tiered-observer:dsh-context')!
    assert.ok(observer)
    const face = observer.inject!() as any
    await face.controller.select('A')
    assert.equal(ctx.slots.entries('conversation.view').filter(entry => entry.options.id !== 'tiered-plugin-menu.settings').length, 2, '全局从未启用也应注册上下文、编队面板')
    assert.equal(ctx.slots.entries('sidebar.panellist' as any).length, 1)
    assert.equal(ctx.slots.entries('main').length, 1)
    await face.controller.select('B')
    assert.equal(ctx.slots.entries('conversation.view').filter(entry => entry.options.id !== 'tiered-plugin-menu.settings').length, 0, '未启用的会话没有面板')
    await face.controller.select('A')
    assert.equal(ctx.slots.entries('plugins.bundle.config').length, 1)
    const injected = ctx.slots.entries('shell.overlay').find(e => e.options.id === 'tiered-plugin-menu')!.inject!() as any
    const result = await api.list({ level: 'session', id: 'A' })
    await act(async () => { view = create(createElement(injected.ui.Settings, { row: result.value[0], scope: { level: 'session', id: 'A' } })) })
    assert.equal(view!.root.findAllByType('textarea')[0]!.props.value, 'SESSION')
    await act(async () => { view!.unmount() })
    // 宿主全局从未启用；下级使原前端入口可见，不代表它应该在菜单卸载后继续运行。
    await fiber.dispose()
    assert.equal(ctx.slots.entries('conversation.view').filter(entry => entry.options.id !== 'tiered-plugin-menu.settings').length, 0, '关闭菜单必须移除仅下级启用的原前端')
    assert.equal(ctx.slots.entries('sidebar.panellist' as any).length, 0, '移除洞察按钮')
    assert.equal(ctx.slots.entries('main').length, 0, '移除洞察页面')
    assert.equal(ctx.slots.entries('plugins.bundle.config').length, 0)
    fiber = await ctx.plugin(bundled)
    await ctx.loader.await()
    const restarted = ctx.slots.entries('tiered-plugin-menu.active-session' as any).find(e => e.options.id === 'tiered-observer:dsh-context')!
    const restored = restarted.inject!() as any
    await restored.controller.select('A')
    assert.equal(ctx.slots.entries('conversation.view').filter(entry => entry.options.id !== 'tiered-plugin-menu.settings').length, 2, '重新打开菜单恢复保存的会话前端')
    assert.equal(ctx.slots.entries('sidebar.panellist' as any).length, 1)
    assert.equal(ctx.slots.entries('main').length, 1)
    // 再模拟全局开/关/重新开启，Loader 会创建新的 Entry，不能继续绑定旧对象。
    ctx.loader.import = async () => load<Plugin>(require.resolve('dsh-context/client'))
    for (let i = 0; i < 2; i++) {
      await ctx.loader.root.update([{ id: 'dsh-context', name: 'dsh-context' }])
      await ctx.loader.await()
      await restored.controller.refresh()
      assert.equal(ctx.slots.entries('conversation.view').filter(entry => entry.options.id !== 'tiered-plugin-menu.settings').length, 2, '全局开启也只能有一套会话面板')
      await ctx.loader.root.update([])
      await ctx.loader.await()
      await restored.controller.refresh()
      assert.equal(ctx.slots.entries('conversation.view').filter(entry => entry.options.id !== 'tiered-plugin-menu.settings').length, 2, '全局关闭保留下级面板')
    }
    await fiber.dispose()
    assert.equal(ctx.slots.entries('tiered-plugin-menu.active-session' as any).some(e => e.options.id === 'tiered-observer:dsh-context'), false)
    assert.equal(ctx.slots.entries('plugins.bundle.config').length, 0)
  } finally { await ctx.fiber.dispose(); dom.window.close() }
})

test('点击洞察离开对话页面后，插件面板仍存活；切换关闭的会话才移除', async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>')
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({}) // 价格表/统计请求使用空数据，不访问网络。
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, MutationObserver: dom.window.MutationObserver })
  const bundled = load<Plugin>('packages/web/dist/client/index.js')
  const original = load<Plugin>(require.resolve('dsh-context/client'))
  const renderer = load<Plugin>(require.resolve('@deepseek-ai/dsh-client-ui-renderer/client'))
  const ctx = new Context()
  locale(ctx)
  let tree: ReactTestRenderer | undefined
  try {
    await ctx.plugin(renderer)
    let binding: any = { key: 'A', ctx, hooks: {}, keyedHooks: {}, props: { sessionId: 'A' } }
    ctx.slots.installLocale({ getSnapshot: () => ({ revision: 0 }), subscribe: () => () => {}, bind: () => (key: string) => key } as any)
    const listeners = new Set<() => void>()
    const current = { getSnapshot: () => binding, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } } }
    ctx.slots.installScope('session', { current, bindingSource: () => current, renderArea: (_binding, props) => props.children })
    ctx.slots.register({ name: 'root', children: {
      'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
      'conversation.view': { kind: 'list', scope: 'session' },
      'conversation.input.overlay': { kind: 'list', scope: 'session' },
      'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
      'shell.overlay': { kind: 'list', scope: 'root' },
      'main': { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
    } } as any, ({ renderSlot }: any) => {
      const [panel, setPanel] = useState(false)
      return createElement(Fragment, null,
        createElement('button', { onClick: () => setPanel(true) }, '洞察'),
        panel ? renderSlot('main', {}, { entryKey: 'dsh-context' }) : createElement(Fragment, null,
          renderSlot('conversation.input.overlay', {}), renderSlot('conversation.view', {})),
        renderSlot('shell.overlay', {}),
      )
    })
    const form = sessionForm({}, async () => {})
    ctx.provide('configForms', { get: () => form, whileServed: (_ids: any, mount: any) => mount() } as any)
    await ctx.plugin(Loader)
    ctx.loader.import = async () => original
    await ctx.loader.root.update([{ id: 'dsh-context', name: 'dsh-context' }])
    await ctx.loader.await()
    const api = { list: async (scope: Scope) => ({ ok: true, value: [{
      id: 'dsh-context', package: 'dsh-context', name: 'dsh-context', settings: 'registered', managed: true,
      source: scope, enabled: scope.id === 'A', own: true, config: { defaultPlacement: 'all', fleetTab: 'show' },
    }] }) }
    ctx.provide('remote', { $mount: async () => () => {}, tieredPluginMenu: api } as any)
    ctx.provide('remote.tieredPluginMenu', api as any)
    ctx.provide('pluginNavigation', { openBundle() {} } as any)
    const menuFiber = await ctx.plugin(bundled)
    await ctx.loader.await()
    assert.equal(ctx.slots.entries('conversation.view').filter(entry => entry.options.id === 'tiered-plugin-menu.settings').length, 1)
    await act(async () => { tree = create(createElement(Fragment, null, ctx.slots.renderSlot('root', {}))) })
    assert.equal(ctx.slots.entries('conversation.view').filter(entry => entry.options.id !== 'tiered-plugin-menu.settings').length, 2)
    assert.equal(ctx.slots.entries('main').length, 1)
    assert.ok(tree!.root.findAll(node => node.props.className === 'lc-root').length, '实际渲染上下文页面')
    await act(async () => { tree!.root.findAllByType('button').find(button => button.children[0] === '洞察')!.props.onClick() })
    assert.equal(ctx.slots.entries('main').length, 1, '离开对话页不能卸载刚打开的洞察页')
    assert.ok(tree!.root.findAllByType('h1').some(node => node.children.includes('ov.title')), '实际渲染洞察页面')
    await act(async () => {
      binding = { ...binding, key: 'B', props: { sessionId: 'B' } }
      listeners.forEach(fn => fn())
    })
    assert.equal(ctx.slots.entries('main').length, 0, 'B 关闭插件，才应移除洞察')
    await act(async () => { tree!.unmount() })
    await menuFiber.dispose()
    assert.equal(ctx.slots.entries('conversation.view').some(entry => entry.options.id === 'tiered-plugin-menu.settings'), false)
  } finally {
    await act(async () => { tree?.unmount() })
    await ctx.fiber.dispose(); dom.window.close()
    globalThis.fetch = originalFetch
  }
})
