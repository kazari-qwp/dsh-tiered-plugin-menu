import type { Context, Plugin } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { PluginArtworkDefault } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import * as originalClient from 'dsh-temporary-messages/client'
import * as contextClient from 'dsh-context/client'
import { remoteContribution } from '../remote-contract.ts'
import { captureSettings } from './capture.ts'
import { LevelSettings } from './menu.tsx'
import { createMenuState, MenuOverlay, SessionButton } from './sidebar.tsx'
import { createElement, useEffect, useState } from 'react'
import { ContextClient, ActiveSession, RegisteredSettings } from './context-client.tsx'
import type { PluginRow, Scope } from '../shared.ts'

export const inject = ['slots', 'remote']
const embeddedClients: Record<string, Plugin> = { 'dsh-context': contextClient }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'tiered-plugin-menu.active-session': { kind: 'list'; scope: 'session-maybe' }
  }
}

export async function apply(ctx: Context): Promise<void> {
  const remote = ctx.get('remote') as TypertClientRemote
  const unmount = await remote.$mount(remoteContribution)
  ctx.effect(() => unmount)
  const original = await captureSettings(ctx, originalClient as Plugin, 'temporaryMessagesUi')
  ctx.effect(() => original.dispose)
  ctx.inject(['remote.tieredPluginMenu', 'pluginNavigation'], child => {
    const api = (child.get('remote') as TypertClientRemote).tieredPluginMenu
    const menu = createMenuState()
    const controllers = new Map<string, ContextClient>()
    // 随选中的会话切换，打开洞察/设置等页面不卸载观察器。
    child.effect(() => child.slots.inject('shell.overlay', () => child.slots.register({
      name: 'shell.overlay', id: 'tiered-session-observers',
      children: { 'tiered-plugin-menu.active-session': { kind: 'list', scope: 'session-maybe' } },
    }, ({ renderSlot }) => renderSlot('tiered-plugin-menu.active-session', {}))))
    let resolveReady!: () => void
    const ready = new Promise<void>(resolve => { resolveReady = resolve })
    child.inject(['loader', 'configForms', 'locale'], async mounted => {
      const result = await api.list({ level: 'client', id: '' })
      if (!result.ok) throw new Error(result.error.message)
      for (const row of result.value.filter(row => row.settings === 'registered')) {
        const original = embeddedClients[row.package]
          ?? mounted.loader.unwrapExports(await mounted.loader.import(row.package))
        const controller = new ContextClient(mounted, api, original, row.id)
        controllers.set(row.id, controller)
        mounted.effect(() => () => controller.dispose())
        mounted.effect(() => mounted.slots.inject('tiered-plugin-menu.active-session', () => mounted.slots.register({
          name: 'tiered-plugin-menu.active-session', id: `tiered-observer:${row.id}`, order: -100,
          inject: () => ({ controller }),
        }, ActiveSession)))
        await controller.refresh()
        mounted.effect(() => mounted.configForms.get(row.id).subscribe(() => { void controller.refresh().catch(error => mounted.logger.error(error)) }))
      }
      resolveReady()
    })
    function Settings({ row, scope }: { row: PluginRow; scope: Scope }) {
      const [controller, setController] = useState(() => controllers.get(row.id))
      useEffect(() => { let live = true; void ready.then(() => { if (live) setController(controllers.get(row.id)) }); return () => { live = false } }, [row.id])
      return controller ? createElement(RegisteredSettings, { controller, row, scope }) : createElement('p', null, '加载原生配置…')
    }
    const ui = {
      Artwork: PluginArtworkDefault,
      Settings,
      changed() { for (const controller of controllers.values()) void controller.refresh().catch(error => child.logger.error(error)) },
      openDetails(packageName: string) { menu.close(); child.pluginNavigation.openBundle(packageName) },
    }
    child.effect(() => child.slots.inject('settings.section', () => child.slots.register({
      name: 'settings.section', id: 'tiered-plugin-menu', order: 46,
      label: () => '分级插件菜单', inject: () => ({ api, Page: original.Page, ui }),
    }, LevelSettings)))
    child.effect(() => child.slots.inject('sidebar.workspaces.session.row.action', () => child.slots.register({
      name: 'sidebar.workspaces.session.row.action', id: 'tiered-plugin-menu', order: 50,
      inject: () => ({ open: menu.open }),
    }, SessionButton)))
    child.effect(() => child.slots.inject('shell.overlay', () => child.slots.register({
      name: 'shell.overlay', id: 'tiered-plugin-menu', order: 90,
      inject: () => ({ api, Page: original.Page, menu, ui }),
    }, MenuOverlay)))
  })
}
