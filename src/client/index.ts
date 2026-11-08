import type { Context, Plugin } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { PluginArtworkDefault } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import { remoteContribution } from '../remote-contract.ts'
import { LevelSettings, NativeSettings } from './menu.tsx'
import { createMenuState, MenuOverlay, SessionButton } from './sidebar.tsx'
import { createElement, useEffect, useState, type ReactElement } from 'react'
import { ContextClient, ActiveSession, RegisteredSettings } from './context-client.tsx'
import type { PluginRow, Scope } from '../shared.ts'

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
  ctx.inject(['remote.tieredPluginMenu', 'pluginNavigation'], child => {
    const api = (child.get('remote') as TypertClientRemote).tieredPluginMenu
    const menu = createMenuState()
    const controllers = new Map<string, ContextClient>()
    const listeners = new Set<() => void>()
    // 随选中的会话切换，打开洞察/设置等页面不卸载观察器。
    child.effect(() => child.slots.inject('shell.overlay', () => child.slots.register({
      name: 'shell.overlay', id: 'tiered-session-observers',
      children: { 'tiered-plugin-menu.active-session': { kind: 'list', scope: 'session-maybe' } },
    }, ({ renderSlot }) => renderSlot('tiered-plugin-menu.active-session', {}))))
    let discover = async () => {}
    child.inject(['loader', 'configForms', 'locale'], async mounted => {
      let pending = Promise.resolve()
      const sync = async () => {
      const result = await api.list({ level: 'client', id: '' })
      if (!result.ok) throw new Error(result.error.message)
      for (const row of result.value.filter(row => row.settings === 'registered')) {
        if (row.package === remoteContribution.package) continue
        const existing = controllers.get(row.package)
        if (existing) { await existing.refresh(); continue }
        // The native module graph loads the original client and its CSS whenever a host entry runs.
        if (![...mounted.loader.entries()].some(entry => entry.options.name === row.package)) continue
        const original = mounted.loader.unwrapExports(await mounted.loader.import(row.package))
        const controller = new ContextClient(mounted, api, original, row.id, row.package)
        controllers.set(row.package, controller)
        for (const listener of listeners) listener()
        mounted.effect(() => () => controller.dispose())
        mounted.effect(() => mounted.slots.inject('tiered-plugin-menu.active-session', () => mounted.slots.register({
          name: 'tiered-plugin-menu.active-session', id: `tiered-observer:${row.id}`, order: -100,
          inject: () => ({ controller }),
        }, ActiveSession)))
        await controller.refresh()
        mounted.effect(() => mounted.configForms.get(row.configNamespace ?? row.id).subscribe(() => { void controller.refresh().catch(error => mounted.logger.error(error)) }))
      }
      }
      discover = () => pending = pending.then(sync, sync)
      mounted.on('loader/patch-context', async (entry, next) => {
        await next()
        if (entry.options.name !== remoteContribution.package) queueMicrotask(() => { void discover().catch(error => mounted.logger.error(error)) })
      })
      await discover()
    })
    function Settings({ row, scope }: { row: PluginRow; scope: Scope }): ReactElement {
      const [controller, setController] = useState(() => controllers.get(row.package))
      useEffect(() => {
        let live = true
        const update = () => { if (live) setController(controllers.get(row.package)) }
        listeners.add(update)
        void discover().then(update)
        return () => { live = false; listeners.delete(update) }
      }, [row.id, row.config])
      const fallback = createElement(NativeSettings, { api, row, scope, ui, onSaved: discover })
      return controller ? createElement(RegisteredSettings, { controller, row, scope, fallback }) : fallback
    }
    const ui = {
      Artwork: PluginArtworkDefault,
      Settings,
      changed() { void discover().catch(error => child.logger.error(error)) },
      openDetails(packageName: string) { menu.close(); child.pluginNavigation.openBundle(packageName) },
    }
    child.effect(() => child.slots.inject('settings.section', () => child.slots.register({
      name: 'settings.section', id: 'tiered-plugin-menu', order: 46,
      label: () => '分级插件菜单', inject: () => ({ api, Page: () => null, ui }),
    }, LevelSettings)))
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
