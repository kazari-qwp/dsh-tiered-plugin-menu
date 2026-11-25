import type { Context, Plugin } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { PluginArtworkDefault, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import { coreRegistrationContribution, remoteContribution } from 'dsh-tiered-plugin-core/remote-contract'
import { ConversationSettings, LevelSettings, NativeSettings } from './menu.tsx'
import { createMenuState, MenuOverlay, NewSessionButton, SessionButton } from './sidebar.tsx'
import { createElement, useEffect, useState, type ReactElement } from 'react'
import { ContextClient, ActiveSession, RegisteredSettings } from './context-client.tsx'
import type { PluginRow, Scope } from 'dsh-tiered-plugin-core/shared'
import { ComponentVersions } from './component-versions.tsx'
import { coalesce, rowReader } from './refresh.ts'

export const inject = ['slots', 'remote']

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'tiered-plugin-menu.active-session': { kind: 'list'; scope: 'session-maybe' }
  }
}

export async function apply(ctx: Context): Promise<void> {
  const remote = ctx.get('remote') as TypertClientRemote
  const unmount = await remote.$mount(remoteContribution)
  ctx.effect(() => unmount)
  ctx.inject(['remote.pluginManager', 'pluginNavigation'], async child => {
    try {
      const stop = await remote.$mount(coreRegistrationContribution)
      child.effect(() => stop)
    } catch (error) { child.logger.debug('共享核心登记状态接口暂不可用：%s', error) }
    child.effect(() => child.slots.inject('plugins.detail.section', () => child.slots.register({
      name: 'plugins.detail.section', id: 'tiered-plugin-menu.component-versions',
      inject: () => ({ remote, open: (name: string) => child.pluginNavigation.openBundle(name) }),
    }, ComponentVersions)))
  })
  ctx.inject(['remote.tieredPluginMenu', 'pluginNavigation'], child => {
    const api = (child.get('remote') as TypertClientRemote).tieredPluginMenu
    const menu = createMenuState()
    const controllers = new Map<string, ContextClient>()
    const rows = rowReader(api)
    const listeners = new Set<() => void>()
    const stateListeners = new Set<() => void>()
    // 随选中的会话切换，打开洞察/设置等页面不卸载观察器。
    child.effect(() => child.slots.inject('shell.overlay', () => child.slots.register({
      name: 'shell.overlay', id: 'tiered-session-observers',
      children: { 'tiered-plugin-menu.active-session': { kind: 'list', scope: 'session-maybe' } },
    }, ({ renderSlot }) => renderSlot('tiered-plugin-menu.active-session', {}))))
    let discover = async () => {}
    child.inject(['remote.pluginManager'], native => {
      native.effect(() => remote.$on('plugin-manager/changed', () => {
        rows.invalidate()
        for (const listener of stateListeners) listener()
        void discover().catch(error => child.logger.error(error))
      }))
    })
    child.inject(['loader', 'configForms', 'locale'], async mounted => {
      const modules: any = mounted.get('modules')
      const sync = async () => {
        // 模块更新会先回收旧样式，再加载新工厂；等这一步结束后再接管前端。
        if (modules?.entries.state.getSnapshot().syncing) return
        const readRows = rows.snapshot()
        const result = await readRows({ level: 'client', id: '' })
        const entries = [...mounted.loader.entries()]
        for (const [name, controller] of controllers) {
          if (entries.some(entry => entry.options.name === name)) continue
          if (await controller.setPlugin(undefined, readRows)) for (const listener of listeners) listener()
        }
        for (const row of result.filter(row => row.settings === 'registered')) {
          if (row.package === remoteContribution.package) continue
          const entry = entries.find(entry => entry.options.name === row.package)
          if (!entry) continue
          // 普通 Loader 没有模块图通知；首次加载时仍通过 import 等待入口就绪。
          const namespace = entry.moduleNamespace ?? (!modules ? await mounted.loader.import(row.package) : undefined)
          if (!namespace) continue
          const original = mounted.loader.unwrapExports(namespace)
          const existing = controllers.get(row.package)
          if (existing) {
            if (await existing.setPlugin(original, readRows)) for (const listener of listeners) listener()
            await existing.refresh(readRows)
            continue
          }
          const controller = new ContextClient(mounted, api, original, row.id, row.package, rows.read)
          controllers.set(row.package, controller)
          for (const listener of listeners) listener()
          mounted.effect(() => () => controller.dispose())
          mounted.effect(() => mounted.slots.inject('tiered-plugin-menu.active-session', () => mounted.slots.register({
            name: 'tiered-plugin-menu.active-session', id: `tiered-observer:${row.id}`, order: -100,
            inject: () => ({ controller }),
          }, ActiveSession)))
          await controller.refresh(readRows)
          mounted.effect(() => mounted.configForms.get(row.configNamespace ?? row.id).subscribe(() => { void controller.refresh().catch(error => mounted.logger.error(error)) }))
        }
      }
      let live = true
      mounted.effect(() => () => { live = false })
      discover = coalesce(async () => { if (live) await sync() })
      if (modules) mounted.effect(() => modules.entries.state.subscribe(() => {
        if (!modules.entries.state.getSnapshot().syncing) void discover().catch(error => mounted.logger.error(error))
      }))
      mounted.on('loader/patch-context', async (entry, next) => {
        await next()
        if (entry.options.name !== remoteContribution.package) queueMicrotask(() => { void discover().catch(error => mounted.logger.error(error)) })
      })
      await discover()
    })
    function Settings({ row, scope }: { row: PluginRow; scope: Scope }): ReactElement {
      const binding = () => {
        const controller = controllers.get(row.package)
        return { controller, revision: controller?.revision ?? 0 }
      }
      const [{ controller, revision }, setBinding] = useState(binding)
      useEffect(() => {
        let live = true
        const update = () => { if (live) setBinding(binding()) }
        listeners.add(update)
        void discover().then(update)
        return () => { live = false; listeners.delete(update) }
      }, [row.id, row.config])
      const fallback = createElement(NativeSettings, { api, row, scope, ui, onSaved: discover })
      return controller ? createElement(RegisteredSettings, { key: revision, controller, row, scope, fallback }) : fallback
    }
    const ui = {
      copyText: writeClipboard,
      Artwork: PluginArtworkDefault,
      Settings,
      changed() { rows.invalidate(); void discover().catch(error => child.logger.error(error)) },
      subscribe(listener: () => void) { stateListeners.add(listener); return () => { stateListeners.delete(listener) } },
      openDetails(packageName: string) { menu.close(); child.pluginNavigation.openBundle(packageName) },
    }
    child.effect(() => child.slots.inject('settings.section', () => child.slots.register({
      name: 'settings.section', id: 'tiered-plugin-menu', order: 46,
      label: () => '分级插件菜单', inject: () => ({ api, ui }),
    }, LevelSettings)))
    child.effect(() => child.slots.inject('conversation.view', () => child.slots.register({
      name: 'conversation.view', id: 'tiered-plugin-menu.settings', order: 40,
      label: () => '分级配置', inject: () => ({ api, ui, Page: () => null }),
    }, ConversationSettings)))
    child.effect(() => child.slots.inject('conversation.hero.options', () => child.slots.register({
      name: 'conversation.hero.options', id: 'tiered-plugin-menu', order: 50,
      inject: () => ({ open: menu.open }),
    }, NewSessionButton)))
    child.effect(() => child.slots.inject('sidebar.workspaces.session.row.action', () => child.slots.register({
      name: 'sidebar.workspaces.session.row.action', id: 'tiered-plugin-menu', order: 50,
      inject: () => ({ open: menu.open }),
    }, SessionButton)))
    child.effect(() => child.slots.inject('shell.overlay', () => child.slots.register({
      name: 'shell.overlay', id: 'tiered-plugin-menu', order: 90,
      inject: () => ({ api, Page: () => null, menu, ui }),
    }, MenuOverlay)))
  })
}
