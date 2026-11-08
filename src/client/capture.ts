import type { ComponentType } from 'react'
import type { Context, Plugin } from '@deepseek-ai/cordis'

// 在隔离入口里加载原客户端插件，取得它自己注册的设置组件，不复制页面源码。
export async function captureSettings(ctx: Context, plugin: Plugin, namespace: string) {
  let accept!: (component: ComponentType<any>) => void
  const captured = new Promise<ComponentType<any>>(resolve => { accept = resolve })
  let isolated = ctx
  for (const name of ['slots', 'configForms', 'remote', `remote.${namespace}`]) isolated = isolated.isolate(name)
  const owner = await isolated.plugin((child: Context) => {
    child.provide('slots', {
      inject: (_name: string, mount: () => () => void) => mount(),
      register: (_options: unknown, component: ComponentType<any>) => { accept(component); return () => {} },
    })
    child.provide('configForms', { get: () => ({}), whileServed: (_ids: string[], mount: () => () => void) => mount() })
    child.provide('remote', { $mount: async () => () => {}, [namespace]: {} })
    child.provide(`remote.${namespace}`, {})
  })
  await owner.ctx.plugin(plugin)
  return { Page: await captured, dispose: owner.dispose }
}
