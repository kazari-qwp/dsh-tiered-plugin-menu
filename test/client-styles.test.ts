import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type * as Modules from '@deepseek-ai/dsh-client-modules/client'

const require = createRequire(import.meta.url)
const menuId = 'dsh-tiered-plugin-menu'
const contextId = 'dsh-context'

test('原生模块图管理第三方样式：菜单不内嵌副本，最后一个宿主实例卸载后才回收', async () => {
  for (const first of [menuId, contextId]) for (const removed of [menuId, contextId]) {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>')
    Object.assign(globalThis, { window: dom.window, document: dom.window.document })
    let modules!: typeof Modules
    new Function('window', readFileSync(require.resolve('@deepseek-ai/dsh-client-modules/client'), 'utf8'))({
      __ModuleLoader__: { load: ({ factory }: any) => { modules = factory(require) } },
    })
    const pendingQueue: Modules.ClientBundleRegistration[] = []
    const target: Modules.ClientModuleLoaderTarget = {
      mode: 'queue', pendingQueue, load: entry => { pendingQueue.push(entry) },
      create: options => modules.createClientModuleSystem(target, { id: '@deepseek-ai/dsh-client-modules', exports: modules }, options),
    }
    for (const filename of ['packages/web/dist/client/index.js', require.resolve('dsh-context/client')]) {
      new Function('window', readFileSync(filename, 'utf8'))({ __ModuleLoader__: target })
    }
    const order = [first, first === menuId ? contextId : menuId]
    const graph = (ids: string[]) => ({ rev: 'test', entries: ids.map(id => ({ id, url: `${id}.js`, rev: 'test' })),
      batches: [{ phase: 'application', url: 'all.js', rev: 'test', entries: ids }] })
    const manifest = modules.parseBootManifest(graph(order))
    const system = new modules.ClientModuleSystem({ manifest, registrationTarget: target,
      bootstrapModule: { id: '@deepseek-ai/dsh-client-modules', exports: modules },
      staticModules: { ...Object.fromEntries(['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/cordis'].map(id => [id, require(id)])),
        '@deepseek-ai/dsh-client-ui-primitives': {} },
    })
    const ctx = new Context()
    try {
      await ctx.plugin(Loader)
      // 用真实模块系统执行样式注入/回收；本项不挂载 UI，界面在组件测试中覆盖。
      ctx.loader.import = async id => { await system.import(id); return () => {} }
      await system.entries.start(ctx.loader, manifest)
      const stats = document.querySelector<HTMLStyleElement>('style[data-plugin-css$="/stats.css"]')!.textContent
      const contextStyles = (owner: string) => [...document.querySelectorAll<HTMLStyleElement>(`style[data-plugin="${owner}"]`)]
        .filter(style => style.dataset.pluginCss?.includes('dsh-context/')).map(style => style.textContent).sort()
      const expected = contextStyles(contextId)
      assert.equal(contextStyles(menuId).length, 0, '菜单不再内嵌第三方前端或样式')
      assert.ok(expected.length > 0)
      // Turning off the global instance does not remove the package while a lower host entry remains.
      await system.entries.sync(graph(order))
      assert.deepEqual(contextStyles(contextId), expected)
      await system.entries.sync(graph(order.filter(id => id !== removed)))
      assert.deepEqual(system.entries.state.getSnapshot().failures, [])
      if (removed === menuId) assert.deepEqual(contextStyles(contextId), expected, '卸载菜单不影响原生第三方样式')
      else assert.equal(contextStyles(contextId).length, 0, '最后一个宿主实例卸载后，由 DSH 回收原版样式')
    } finally { await ctx.fiber.dispose(); dom.window.close() }
  }
})
