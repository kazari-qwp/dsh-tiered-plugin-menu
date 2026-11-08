import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createElement, act } from 'react'
import { create, type ReactTestRenderer } from 'react-test-renderer'
import { JSDOM } from 'jsdom'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type * as Modules from '@deepseek-ai/dsh-client-modules/client'
import { sessionForm } from '../src/client/form.ts'
import type { Scope } from '../src/shared.ts'

const require = createRequire(import.meta.url)
function load<T>(filename: string): T {
  let exported!: T
  new Function('window', readFileSync(filename, 'utf8'))({ __ModuleLoader__: {
    load: ({ factory }: any) => { exported = factory((id: string) => id === '@deepseek-ai/dsh-client-ui-primitives' ? {} : require(id)) },
  } })
  return exported
}

test('native frontend replacement refreshes scoped panels, settings and CSS', async () => {
  for (const managed of [false, true]) {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' })
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location })
    const modules = load<typeof Modules>(require.resolve('@deepseek-ai/dsh-client-modules/client'))
    const pendingQueue: Modules.ClientBundleRegistration[] = []
    const target: Modules.ClientModuleLoaderTarget = {
      mode: 'queue', pendingQueue, load: entry => { pendingQueue.push(entry) },
      create: options => modules.createClientModuleSystem(target, { id: '@deepseek-ai/dsh-client-modules', exports: modules }, options),
    }
    const id = 'reload-fixture'
    let version = 1
    const register = () => {
      const revision = version
      target.load({ id, factory: () => {
        const style = document.createElement('style')
        style.dataset.pluginCss = `${id}/panel.css`
        style.textContent = `.reload-panel { --version: ${revision}; }`
        document.head.appendChild(style)
        return { name: id, inject: ['slots', 'configForms'], apply(ctx: Context) {
          const form = ctx.configForms.get<{ text: string }>(id)
          ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id },
            () => createElement('span', { 'data-panel-version': revision }, String(form.getSnapshot().value?.text))))
          ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: id },
            () => createElement('span', { 'data-settings-version': revision }, String(form.getSnapshot().value?.text))))
        } }
      } })
    }
    register()
    const graph = (rev: string, present = true) => ({ rev, entries: present ? [{ id, url: `${id}.js?rev=${rev}`, rev }] : [],
      batches: present ? [{ phase: 'application', url: `all.js?rev=${rev}`, rev, entries: [id] }] : [] })
    const manifest = modules.parseBootManifest(graph('one'))
    const system = new modules.ClientModuleSystem({ manifest, registrationTarget: target,
      bootstrapModule: { id: '@deepseek-ai/dsh-client-modules', exports: modules }, staticModules: {},
      loadBundle: async () => register(),
    })
    const ctx = new Context()
    let settings: ReactTestRenderer | undefined
    try {
      await ctx.plugin(load<Plugin>(require.resolve('@deepseek-ai/dsh-client-ui-renderer/client')))
      ctx.slots.register({ name: 'root', children: {
        'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
        'conversation.view': { kind: 'list', scope: 'session' },
        'shell.overlay': { kind: 'list', scope: 'root' },
        'settings.section': { kind: 'list', scope: 'root' },
      } } as any, () => null)
      ctx.provide('locale', { register: () => () => {}, bind: () => (key: string) => key,
        getLocale: () => 'en', subscribe: () => () => {} } as any)
      ctx.provide('configForms', { get: () => sessionForm({ text: 'CLIENT' }, async () => {}), whileServed: (_ids: any, mount: any) => mount() } as any)
      const row = (scope: Scope) => ({ id, package: id, name: id, settings: 'registered', managed: true,
        source: scope, enabled: scope.id === 'A', own: true, config: { text: scope.id === 'A' ? 'SESSION A' : 'CLIENT' } })
      const api = { list: async (scope: Scope) => ({ ok: true, value: [row(scope)] }) }
      ctx.provide('remote', { $mount: async () => () => {}, tieredPluginMenu: api } as any)
      ctx.provide('remote.tieredPluginMenu', api as any)
      ctx.provide('pluginNavigation', { openBundle() {} } as any)
      await ctx.plugin(Loader)
      ctx.loader.import = async name => system.import(name)
      ctx.provide('modules', system as any)
      await system.entries.start(ctx.loader, manifest)
      if (managed) {
        await ctx.plugin(load<Plugin>('dist/client/index.js'))
        await ctx.loader.await()
        const observer = ctx.slots.entries('tiered-plugin-menu.active-session' as any)[0]!
        const controller = (observer.inject!() as any).controller
        await controller.select('A')
        const ui = (ctx.slots.entries('shell.overlay').find(e => e.options.id === 'tiered-plugin-menu')!.inject!() as any).ui
        await act(async () => { settings = create(createElement(ui.Settings, { row: row({ level: 'session', id: 'A' }), scope: { level: 'session', id: 'A' } })) })
        assert.equal(settings!.root.findByProps({ 'data-settings-version': 1 }).children[0], 'SESSION A')
      }
      assert.match(document.querySelector('style')!.textContent!, /--version: 1/)
      version = 2
      await act(async () => {
        await system.entries.sync(graph('two'))
        await ctx.loader.await()
        for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve))
      })
      assert.match(document.querySelector('style')!.textContent!, /--version: 2/, `managed=${managed}: new stylesheet`)
      const panels = ctx.slots.entries('conversation.view')
      assert.equal(panels.length, 1, `managed=${managed}: exactly one current panel`)
      let panel!: ReactTestRenderer
      await act(async () => { panel = create(createElement(panels[0]!.component as any)) })
      assert.equal(panel.root.findByProps({ 'data-panel-version': 2 }).children[0], managed ? 'SESSION A' : 'CLIENT')
      await act(async () => panel.unmount())
      if (managed) assert.equal(settings!.root.findByProps({ 'data-settings-version': 2 }).children[0], 'SESSION A')
      // An install can briefly remove the package from the host graph before adding the replacement.
      await act(async () => {
        await system.entries.sync(graph('removed', false))
        for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve))
      })
      assert.equal(document.querySelectorAll('style[data-plugin="reload-fixture"]').length, 0)
      assert.equal(ctx.slots.entries('conversation.view').length, 0, 'no stale unstyled panel while the package is absent')
      version = 3
      await act(async () => {
        await system.entries.sync(graph('three'))
        for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve))
      })
      assert.match(document.querySelector('style')!.textContent!, /--version: 3/)
      const restored = ctx.slots.entries('conversation.view')
      assert.equal(restored.length, 1)
      await act(async () => { panel = create(createElement(restored[0]!.component as any)) })
      assert.equal(panel.root.findByProps({ 'data-panel-version': 3 }).children[0], managed ? 'SESSION A' : 'CLIENT')
      await act(async () => panel.unmount())
      if (managed) assert.equal(settings!.root.findByProps({ 'data-settings-version': 3 }).children[0], 'SESSION A')
    } finally {
      await act(async () => settings?.unmount())
      await ctx.fiber.dispose()
      dom.window.close()
    }
  }
})
