import { Context, type Plugin } from '@deepseek-ai/cordis'
import { createElement, useSyncExternalStore, type ComponentType } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PluginConfig } from '../shared.ts'
import { isolateProvidedServices } from '../isolation.ts'

let nextCapture = 0

/** 只接收原插件注册到插件详情页的配置卡；其余 UI/命令注册不进入客户端。 */
export async function captureRegisteredSettings(root: Context, plugin: Plugin, namespace: string, form: ConfigForm<PluginConfig>, remote?: (ctx: Context) => any, packageName = namespace) {
  let isolated = root
  for (const name of ['slots', 'configForms', 'locale']) isolated = isolated.isolate(name)
  const locale: any = root.get('locale')
  const dictionary = `${namespace}:tiered-settings:${++nextCapture}`
  let captured: { component: ComponentType<any>; inject?: () => Record<string, any>; priority: number } | undefined
  const settingsSlots = ['plugins.bundle.config', 'plugins.row.config', 'settings.section', 'settings.general.item']
  if (remote) isolated = isolated.isolate('remote')
  isolated = isolateProvidedServices(isolated, Object.create(isolated[Context.isolate]))
  const owner = await isolated.plugin((ctx: Context) => {
    ctx.provide('slots', {
      entries: () => [],
      inject: (name: string, mount: () => () => void) => settingsSlots.includes(name) ? mount() : () => {},
      register: (options: any, component: ComponentType<any>) => {
        const priority = options.name === 'plugins.row.config' && options.key?.split('#').at(-1) === namespace ? 3
          : options.name === 'plugins.bundle.config' && [namespace, packageName].includes(options.key) ? 2
          : ['settings.section', 'settings.general.item'].includes(options.name) ? 1 : 0
        if (priority > (captured?.priority ?? 0)) captured = { component, inject: options.inject, priority }
        return () => {}
      },
    })
    ctx.provide('configForms', { get: () => form, whileServed: (_ids: string[], mount: () => () => void) => mount() })
    if (remote) ctx.provide('remote', remote(ctx))
    ctx.provide('locale', {
      register: (_name: string, dicts: any) => locale?.register(dictionary, dicts),
      bind: () => locale?.bind(dictionary), getLocale: () => locale?.getLocale(), subscribe: (fn: () => void) => locale?.subscribe(fn),
    })
  })
  try {
    await owner.ctx.plugin(plugin)
    if (!captured) throw new Error(`${namespace} 没有注册插件配置卡`)
  } catch (error) { await owner.dispose(); throw error }
  const entry = captured
  const face = entry.inject?.() ?? {}
  const { hooks = {}, ...props } = face
  const hookProps = Object.fromEntries(Object.entries(hooks).map(([name, store]: [string, any]) => [
    `use${name[0]!.toUpperCase()}${name.slice(1)}`,
    (select: (snapshot: any) => unknown) => select(useSyncExternalStore(store.subscribe, store.getSnapshot)),
  ]))
  return { Page: () => {
    const state = useSyncExternalStore(form.subscribe, form.getSnapshot)
    return createElement(entry.component, { view: 'page', form: { ...form, state }, t: locale?.bind(dictionary), ...props, ...hookProps })
  }, dispose: owner.dispose }
}
