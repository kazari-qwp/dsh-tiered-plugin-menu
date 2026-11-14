import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { captureSettings } from '../packages/web/src/client/capture.ts'
import { sessionForm } from '../packages/web/src/client/form.ts'
import { LevelSettings, MenuDialog, ScopePanel } from '../packages/web/src/client/menu.tsx'
import type { MenuRemote } from '../packages/core/src/remote-contract.ts'
import { MenuModel } from '../packages/core/src/model.ts'
import { withChangePlans } from './menu-api.ts'
import { ContextClient, RegisteredSettings } from '../packages/web/src/client/context-client.tsx'
import { childScope, clientScope, isClientScope, scopeKey, type PluginRow, type Scope } from '../packages/core/src/shared.ts'

function originalClient(): Plugin {
  const require = createRequire(import.meta.url)
  const source = readFileSync(require.resolve('dsh-temporary-messages/client'), 'utf8')
  let plugin!: Plugin
  new Function('window', source)({ __ModuleLoader__: { load: ({ factory }: { factory: (require: NodeJS.Require) => Plugin }) => { plugin = factory(require) } } })
  return plugin
}

test('客户端整包开关跟随官方选择，组件详情保留独立开关，官方变化即时刷新', async () => {
  let enabled = true
  const first: PluginRow = { id: 'bundle#first', name: 'first', package: 'bundle', description: '',
    own: true, source: clientScope, enabled: false, active: false, verified: true, settings: 'native', config: {} }
  const rows = (): PluginRow[] => [{ ...first, id: 'bundle', name: 'bundle', bundleEnabled: enabled,
    partial: enabled, components: [first, { ...first, id: 'bundle#second', name: 'second', enabled }] }]
  const listeners = new Set<() => void>()
  const ui = { Artwork: () => null, openDetails() {}, subscribe(listener: () => void) {
    listeners.add(listener); return () => { listeners.delete(listener) }
  } }
  const api = { list: async (scope: Scope) => ({ ok: true, value: rows().map(row => scope.children ? { ...row, own: false, bundleEnabled: undefined } : row) }) } as unknown as MenuRemote
  let tree!: ReactTestRenderer
  try {
    await act(async () => { tree = create(createElement(ScopePanel, { api, scope: clientScope, Page: () => null, ui })) })
    assert.equal(tree.root.findByProps({ 'data-mode': 'on' }).props['aria-pressed'], true)
    enabled = false
    await act(async () => { for (const listener of listeners) listener() })
    assert.equal(tree.root.findByProps({ 'data-mode': 'off' }).props['aria-pressed'], true)
    enabled = true
    await act(async () => { for (const listener of listeners) listener() })
    assert.equal(tree.root.findByProps({ 'data-mode': 'on' }).props['aria-pressed'], true)
    await act(async () => tree.root.findByProps({ className: 'tiered-card-open' }).props.onClick())
    const firstSwitch = tree.root.findByProps({ 'aria-label': 'first配置方式' })
    assert.equal(firstSwitch.findByProps({ 'data-mode': 'off' }).props['aria-pressed'], true)
    const model = new MenuModel({ rows: async () => rows() } as any, null)
    assert.equal((await model.rows())[0]!.enabled, true, 'TUI/Go share native bundle selection')
    model.select({ scope: clientScope, kind: 'plugin', component: 'bundle' })
    assert.equal((await model.rows())[0]!.enabled, false, 'component view retains its override')
    await act(async () => { tree.update(createElement(ScopePanel, { key: 'children', api, scope: childScope(clientScope), Page: () => null, ui })) })
    assert.equal(tree.root.findByProps({ 'data-mode': 'inherit' }).props['aria-pressed'], true, 'inheriting a partially enabled bundle still selects Inherit')
  } finally { await act(async () => tree.unmount()) }
  assert.equal(listeners.size, 0)
})

