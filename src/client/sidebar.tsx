import { useEffect, useState, useSyncExternalStore, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import type { MenuRemote } from '../remote-contract.ts'
import { clientScope, scopeKey } from '../shared.ts'
import { labels, MenuDialog, type MenuTarget, type MenuUi } from './menu.tsx'

export function createMenuState() {
  let target: MenuTarget | null = null
  const listeners = new Set<() => void>()
  const update = (next: MenuTarget | null) => { target = next; listeners.forEach(listener => listener()) }
  return {
    getSnapshot: () => target,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    open: (next: MenuTarget) => update(next),
    close: () => update(null),
  }
}

function PluginButton({ label, onClick }: { label: string; onClick(): void }) {
  return <button type="button" className="tiered-plugin-button" title={label} aria-label={label}
    onClick={event => { event.stopPropagation(); onClick() }}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 3v4m6-4v4M7 7h10v3a5 5 0 0 1-10 0V7Zm5 8v6" />
    </svg>
  </button>
}

export function SessionButton({ sessionId, open }: {
  sessionId: string; open(target: MenuTarget): void
}) {
  return <PluginButton label="会话插件" onClick={() => open({ scope: { level: 'session', id: sessionId } })} />
}

interface SidebarAnchor { target: MenuTarget; mount: HTMLElement }

/** DSH 0.2.2 的工作区标题栏和工作区行没有动作插槽，共用这段按钮挂接。 */
function SidebarButtons({ open }: { open(target: MenuTarget): void }) {
  const [anchors, setAnchors] = useState<SidebarAnchor[]>([])
  useEffect(() => {
    const mounted = new Map<Element, SidebarAnchor>()
    const sync = () => {
      let changed = false
      for (const [actions, anchor] of mounted) if (!actions.isConnected) {
        anchor.mount.remove()
        mounted.delete(actions)
        changed = true
      }
      const attach = (anchor: Element, target: MenuTarget, placement: 'before' | 'prepend') => {
        if (mounted.has(anchor)) return
        const mount = document.createElement('span')
        mount.className = `tiered-${target.scope.level}-action`
        if (placement === 'before') anchor.before(mount)
        else anchor.prepend(mount)
        mounted.set(anchor, { target, mount })
        changed = true
      }
      for (const region of document.querySelectorAll('[data-slot="sidebar.workspaces"]')) {
        // 搜索输入框位于 search → searchSlot，按钮放在 searchSlot 前。
        const searchSlot = region.querySelector('input[maxlength]')?.parentElement?.parentElement
        if (searchSlot) attach(searchSlot, { scope: clientScope }, 'before')
      }
      for (const row of document.querySelectorAll<HTMLElement>('[data-row-key^="workspace:"]')) {
        const actions = row.querySelector('[data-context-menu-trigger]')?.parentElement
        if (actions) attach(actions, { scope: { level: 'workspace', id: row.dataset.rowKey!.slice('workspace:'.length) } }, 'prepend')
      }
      if (changed) setAnchors([...mounted.values()])
    }
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    sync()
    return () => { observer.disconnect(); for (const anchor of mounted.values()) anchor.mount.remove() }
  }, [])
  return <>{anchors.map(anchor => createPortal(
    <PluginButton label={`${labels[anchor.target.scope.level]}插件`} onClick={() => open(anchor.target)} />,
    anchor.mount, scopeKey(anchor.target.scope),
  ))}</>
}

export function MenuOverlay({ api, Page, menu, ui }: {
  api: MenuRemote; Page: ComponentType<any>; menu: ReturnType<typeof createMenuState>; ui: MenuUi
}) {
  const target = useSyncExternalStore(menu.subscribe, menu.getSnapshot)
  return <>
    <style>{buttonStyles}</style>
    <SidebarButtons open={menu.open} />
    {target && <MenuDialog key={scopeKey(target.scope)} api={api} Page={Page} ui={ui} target={target} onClose={menu.close} />}
  </>
}

const buttonStyles = `
.tiered-workspace-action { display: contents; }
.tiered-client-action { display: flex; flex: none; align-items: center; width: 28px; height: 28px; margin-left: auto; }
.tiered-client-action + div { margin-left: 0; }
.tiered-client-action .tiered-plugin-button { width: 28px; height: 28px; margin: 0; }
.tiered-plugin-button { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 24px; height: 24px; margin: -4px; padding: 0; border: 0; border-radius: var(--dsw-radius-xs, 4px); background: transparent; color: var(--dsw-alias-label-tertiary, #92959b); cursor: pointer; }
.tiered-plugin-button:hover { color: var(--dsw-alias-label-primary, #ddd); }
.tiered-plugin-button:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; }
`
