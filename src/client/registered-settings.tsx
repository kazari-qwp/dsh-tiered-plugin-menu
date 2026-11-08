import { Context, type Plugin } from '@deepseek-ai/cordis'
import { createElement, useSyncExternalStore, type ComponentType } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PluginConfig } from '../shared.ts'

let nextCapture = 0

/** 只接收原插件注册到插件详情页的配置卡；其余 UI/命令注册不进入客户端。 */
export async function captureRegisteredSettings(root: Context, plugin: Plugin, namespace: string, form: ConfigForm<PluginConfig>) {
  let isolated = root
  for (const name of ['slots', 'configForms', 'locale']) isolated = isolated.isolate(name)
  const locale: any = root.get('locale')
  const dictionary = `${namespace}:tiered-settings:${++nextCapture}`
  let captured: { component: ComponentType<any>; inject?: () => Record<string, any> } | undefined
  const owner = await isolated.plugin((ctx: Context) => {
    ctx.provide('slots', {
      entries: () => [],
      inject: (name: string, mount: () => () => void) => name === 'plugins.bundle.config' ? mount() : () => {},
      register: (options: any, component: ComponentType<any>) => {
        if (options.name === 'plugins.bundle.config' && options.key === namespace) captured = { component, inject: options.inject }
        return () => {}
      },
    })
    ctx.provide('configForms', { get: () => form, whileServed: (_ids: string[], mount: () => () => void) => mount() })
    ctx.provide('locale', {
      register: (_name: string, dicts: any) => locale.register(dictionary, dicts),
      bind: () => locale.bind(dictionary), getLocale: () => locale.getLocale(), subscribe: (fn: () => void) => locale.subscribe(fn),
    })
  })
  const settingsOnly = owner.ctx.extend({ inject(deps: string[], callback: any) {
    return deps.every(name => name === 'configForms') ? owner.ctx.inject(deps, callback) : { dispose() {} }
  } })
  try {
    await settingsOnly.plugin(plugin)
    if (!captured) throw new Error(`${namespace} 没有注册插件配置卡`)
  } catch (error) { await owner.dispose(); throw error }
  const entry = captured
  const face = entry.inject?.() ?? {}
  const { hooks = {}, ...props } = face
  const hookProps = Object.fromEntries(Object.entries(hooks).map(([name, store]: [string, any]) => [
    `use${name[0]!.toUpperCase()}${name.slice(1)}`,
    (select: (snapshot: any) => unknown) => select(useSyncExternalStore(store.subscribe, store.getSnapshot)),
  ]))
  return { Page: () => createElement(entry.component, { ...props, ...hookProps }), dispose: owner.dispose }
}