test('官方和普通插件的 JSON 设置：关闭可保存，保存不修改开关', async () => {
  for (const official of [false, true]) {
    let row: PluginRow = { id: 'example', name: 'example', package: 'example', description: '',
      source: clientScope, own: true, enabled: false, active: false, verified: true, official, settings: 'native', config: { count: 1 } }
    const api = withChangePlans({
      context: async () => ({ ok: true, value: { workspaces: [], workspaceId: null } }),
      list: async () => ({ ok: true, value: [row] }),
      inherit: async () => ({ ok: true, value: undefined }),
      configure: async (_scope, _id, enabled, config) => { row = { ...row, enabled, config }; return { ok: true, value: undefined } },
    })
    let tree!: ReactTestRenderer
    try {
      await act(async () => { tree = create(createElement(ScopePanel, { api, scope: clientScope, kind: official ? 'official' : 'plugin',
        Page: () => null, ui: { Artwork: () => null, openDetails() {} } })) })
      const button = (text: string) => tree.root.findAllByType('button').find(node => node.children.includes(text))!
      assert.equal(button('设置').props.disabled, false)
      await act(async () => button('设置').props.onClick())
      const save = async (count: number) => {
        await act(async () => tree.root.findByType('textarea').props.onChange({ target: { value: JSON.stringify({ count }) } }))
        await act(async () => button('保存设置').props.onClick())
      }
      await save(2)
      assert.equal(row.enabled, false)
      assert.deepEqual(row.config, { count: 2 })
      await act(async () => tree.root.findByProps({ 'data-mode': 'on' }).props.onClick())
      await save(3)
      assert.equal(row.enabled, true)
      assert.deepEqual(row.config, { count: 3 })
      await act(async () => tree.root.findByProps({ 'data-mode': 'off' }).props.onClick())
      await save(4)
      assert.equal(row.enabled, false, '之前已打开的表单不恢复旧开关状态')
    } finally { await act(async () => tree.unmount()) }
  }
})

