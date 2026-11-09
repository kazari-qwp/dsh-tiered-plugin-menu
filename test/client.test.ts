import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { captureSettings } from '../src/client/capture.ts'
import { sessionForm } from '../src/client/form.ts'
import { LevelSettings, MenuDialog } from '../src/client/menu.tsx'
import type { MenuRemote } from '../src/remote-contract.ts'
import { withChangePlans } from './menu-api.ts'
import { ContextClient, RegisteredSettings } from '../src/client/context-client.tsx'
import { childScope, clientScope, isClientScope, scopeKey, type PluginRow, type Scope } from '../src/shared.ts'

function originalClient(): Plugin {
  const require = createRequire(import.meta.url)
  const source = readFileSync(require.resolve('dsh-temporary-messages/client'), 'utf8')
  let plugin!: Plugin
  new Function('window', source)({ __ModuleLoader__: { load: ({ factory }: { factory: (require: NodeJS.Require) => Plugin }) => { plugin = factory(require) } } })
  return plugin
}

test('复用原设置页：工作区/会话独立入口分别保存，取消覆盖，设置页选择工作区', { timeout: 10000 }, async () => {
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
    await act(async () => { tree!.update(createElement(LevelSettings, { api, Page: captured.Page, ui, close() {} })) })
    assert.equal(tree!.root.findByProps({ 'data-mode': 'inherit' }).props.disabled, true)
    await act(async () => { button('工作区').props.onClick() })
    assert.equal(tree!.root.findByProps({ 'aria-label': '选择工作区' }).props.value, 'one')
    await act(async () => { button('设置').props.onClick() })
    assert.equal(tree!.root.findByProps({ id: 'temporary-template' }).props.value, 'WORKSPACE ONE')
    await act(async () => { button('下级').props.onClick() })
    assert.equal(tree!.root.findByProps({ 'aria-label': '下级默认配置方式' }).findAllByType('button')[0]!.props['aria-pressed'], true)
    assert.equal(tree!.root.findByProps({ 'data-mode': 'on' }).props.disabled, true)
    await act(async () => { button('独立').props.onClick() })
    await mode('on')
    await act(async () => { button('仍然启用').props.onClick() })
    await saveTemplate('NEW SESSIONS ONLY')
    assert.equal(saved.get(scopeKey(childScope(workspace)))!.config.template, 'NEW SESSIONS ONLY')
    assert.equal(saved.get(scopeKey(workspace))!.config.template, 'WORKSPACE ONE')
    await act(async () => { button('本级').props.onClick() })
    await act(async () => { button('设置').props.onClick() })
    assert.equal(tree!.root.findByProps({ id: 'temporary-template' }).props.value, 'WORKSPACE ONE')
    await captured.dispose()
  } finally { await act(async () => { tree?.unmount() }); await controller?.dispose(); await ctx.fiber.dispose() }
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
