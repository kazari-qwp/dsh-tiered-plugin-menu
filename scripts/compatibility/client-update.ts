// Run only in the disposable offline VM. Pass the replacement dsh-context/client file.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type * as Modules from '@deepseek-ai/dsh-client-modules/client'
import { JSDOM } from 'jsdom'
import { createElement, act } from 'react'
import { create, type ReactTestRenderer } from 'react-test-renderer'
import { sessionForm } from '../../packages/web/src/client/form.ts'
import type { Scope } from '../../packages/core/src/shared.ts'

const require = createRequire(import.meta.url)
const replacement = process.argv[2]
assert.ok(replacement, 'Pass the replacement client.js as the first argument')
const primitives = { Menu: ({ anchor }: any) => anchor, PluginArtworkDefault: () => null }
function load<T>(filename: string): T {
  let exported!: T
  new Function('window', readFileSync(filename, 'utf8'))({ __ModuleLoader__: {
    load: ({ factory }: any) => { exported = factory((id: string) => id === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : require(id)) },
  } })
  return exported
}

for (const managed of [false, true]) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' })
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location,
    MutationObserver: dom.window.MutationObserver })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({})
  const modules = load<typeof Modules>(require.resolve('@deepseek-ai/dsh-client-modules/client'))
  let file = require.resolve('dsh-context/client')
  const pendingQueue: Modules.ClientBundleRegistration[] = []
  const target: Modules.ClientModuleLoaderTarget = {
    mode: 'queue', pendingQueue, load: entry => { pendingQueue.push(entry) },
    create: options => modules.createClientModuleSystem(target, { id: '@deepseek-ai/dsh-client-modules', exports: modules }, options),
  }
  const register = () => new Function('window', readFileSync(file, 'utf8'))({ __ModuleLoader__: target })
  register()
  const graph = (rev: string, present = true) => ({ rev,
    entries: present ? [{ id: 'dsh-context', url: `context.js?rev=${rev}`, rev }] : [],
    batches: present ? [{ phase: 'application', url: `all.js?rev=${rev}`, rev, entries: ['dsh-context'] }] : [] })
  const manifest = modules.parseBootManifest(graph('old'))
  const staticModules = Object.fromEntries(['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/cordis'].map(id => [id, require(id)]))
  staticModules['@deepseek-ai/dsh-client-ui-primitives'] = primitives
  const system = new modules.ClientModuleSystem({ manifest, registrationTarget: target,
    bootstrapModule: { id: '@deepseek-ai/dsh-client-modules', exports: modules }, staticModules,
    loadBundle: async () => { register() },
  })
  const ctx = new Context()
  let settings: ReactTestRenderer | undefined
  let insight: ReactTestRenderer | undefined
  try {
    await ctx.plugin(load<Plugin>(require.resolve('@deepseek-ai/dsh-client-ui-renderer/client')))
    ctx.slots.register({ name: 'root', children: {
      'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
      'conversation.view': { kind: 'list', scope: 'session' },
      'conversation.input.overlay': { kind: 'list', scope: 'session' },
      'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
      'shell.overlay': { kind: 'list', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
      'main': { kind: 'keyed', scope: 'root' },
    } } as any, () => null)
    ctx.provide('locale', { register: () => () => {}, bind: () => (key: string) => key,
      getLocale: () => ({ active: 'zh-CN' }), subscribe: () => () => {} } as any)
    const globalForm = sessionForm({ promptPrefix: 'CLIENT', defaultPlacement: 'all', fleetTab: 'show' }, async () => {})
    ctx.provide('configForms', { get: () => globalForm, whileServed: (_ids: any, mount: any) => mount() } as any)
    const row = (scope: Scope) => ({ id: 'dsh-context', package: 'dsh-context', name: 'Context', settings: 'registered', managed: true,
      source: scope, enabled: scope.id === 'A', own: true,
      config: { promptPrefix: scope.id === 'A' ? 'SESSION A' : 'CLIENT', defaultPlacement: 'all', fleetTab: 'show' } })
    const api = { list: async (scope: Scope) => ({ ok: true, value: [row(scope)] }) }
    ctx.provide('remote', { $mount: async () => () => {}, tieredPluginMenu: api } as any)
    ctx.provide('remote.tieredPluginMenu', api as any)
    ctx.provide('pluginNavigation', { openBundle() {} } as any)
    await ctx.plugin(Loader)
    ctx.loader.import = async name => system.import(name)
    ctx.provide('modules', system as any)
    await system.entries.start(ctx.loader, manifest)
    if (managed) {
      await ctx.plugin(load<Plugin>(process.argv[3] ?? 'packages/web/dist/client/index.js'))
      await ctx.loader.await()
      const observer = ctx.slots.entries('tiered-plugin-menu.active-session' as any)[0]!
      const controller = (observer.inject!() as any).controller
      await controller.select('A')
      const ui = (ctx.slots.entries('shell.overlay').find(e => e.options.id === 'tiered-plugin-menu')!.inject!() as any).ui
      await act(async () => { settings = create(createElement(ui.Settings, { row: row({ level: 'session', id: 'A' }), scope: { level: 'session', id: 'A' } })) })
      assert.equal(settings!.root.findAllByType('textarea')[0]!.props.value, 'SESSION A')
    }
    const oldMain = ctx.slots.entries('main')[0]!.component
    const oldCss = [...document.querySelectorAll('style[data-plugin="dsh-context"]')]
    assert.ok(oldCss.length)
    file = replacement
    await act(async () => {
      await system.entries.sync(graph('new'))
      await ctx.loader.await()
      for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve))
    })
    assert.ok(oldCss.every(style => !style.isConnected), 'old stylesheet removed')
    const css = [...document.querySelectorAll('style[data-plugin="dsh-context"]')]
    assert.ok(css.length && css.every(style => style.textContent!.length > 100), 'replacement styles loaded')
    assert.equal(ctx.slots.entries('conversation.view').length, 2)
    assert.equal(ctx.slots.entries('main').length, 1)
    const updatedMain = ctx.slots.entries('main')[0]!
    assert.notEqual(updatedMain.component, oldMain, 'replacement Insights component is mounted')
    await act(async () => { insight = create(createElement(updatedMain.component as any, updatedMain.inject?.())) })
    assert.ok(insight!.root.findAllByType('h1').some(node => node.children.includes('ov.title')), 'replacement Insights renders')
    await act(async () => insight!.unmount())
    if (managed) assert.equal(settings!.root.findAllByType('textarea')[0]!.props.value, 'SESSION A')
    assert.equal(globalForm.getSnapshot().value!.promptPrefix, 'CLIENT')
    await act(async () => {
      await system.entries.sync(graph('removed', false))
      for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve))
    })
    assert.equal(ctx.slots.entries('main').length, 0)
    assert.equal(document.querySelectorAll('style[data-plugin="dsh-context"]').length, 0)
    await act(async () => {
      await system.entries.sync(graph('restored'))
      for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve))
    })
    assert.equal(ctx.slots.entries('conversation.view').length, 2)
    assert.equal(ctx.slots.entries('main').length, 1)
    assert.ok(document.querySelectorAll('style[data-plugin="dsh-context"]').length)
    if (managed) assert.equal(settings!.root.findAllByType('textarea')[0]!.props.value, 'SESSION A')
    console.log(`${managed ? 'Menu session' : 'Native control'}: update, original CSS, Insights render, settings, remove/re-add — PASS`)
  } finally {
    await act(async () => { settings?.unmount(); insight?.unmount() })
    await ctx.fiber.dispose()
    dom.window.close()
    globalThis.fetch = originalFetch
  }
}