test('复用原设置页：工作区/会话独立入口分别保存，取消覆盖，下级默认配置', { timeout: 10000 }, async () => {
  const ctx = new Context()
  let tree: ReactTestRenderer | undefined
  let controller: ContextClient | undefined
  try {
    const captured = await captureSettings(ctx, originalClient(), 'temporaryMessagesUi')
    const opened: string[] = []
    const ui = { Artwork: () => createElement('svg'), openDetails: (name: string) => { opened.push(name) },
      Settings: ({ row, scope }: { row: PluginRow; scope: Scope }) => createElement(RegisteredSettings, { controller: controller!, row, scope }) }
    const base: PluginRow = { id: 'temporary-messages', name: '临时消息', source: clientScope, own: true, active: true, enabled: true,
      verified: false, settings: 'registered',
      package: 'dsh-temporary-messages', description: '临时上下文消息',
      config: { enabled: true, template: 'BASE', defaultTtlTokens: 0, defaultK: false, compressor: 'identity' } }
    const saved = new Map<string, PluginRow>()
    const workspace: Scope = { level: 'workspace', id: 'one' }
    const session: Scope = { level: 'session', id: 'A' }
    const api = withChangePlans({
      context: async () => ({ ok: true, value: { workspaceId: 'one', workspaces: [{ id: 'one', title: '工作区一', path: '/one' }] } }),
      list: async scope => ({ ok: true, value: [{ ...structuredClone(saved.get(scopeKey(scope)) ??
        (scope.level === 'session' ? saved.get(scopeKey(workspace)) : undefined) ?? base), own: isClientScope(scope) || saved.has(scopeKey(scope)) }] }),
      inherit: async scope => { saved.delete(scopeKey(scope)); return { ok: true, value: undefined } },
      configure: async (scope, _id, enabled, config) => {
        saved.set(scopeKey(scope), { ...base, source: scope, own: true, enabled, config })
        return { ok: true, value: undefined }
      },
    })
    api.call = async (_scope, _id, _namespace, method, args) => ({ ok: true, value: method === 'preview' ? `PREVIEW ${args.sessionId}` : {
      sessions: ['A'], tools: [], compressors: [{ id: 'identity', name: '保留原文', description: '原插件目录' }],
    } })
    controller = new ContextClient(ctx, api, originalClient(), base.id, base.package)
    await act(async () => { tree = create(createElement(MenuDialog, {
      api, Page: captured.Page, ui, target: { scope: { level: 'session', id: 'A' } }, onClose() {},
    })) })
    const button = (text: string) => tree!.root.findAllByType('button').find(node => node.children.includes(text))!
    const mode = async (value: string) => act(async () => {
      await tree!.root.findByProps({ 'data-mode': value }).props.onClick()
    })
    const saveTemplate = async (text: string) => {
      await act(async () => { button('设置').props.onClick() })
      await act(async () => { tree!.root.findByProps({ id: 'temporary-template' }).props.onChange({ target: { value: text } }) })
      await act(async () => { await button('保存设置').props.onClick() })
    }
    await mode('on')
    await act(async () => { button('仍然启用').props.onClick() })
    await saveTemplate('SESSION A')
    assert.equal(saved.get(scopeKey(session))!.config.template, 'SESSION A')
    await mode('off')
    assert.equal(button('设置').props.disabled, false, '关闭仍允许编辑')
    await act(async () => { tree!.root.findByProps({ id: 'temporary-template' }).props.onChange({ target: { value: 'SAVED WHILE OFF' } }) })
    await act(async () => { await button('保存设置').props.onClick() })
    assert.equal(saved.get(scopeKey(session))!.enabled, false, '已打开的原生配置页保存不改变关闭状态')
    assert.equal(saved.get(scopeKey(session))!.config.template, 'SAVED WHILE OFF')
    await mode('on')
    await act(async () => { button('仍然启用').props.onClick() })
    assert.equal(saved.get(scopeKey(session))!.config.template, 'SAVED WHILE OFF', '启用保留已保存的配置')
    await act(async () => { tree!.root.findByProps({ id: 'temporary-template' }).props.onChange({ target: { value: 'SESSION A' } }) })
    await act(async () => { await button('保存设置').props.onClick() })
    assert.equal(button('设置').props['aria-expanded'], true)
    await act(async () => { button('设置').props.onClick() })
    assert.equal(tree!.root.findAllByProps({ id: 'temporary-template' }).length, 0)
    await act(async () => { button('设置').props.onClick() })
    assert.equal(tree!.root.findByProps({ id: 'temporary-template' }).props.value, 'SESSION A')
    await act(async () => { tree!.root.findByProps({ id: 'temporary-session' }).props.onChange({ target: { value: 'A' } }) })
    await act(async () => { await button('运行预览').props.onClick() })
    assert.ok(tree!.root.findAllByType('pre').some(node => node.children.includes('PREVIEW A')))
    await act(async () => { tree!.root.findByProps({ id: 'temporary-compressor-tab' }).props.onClick() })
    assert.equal(tree!.root.findByProps({ id: 'temporary-compressor-panel' }).props.hidden, false)
    await act(async () => { tree!.update(createElement(MenuDialog, {
      api, Page: captured.Page, ui, target: { scope: workspace }, onClose() {},
    })) })
    await mode('on')
    await act(async () => { button('仍然启用').props.onClick() })
    await saveTemplate('WORKSPACE ONE')
    assert.equal(saved.get(scopeKey(workspace))!.config.template, 'WORKSPACE ONE')
    assert.equal(saved.get(scopeKey(session))!.config.template, 'SESSION A')
    await act(async () => { tree!.update(createElement(MenuDialog, {
      api, Page: captured.Page, ui, target: { scope: session }, onClose() {},
    })) })
    await mode('inherit')
    assert.equal(saved.has(scopeKey(session)), false)
    assert.equal(tree!.root.findByProps({ 'data-mode': 'inherit' }).props['aria-pressed'], true)
    assert.deepEqual(opened, [], '切换模式、展开设置均不进入详情页')
    await act(async () => { tree!.root.findByProps({ 'aria-label': '查看临时消息详情' }).props.onClick() })
    assert.deepEqual(opened, [], '先打开本层组件详情')
    await act(async () => { button('查看原生插件详情').props.onClick() })
    assert.deepEqual(opened, ['dsh-temporary-messages'])
    await act(async () => { tree!.update(createElement(MenuDialog, { api, Page: captured.Page, ui, target: { scope: workspace }, onClose() {} })) })
    await act(async () => { button('设置').props.onClick() })
    assert.equal(tree!.root.findByProps({ id: 'temporary-template' }).props.value, 'WORKSPACE ONE')
    await act(async () => { button('下级').props.onClick() })
    assert.equal(tree!.root.findAllByProps({ 'aria-label': '下级默认配置方式' }).length, 0)
    assert.equal(tree!.root.findByProps({ 'data-mode': 'on' }).props.disabled, false)
    await mode('on')
    await act(async () => { button('仍然启用').props.onClick() })
    await saveTemplate('NEW SESSIONS ONLY')
    assert.equal(saved.get(scopeKey(childScope(workspace)))!.config.template, 'NEW SESSIONS ONLY')
    assert.equal(saved.get(scopeKey(workspace))!.config.template, 'WORKSPACE ONE')
    await act(async () => { button('全部重置为继承').props.onClick() })
    assert.equal(saved.has(scopeKey(childScope(workspace))), false)
    assert.equal(tree!.root.findByProps({ 'data-mode': 'inherit' }).props['aria-pressed'], true)
    assert.equal(tree!.root.findByProps({ 'data-mode': 'on' }).props.disabled, false, '重置后仍可直接逐项修改')
    await act(async () => { button('本级').props.onClick() })
    await act(async () => { button('设置').props.onClick() })
    assert.equal(tree!.root.findByProps({ id: 'temporary-template' }).props.value, 'WORKSPACE ONE')
    await captured.dispose()
  } finally { await act(async () => { tree?.unmount() }); await controller?.dispose(); await ctx.fiber.dispose() }
})

