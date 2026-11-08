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

test('官方模块卸载：两种加载顺序下，关闭全局或菜单均不删除另一方的样式', async () => {
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
    for (const filename of ['dist/client/index.js', require.resolve('dsh-context/client')]) {
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
      assert.deepEqual(contextStyles(menuId), expected, '私有副本完整保留原版所有样式内容')
      await system.entries.sync(graph(order.filter(id => id !== removed)))
      assert.deepEqual(system.entries.state.getSnapshot().failures, [])
      assert.ok([...document.querySelectorAll('style')].some(style => style.textContent === stats),
        `先加载 ${first}，卸载 ${removed} 后 stats.css 仍应存在`)
      const remaining = removed === menuId ? contextId : menuId
      assert.ok(document.querySelector(`style[data-plugin="${remaining}"][data-plugin-css$="/stats.css"]`))
      assert.deepEqual(contextStyles(remaining), expected, '卸载后所有样式均保留')
    } finally { await ctx.fiber.dispose(); dom.window.close() }
  }
})
