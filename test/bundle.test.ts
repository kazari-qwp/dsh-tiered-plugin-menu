import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createElement, Fragment, act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import * as ClientGateway from '@deepseek-ai/dsh-api-gateway/client'
import { installConnection } from '@deepseek-ai/dsh-client-connection/client'
import type * as Renderer from '@deepseek-ai/dsh-client-ui-renderer/client'
import type * as Modules from '@deepseek-ai/dsh-client-modules/client'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Scope } from '../packages/core/src/shared.ts'

test('打包客户端：侧栏按钮绑定正确层级，点击不切换行，弹窗独立于悬停区域', { timeout: 10000 }, async () => {
  const dom = new JSDOM('<!doctype html><html><body><main id="app"></main></body></html>')
  const previous = { window: globalThis.window, document: globalThis.document, MutationObserver: globalThis.MutationObserver }
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true })
  const { createRoot } = await import('react-dom/client')
  const require = createRequire(import.meta.url)
  const load = <T,>(filename: string, modules: Record<string, unknown> = {}): T => {
    let exports!: T
    new Function('window', readFileSync(filename, 'utf8'))({ __ModuleLoader__: {
      load: ({ factory }: { factory: (lookup: (id: string) => unknown) => T }) => {
        exports = factory(id => modules[id] ?? require(id))
      },
    } })
    return exports
  }
  // 冷启动仅启用菜单：模块图里没有临时消息，设置组件也必须能加载。
  const modules = load<typeof Modules>(require.resolve('@deepseek-ai/dsh-client-modules/client'))
  const registrations: Modules.ClientBundleRegistration[] = []
  const target: Modules.ClientModuleLoaderTarget = {
    mode: 'queue', pendingQueue: registrations,
    load: entry => { registrations.push(entry) },
    create: options => modules.createClientModuleSystem(target, { id: '@deepseek-ai/dsh-client-modules', exports: modules }, options),
  }
  new Function('window', readFileSync(fileURLToPath(new URL('../packages/web/dist/client/index.js', import.meta.url)), 'utf8'))({ __ModuleLoader__: target })
  const moduleLoader = new modules.ClientModuleSystem({
    manifest: { rev: 'test', modules: [{ id: 'dsh-tiered-plugin-menu', url: 'menu.js', initialUrl: 'menu.js', rev: 'test', inject: [], external: [] }], plugins: [] },
    registrationTarget: target,
    bootstrapModule: { id: '@deepseek-ai/dsh-client-modules', exports: modules },
    staticModules: {
      ...Object.fromEntries(['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/cordis'].map(name => [name, require(name)])),
      '@deepseek-ai/dsh-client-ui-primitives': { PluginArtworkDefault: ({ size }: { size: number }) => createElement('svg', { width: size, height: size }) },
    },
  })
  const plugin = await moduleLoader.import('dsh-tiered-plugin-menu') as Plugin
  const renderer = load<typeof Renderer>(require.resolve('@deepseek-ai/dsh-client-ui-renderer/client'))
  const ctx = new Context()
  let tree: Root | undefined
  let rowClicks = 0
  let searchClicks = 0
  const listed: Scope[] = []
  const configured: Scope[] = []
  const details: string[] = []
  try {
    ctx.provide('pluginNavigation', { openBundle: (name: string) => { details.push(name) } })
    await ctx.plugin(TypertRegistry)
    installConnection(ctx, { interactions: 'none', transport: { rpc: {
      async call(_channel, endpoint, payload) {
        if (endpoint.endsWith('/saveConfig')) {
          configured.push((payload as { args: { scope: Scope } }).args.scope)
          return { ok: true, value: undefined }
        }
        if (endpoint.endsWith('/list')) {
          const scope = (payload as { args: { scope: Scope } }).args.scope
          listed.push(scope)
          return { ok: true, value: [{
            id: 'temporary-messages', name: '临时消息', own: true, source: scope, enabled: true, active: true,
            verified: false, settings: 'native',
            package: 'dsh-temporary-messages', description: '临时上下文消息',
            config: { template: 'FROM BUNDLE', enabled: true, defaultTtlTokens: 0, defaultK: false, compressor: 'identity' },
          }] }
        }
        return { ok: true, value: endpoint.endsWith('/context')
          ? { workspaceId: 'one', workspaces: [{ id: 'one', title: '工作区一', path: '/one' }] }
          : { sessions: ['A'], tools: [], compressors: [{ id: 'identity', name: '保留原文', description: '' }] } }
      },
      async *open() {},
    } } })
    await ctx.plugin(ClientGateway)
    await ctx.plugin(renderer)
    const binding = { key: 'A', ctx, hooks: {}, keyedHooks: {}, props: { sessionId: 'A' } }
    const current = { getSnapshot: () => binding, subscribe: () => () => {} }
    ctx.slots.installScope('session', { current, bindingSource: () => current, renderArea: (_binding, props) => props.children })
    ctx.slots.register({ name: 'root', children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'sidebar.workspaces.session.row.action': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    } }, ({ renderSlot }) => createElement(Fragment, null,
      renderSlot('settings.section', { close() {} }),
      createElement('div', { 'data-slot': 'sidebar.workspaces' },
        createElement('div', { id: 'workspace-header' },
          createElement('span', null, '工作区'),
          createElement('div', { id: 'workspace-search-slot' },
            createElement('div', { onClick: () => searchClicks++ },
              createElement('button', { 'aria-expanded': false }, '搜索'),
              createElement('input', { maxLength: 100 }),
            ),
          ),
        ),
      ),
      createElement('div', { 'data-row-key': 'workspace:one', onClick: () => rowClicks++ },
        createElement('span', null, '工作区一'),
        createElement('span', { id: 'workspace-actions' }, createElement('button', { 'data-context-menu-trigger': '' }, '…')),
      ),
      createElement('div', { 'data-row-key': 'session:A', onClick: () => rowClicks++ },
        createElement('span', { id: 'session-actions' },
          renderSlot('sidebar.workspaces.session.row.action', { sessionId: SessionId('A'), displayTitle: '会话 A' })),
      ),
      renderSlot('shell.overlay', {}),
    ))
    const fiber = await ctx.plugin(plugin)
    await act(async () => {
      tree = createRoot(document.getElementById('app')!)
      tree.render(createElement(Fragment, null, ctx.slots.renderSlot('root', {})))
    })
    assert.equal(document.querySelectorAll('[data-slot-error]').length, 0)
    assert.equal(document.querySelector('h2')!.textContent, '分级插件菜单')
    assert.equal(ctx.slots.entries('conversation.session.header.actions').length, 0)
    const click = async (selector: string) => act(async () => {
      const button = document.querySelector<HTMLButtonElement>(selector)
      assert.ok(button, selector)
      button.click()
    })
    await click('#workspace-header button[aria-label="客户端插件"]')
    assert.equal(searchClicks, 0)
    assert.equal(document.querySelector('.tiered-client-action')!.nextElementSibling!.id, 'workspace-search-slot')
    assert.deepEqual(listed.at(-1), { level: 'client', id: '' })
    assert.equal(document.querySelector('[role="dialog"]')!.getAttribute('aria-label'), '客户端插件')
    assert.equal(document.querySelector<HTMLButtonElement>('[role="dialog"] [data-mode="inherit"]')!.disabled, true)
    assert.equal(document.querySelector('[role="dialog"] .tiered-card-description')!.textContent, '临时上下文消息')
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(button => button.textContent === '设置')!.click()
    })
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(button => button.textContent === '保存设置')!.click()
    })
    assert.deepEqual(configured.at(-1), { level: 'client', id: '' })
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(button => button.textContent === '关闭')!.click()
    })
    await click('#workspace-actions button[aria-label="工作区插件"]')
    assert.equal(rowClicks, 0)
    assert.deepEqual(listed.at(-1), { level: 'workspace', id: 'one' })
    assert.equal(document.querySelector('[role="dialog"]')!.getAttribute('aria-label'), '工作区插件')
    assert.equal(document.querySelector('[data-row-key] [role="dialog"]'), null)
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(button => button.textContent === '关闭')!.click()
    })
    await click('#session-actions button[aria-label="会话插件"]')
    assert.equal(rowClicks, 0)
    assert.deepEqual(listed.at(-1), { level: 'session', id: 'A' })
    assert.equal(document.querySelector('[role="dialog"]')!.getAttribute('aria-label'), '会话插件')
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(button => button.textContent === '设置')!.click()
    })
    assert.equal(JSON.parse(document.querySelector<HTMLTextAreaElement>('[aria-label="本层独立配置（JSON）"]')!.value).template, 'FROM BUNDLE')
    assert.equal(document.querySelectorAll('#workspace-actions .tiered-plugin-button').length, 1)
    assert.deepEqual(details, [], '开关和设置按钮不应触发详情导航')
    await click('[role="dialog"] .tiered-card-open')
    assert.deepEqual(details, [], '包条目先进入本层组件详情')
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(button => button.textContent === '查看原生插件详情')!.click()
    })
    assert.deepEqual(details, ['dsh-temporary-messages'])
    assert.equal(document.querySelector('[role="dialog"]'), null, '进入官方详情页时关闭浮层')
    await act(async () => { await fiber.dispose() })
    assert.equal(document.querySelectorAll('.tiered-plugin-button').length, 0)
    assert.ok(document.querySelector('#workspace-actions [data-context-menu-trigger]'))
    assert.ok(document.querySelector('#workspace-search-slot input'))
  } finally {
    await act(async () => { tree?.unmount() })
    await ctx.fiber.dispose()
    dom.window.close()
    Object.assign(globalThis, previous)
  }
})