test('菜单设置独立保存两个开关，插件隔离默认关闭并提示重启', async () => {
  const api = withChangePlans({ context: async () => ({ ok: true, value: { workspaces: [], workspaceId: null } }),
    list: async () => ({ ok: true, value: [] }), inherit: async () => ({ ok: true, value: undefined }),
    configure: async () => ({ ok: true, value: undefined }) })
  let changed = 0
  const ui = { Artwork: () => null, openDetails() {}, changed() { changed++ } }
  let tree!: ReactTestRenderer
  try {
    await act(async () => { tree = create(createElement(LevelSettings, { api, ui })) })
    assert.equal(tree.root.findAllByType('button').length, 2)
    assert.equal(tree.root.findAllByProps({ role: 'tablist' }).length, 0)
    const toggle = (label: string) => tree.root.findByProps({ 'aria-label': label })
    assert.equal(toggle('按工作区树继承').props['aria-checked'], true)
    assert.equal(toggle('插件隔离（实验性）').props['aria-checked'], false)
    await act(async () => { toggle('按工作区树继承').props.onClick() })
    assert.deepEqual(await api.settings(), { ok: true, value: { inheritWorkspaceTree: false, pluginIsolation: false } })
    assert.equal(changed, 1)
    await act(async () => { toggle('插件隔离（实验性）').props.onClick() })
    assert.deepEqual(await api.settings(), { ok: true, value: { inheritWorkspaceTree: false, pluginIsolation: true } })
    assert.match(JSON.stringify(tree.toJSON()), /重启 DSH 后生效/)
    await act(async () => { tree.unmount(); tree = create(createElement(LevelSettings, { api, ui })) })
    assert.equal(toggle('按工作区树继承').props['aria-checked'], false)
    assert.equal(toggle('插件隔离（实验性）').props['aria-checked'], true)
  } finally { await act(async () => tree.unmount()) }
})

test('两份配置表修改互不影响', async () => {
  const a = sessionForm({ template: 'A' }, async () => {})
  const b = sessionForm({ template: 'B' }, async () => {})
  await a.set('template', 'A2')
  assert.equal(a.getSnapshot().value?.template, 'A2')
  assert.equal(b.getSnapshot().value?.template, 'B')
})

test('分组和二次确认：取消无写入，确认才启用，客户端不弹确认，兼容声明统一适用下级', async () => {
  const calls: { scope: Scope; id: string; confirmed: boolean }[] = []
  const saved = new Set<string>()
  const ui = { Artwork: () => createElement('svg'), openDetails() {} }
  const packages = ['temporary', 'declared', 'context']
  const api = withChangePlans({
    context: async () => ({ ok: true, value: { workspaces: [], workspaceId: null } }),
    list: async scope => ({ ok: true, value: packages.map(id => ({
      id, name: id, package: id, description: id, source: scope, config: {}, active: false,
      own: scope.level === 'client' || saved.has(`${scopeKey(scope)}/${id}`),
      enabled: saved.has(`${scopeKey(scope)}/${id}`),
      verified: id === 'declared', settings: 'native' as const,
    })) }),
    configure: async (scope, id, _enabled, _config, confirmed) => {
      calls.push({ scope, id, confirmed })
      saved.add(`${scopeKey(scope)}/${id}`)
      return { ok: true, value: undefined }
    },
    inherit: async () => ({ ok: true, value: undefined }),
  })
  let tree: ReactTestRenderer | undefined
  const open = async (scope: Scope) => act(async () => {
    const element = createElement(MenuDialog, { api, Page: () => null, ui, target: { scope }, onClose() {} })
    if (tree) tree.update(element)
    else tree = create(element)
  })
  const enable = async (id: string) => act(async () => {
    tree!.root.findByProps({ 'aria-label': `${id}配置方式` }).findByProps({ 'data-mode': 'on' }).props.onClick()
  })
  const choose = async (text: string) => act(async () => {
    tree!.root.findAllByType('button').find(button => button.children.includes(text))!.props.onClick()
  })
  try {
    const workspace: Scope = { level: 'workspace', id: 'one' }
    await open(workspace)
    assert.equal(tree!.root.findAllByType('ul').length, 2)
    assert.equal(tree!.root.findAllByProps({ className: 'tiered-card-open' })[0]!.children[0], 'declared')
    assert.equal(tree!.root.findByProps({ role: 'separator' }).findByType('span').children[0], '未验证兼容性')
    await enable('temporary')
    assert.equal(tree!.root.findAllByProps({ role: 'alertdialog' }).length, 1)
    assert.equal(calls.length, 0)
    await choose('取消')
    assert.equal(calls.length, 0)
    assert.equal(saved.size, 0)
    await enable('temporary')
    await choose('仍然启用')
    assert.deepEqual(calls.at(-1), { scope: workspace, id: 'temporary', confirmed: true })
    await enable('declared')
    assert.equal(tree!.root.findAllByProps({ role: 'alertdialog' }).length, 0)
    assert.deepEqual(calls.at(-1), { scope: workspace, id: 'declared', confirmed: false })
    await open({ level: 'session', id: 'A' })
    await enable('declared')
    assert.equal(tree!.root.findAllByProps({ role: 'alertdialog' }).length, 0)
    await open(clientScope)
    assert.equal(tree!.root.findAllByProps({ role: 'separator' }).length, 0)
    assert.equal(tree!.root.findAllByType('ul').length, 1)
    await enable('context')
    assert.equal(tree!.root.findAllByProps({ role: 'alertdialog' }).length, 0)
    assert.deepEqual(calls.at(-1), { scope: clientScope, id: 'context', confirmed: false })
  } finally { await act(async () => tree?.unmount()) }
})
