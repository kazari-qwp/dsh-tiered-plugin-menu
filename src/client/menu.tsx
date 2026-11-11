import { Fragment, useEffect, useId, useState, type ComponentType } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { MenuRemote } from '../remote-contract.ts'
import { childScope, isClientScope, scopeKey, type ChildSettings, type PluginRow, type Scope, type ChangePlan, type ChangeMode, type ResourceKind } from '../shared.ts'
import { ResourcePanel } from './resources.tsx'

export const labels = { client: '客户端', workspace: '工作区', session: '会话' }
export function value<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
type PageType = ComponentType<any>
export interface MenuUi {
  Artwork: ComponentType<{ size?: number }>
  openDetails(packageName: string): void
  Settings?: ComponentType<{ row: PluginRow; scope: Scope }>
  changed?(): void
}
type MenuProps = { api: MenuRemote; Page: PageType; ui: MenuUi }
export const modes = [{ value: 'inherit', label: '继承' }, { value: 'on', label: '启用' }, { value: 'off', label: '关闭' }] as const

export function NativeSettings({ api, row, scope, ui, onSaved }: {
  api: MenuRemote; row: PluginRow; scope: Scope; ui: MenuUi; onSaved(): Promise<void>
}) {
  const [text, setText] = useState(() => JSON.stringify(row.config, null, 2))
  const [notice, setNotice] = useState('')
  const save = async () => {
    try {
      value(await api.configure(scope, row.id, true, JSON.parse(text), false))
      await onSaved()
      setNotice('已保存')
    } catch (error) { setNotice(String(error)) }
  }
  return <>
    <label className="tiered-hint">{scope.children ? '下级默认配置（JSON）' : '本层独立配置（JSON）'}
      <textarea className="tiered-config-json" aria-label="本层独立配置（JSON）" value={text} onChange={event => setText(event.target.value)} />
    </label>
    <button type="button" className="tiered-action" onClick={() => void save()}>保存设置</button>
    {notice && <p className="tiered-notice" role="status">{notice}</p>}
  </>
}

export function ConfirmEnable({ plan, onCancel, onConfirm }: {
  plan: ChangePlan; onCancel(): void; onConfirm(): void
}) {
  const id = useId()
  return <div className="tiered-confirm-backdrop" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onCancel() }
    if (event.key === 'Tab') {
      const buttons = event.currentTarget.querySelectorAll('button')
      const edge = event.shiftKey ? buttons[0] : buttons[buttons.length - 1]
      if (event.target === edge) {
        event.preventDefault()
        ;(event.shiftKey ? buttons[buttons.length - 1] : buttons[0])?.focus()
      }
    }
  }}>
    <section className="tiered-confirm" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`}>
      <h3 id={`${id}-title`}>{plan.dependencies.length ? plan.dependencies.some(item => item.mode === 'on') ? '需要启用依赖组件' : '需要先关闭依赖它的组件' : '启用未验证自兼容性的插件？'}</h3>
      <div id={`${id}-body`}>
        {plan.dependencies.length > 0 && <><p>{plan.dependencies.some(item => item.mode === 'on') ? '继续启用需要同时启用：' : '仍有以下组件依赖它，必须先关闭：'}</p>
          <ul>{plan.dependencies.map(item => <li key={`${scopeKey(item.scope)}/${item.id}`}>{item.name}（{labels[item.scope.level]}）</li>)}</ul></>}
        {plan.unverified.length > 0 && <p>{plan.unverified.join('、')} 尚未声明自兼容性，多实例运行可能出现配置串用、重复注册或运行错误。</p>}
      </div>
      <div className="tiered-confirm-actions">
        <button type="button" className="tiered-action" autoFocus onClick={onCancel}>取消</button>
        <button type="button" className="tiered-action tiered-confirm-enable" onClick={onConfirm}>{plan.dependencies.length ? plan.dependencies.some(item => item.mode === 'on') ? '自动启用' : '自动关闭' : '仍然启用'}</button>
      </div>
    </section>
  </div>
}

export function ScopePanel({ api, scope, sessionId = null, Page, ui, disabled = false }: MenuProps & { scope: Scope; sessionId?: string | null; disabled?: boolean }) {
  const panelId = useId()
  const [rows, setRows] = useState<PluginRow[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState<ChangePlan | null>(null)
  const [details, setDetails] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = async () => { setRows(value(await api.list(scope)).filter(row => row.kind !== 'mcp')); ui.changed?.() }
  useEffect(() => { void refresh().catch(error => setNotice(String(error))) }, [api, scopeKey(scope)])
  const execute = async (plan: ChangePlan) => {
    setBusy(true)
    try {
      value(await api.change(plan.scope, plan.id, plan.mode, plan.signature))
      await refresh()
      setNotice('已保存')
    } catch (error) { setNotice(String(error)) } finally { setBusy(false) }
  }
  const configure = async (item: PluginRow, mode: ChangeMode) => {
    setBusy(true)
    try {
      const plan = value(await api.plan(scope, item.id, mode))
      if (plan.missing.length) { setNotice(`依赖不可用：${plan.missing.join('、')}`); return }
      if (plan.dependencies.length || plan.unverified.length) setPending(plan)
      else await execute(plan)
    } catch (error) { setNotice(String(error)) } finally { setBusy(false) }
  }
  const packageRow = rows.find(row => row.id === details)
  const shown = packageRow ? packageRow.components ?? [packageRow] : rows
  const groups = isClientScope(scope) ? [{ id: 'all', rows: shown }] : [
    { id: 'verified', rows: shown.filter(item => item.verified) },
    { id: 'unverified', rows: shown.filter(item => !item.verified) },
  ]
  return <>
    {packageRow && <div className="tiered-detail-heading"><button type="button" className="tiered-action" onClick={() => { setDetails(null); setSelected(null) }}>‹ 插件</button>
      <h3>{packageRow.name}</h3><p className="tiered-hint">包含的组件 · {shown.length} 个</p>
      <button type="button" className="tiered-action" onClick={() => ui.openDetails(packageRow.package)}>查看原生插件详情</button></div>}
    {groups.filter(group => group.rows.length).map(group => <Fragment key={group.id}>
    {group.id === 'unverified' && <div className="tiered-divider" role="separator"><span>未验证自兼容性</span></div>}
    <ul className="tiered-plugin-list">
      {group.rows.map(item => {
        const mode = item.partial ? 'partial' : !item.own ? 'inherit' : item.enabled ? 'on' : 'off'
        const expanded = selected === item.id && item.own && item.enabled
        const settingsId = `${panelId}-${item.id}-settings`
        const descriptionId = `${panelId}-${item.id}-description`
        const inheritHint = isClientScope(scope) ? '客户端没有上级'
          : item.own ? '继承上级配置' : `继承自${labels[item.source.level]}（${item.enabled ? '启用' : '关闭'}）`
        return <li className="tiered-plugin-card" key={item.id}>
          <div className="tiered-row-head">
            <span className="tiered-artwork" aria-hidden="true"><ui.Artwork size={36} /></span>
            <div className="tiered-card-main">
              <button type="button" className="tiered-card-open" aria-label={`查看${item.name}详情`} aria-describedby={descriptionId}
                onClick={() => { if (!packageRow) { setDetails(item.id); setSelected(null) } }}>{item.name}</button>
              <span className="tiered-card-description" id={descriptionId}>{item.partial ? '部分启用 · ' : ''}{item.description}</span>
            </div>
            <div className="tiered-controls">
              <div className="tiered-mode" role="group" aria-label={`${item.name}配置方式`}>
                {modes.map(option => <button type="button" key={option.value} data-mode={option.value}
                  aria-pressed={mode === option.value} disabled={disabled || busy || isClientScope(scope) && option.value === 'inherit'}
                  title={option.value === 'inherit' ? inheritHint : undefined}
                  onClick={() => {
                    if (mode === option.value) return
                    void configure(item, option.value)
                  }}>{option.label}</button>)}
              </div>
              <button type="button" className="tiered-expand" disabled={disabled || !item.components && (!item.own || !item.enabled)}
                aria-expanded={expanded} aria-controls={settingsId}
                onClick={() => item.components ? setDetails(item.id) : setSelected(expanded ? null : item.id)}>设置<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></button>
            </div>
          </div>
          {expanded && <div id={settingsId} className="tiered-inline-settings">
            {item.settings === 'registered' && ui.Settings ? <ui.Settings row={item} scope={scope} />
              : <NativeSettings api={api} row={item} scope={scope} ui={ui} onSaved={refresh} />}
          </div>}
        </li>
      })}
    </ul>
    </Fragment>)}
    {notice && <p className="tiered-notice" role="status">{notice}</p>}
    {pending && <ConfirmEnable plan={pending} onCancel={() => setPending(null)}
      onConfirm={() => { setPending(null); void execute(pending) }} />}
  </>
}

function ChildPanel({ api, scope, Page, ui, kind = 'plugin' }: MenuProps & { scope: Scope; kind?: ResourceKind }) {
  const [settings, setSettings] = useState<ChildSettings>()
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const target = { client: '新顶层工作区及无工作区的新会话', workspace: '新会话，以及按工作区树继承时的新子工作区', session: '新子 agent（包括后续各级子 agent）' }[scope.level]
  const refresh = async () => setSettings(value(await api.childSettings(scope)))
  useEffect(() => { void refresh().catch(error => setNotice(String(error))) }, [api, scopeKey(scope)])
  const select = async (independent: boolean) => {
    setBusy(true)
    try { value(await api.setChildSettings(scope, independent)); await refresh(); setNotice('已保存') }
    catch (error) { setNotice(String(error)) } finally { setBusy(false) }
  }
  return <>
    <div className="tiered-child-heading">
      <p className="tiered-hint">{target}的默认配置，只在新建时应用。</p>
      <div className="tiered-mode" role="group" aria-label="下级默认配置方式">
        {([{ value: false, label: '继承' }, { value: true, label: '独立' }] as const).map(option => <button type="button" key={option.label}
          aria-pressed={settings?.independent === option.value} disabled={!settings || busy}
          onClick={() => { if (settings?.independent !== option.value) void select(option.value) }}>{option.label}</button>)}
      </div>
    </div>
    {settings && <>
      {!settings.independent && <p className="tiered-hint">{settings.source ? `沿用上级${labels[settings.source.level]}的下级默认设置。` : '沿用本级的有效配置。'}切换为「独立」后可以单独设置。</p>}
      {kind === 'plugin' ? <ScopePanel key={String(settings.independent)} api={api} scope={childScope(scope)} Page={Page} ui={ui} disabled={!settings.independent || busy} />
        : <ResourcePanel key={`${kind}-${settings.independent}`} api={api} scope={childScope(scope)} kind={kind} disabled={!settings.independent || busy} />}
    </>}
    {notice && <p className="tiered-notice" role="status">{notice}</p>}
  </>
}

export function ScopeTabs(props: MenuProps & { scope: Scope; sessionId?: string | null; kind?: ResourceKind }) {
  const [tab, setTab] = useState<'own' | 'children'>('own')
  const id = useId()
  return <>
    <div className="tiered-tabs" role="tablist" aria-label="配置范围">
      {([{ value: 'own', label: '本级' }, { value: 'children', label: '下级' }] as const).map(option => <button type="button" key={option.value}
        role="tab" id={`${id}-${option.value}`} aria-selected={tab === option.value} aria-controls={`${id}-panel`}
        onClick={() => setTab(option.value)}>{option.label}</button>)}
    </div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`}>
      {tab === 'own' ? props.kind && props.kind !== 'plugin' ? <ResourcePanel key={props.kind} api={props.api} scope={props.scope} kind={props.kind} /> : <ScopePanel {...props} /> : <ChildPanel key={props.kind} {...props} />}
    </div>
  </>
}

export function LevelSettings({ api, ui }: Pick<MenuProps, 'api' | 'ui'>) {
  const [enabled, setEnabled] = useState<boolean>()
  const [isolation, setIsolation] = useState<boolean>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    void api.settings().then(result => {
      const settings = value(result)
      setEnabled(settings.inheritWorkspaceTree); setIsolation(settings.pluginIsolation)
    }).catch(error => setNotice(String(error)))
  }, [api])
  const toggle = async () => {
    setBusy(true)
    try {
      value(await api.setWorkspaceTreeInheritance(!enabled))
      setEnabled(!enabled)
      ui.changed?.()
      setNotice('已保存')
    } catch (error) { setNotice(String(error)) } finally { setBusy(false) }
  }
  const toggleIsolation = async () => {
    setBusy(true)
    try {
      value(await api.setPluginIsolation(!isolation))
      setIsolation(!isolation)
      setNotice('已保存，重启 DSH 后生效')
    } catch (error) { setNotice(String(error)) } finally { setBusy(false) }
  }
  return <section className="tiered-menu"><style>{styles}</style>
    <h2>分级插件菜单</h2>
    <div className="tiered-tree-setting">
      <div><label htmlFor="tiered-workspace-tree">按工作区树继承</label>
        <p className="tiered-hint">按目录层级逐级继承上级工作区的插件配置。关闭时，各工作区直接继承客户端。</p>
      </div>
      <button id="tiered-workspace-tree" type="button" role="switch" className="tiered-switch"
        aria-label="按工作区树继承" aria-checked={enabled ?? false} disabled={enabled === undefined || busy}
        onClick={() => void toggle()}><span /></button>
    </div>
    <div className="tiered-tree-setting">
      <div><label htmlFor="tiered-plugin-isolation">插件隔离（实验性）</label>
        <p className="tiered-hint">给插件提供相对独立的环境，可能能修复一些兼容性问题，但也可能带来更多兼容性问题。</p>
      </div>
      <button id="tiered-plugin-isolation" type="button" role="switch" className="tiered-switch"
        aria-label="插件隔离（实验性）" aria-checked={isolation ?? false} disabled={isolation === undefined || busy}
        onClick={() => void toggleIsolation()}><span /></button>
    </div>
    {notice && <p role="status">{notice}</p>}
  </section>
}

export interface MenuTarget { scope: Scope }

export function MenuDialog({ api, Page, ui, target, onClose }: MenuProps & { target: MenuTarget; onClose(): void }) {
  const { scope } = target
  const sessionId = scope.level === 'session' ? scope.id : null
  const title = `${labels[scope.level]}插件`
  const [kind, setKind] = useState<ResourceKind>('plugin')
  const id = useId()
  return <div className="tiered-menu"><style>{styles}</style>
    <div className="tiered-backdrop"><section className="tiered-panel" role="dialog" aria-modal="true" aria-label={title}>
      <div className="tiered-heading"><h2>{title}</h2><button type="button" className="tiered-close" aria-label="关闭" onClick={onClose}>关闭</button></div>
      <div className="tiered-resource-layout">
        <div className="tiered-resource-tabs" role="tablist" aria-label="资源类型" aria-orientation="vertical">
          {([{ kind: 'plugin', label: '插件' }, { kind: 'mcp', label: 'MCP' }, { kind: 'skill', label: 'Skill' }] as const).map(tab =>
            <button type="button" key={tab.kind} role="tab" id={`${id}-${tab.kind}`} aria-selected={kind === tab.kind} aria-controls={`${id}-resources`} onClick={() => setKind(tab.kind)}>{tab.label}</button>)}
        </div>
        <div className="tiered-resource-content" role="tabpanel" id={`${id}-resources`} aria-labelledby={`${id}-${kind}`}>
          <ScopeTabs key={scopeKey(scope)} api={api} scope={scope} sessionId={sessionId} Page={Page} ui={ui} kind={kind} />
        </div>
      </div>
    </section></div>
  </div>
}

const styles = `
.tiered-menu { color: var(--dsw-alias-label-primary, #ededee); font: inherit; line-height: 1.6; }
.tiered-menu .tiered-resource-layout { display: flex; gap: 24px; }
.tiered-menu .tiered-resource-tabs { display: flex; flex-direction: column; gap: 4px; width: 84px; flex-shrink: 0; padding-right: 16px; border-right: 1px solid var(--dsw-alias-border-l3, #ffffff16); }
.tiered-menu .tiered-resource-tabs button { border: 0; border-radius: 7px; background: transparent; color: inherit; padding: 8px 12px; text-align: left; }
.tiered-menu .tiered-resource-tabs button[aria-selected="true"] { background: var(--dsw-alias-interactive-bg-hover, #ffffff12); font-weight: 600; }
.tiered-menu .tiered-resource-content { flex: 1; min-width: 0; }
.tiered-menu .tiered-resource-toolbar { margin: 0 0 14px; }
.tiered-menu .tiered-resource-editor { margin: 12px 0; }
.tiered-menu .tiered-resource-editor label { display: block; font-size: 13px; }
.tiered-menu .tiered-resource-editor input:not([type="checkbox"]) { box-sizing: border-box; width: 100%; padding: 8px; margin: 6px 0 12px; color: inherit; background: transparent; border: 1px solid var(--dsw-alias-border-l3, #ffffff25); border-radius: 6px; }
.tiered-menu .tiered-invocation { display: flex; gap: 18px; margin-bottom: 14px; }
.tiered-menu .tiered-resource-icon { font-size: 26px; color: var(--dsw-alias-label-secondary, #bfc0c5); }
.tiered-menu button { font: inherit; cursor: pointer; }
.tiered-menu button:disabled { opacity: .35; cursor: default; }
.tiered-menu h2 { margin: 0; font-size: 18px; line-height: 26px; font-weight: 600; }
.tiered-menu .tiered-tree-setting { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-top: 24px; }
.tiered-menu .tiered-tree-setting .tiered-hint { margin: 6px 0 0; }
.tiered-menu .tiered-switch { flex: none; width: 36px; height: 20px; border: 0; padding: 2px; border-radius: 10px; background: var(--dsw-alias-interactive-bg-active, #555); }
.tiered-menu .tiered-switch span { display: block; width: 16px; height: 16px; border-radius: 50%; background: #aaa; }
.tiered-menu .tiered-switch[aria-checked="true"] { background: #eee; }
.tiered-menu .tiered-switch[aria-checked="true"] span { transform: translateX(16px); background: #222; }
.tiered-menu .tiered-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.tiered-menu .tiered-close, .tiered-menu .tiered-tabs button, .tiered-menu select { color: inherit; border: 1px solid var(--dsw-alias-border-l3, #ffffff20); border-radius: 8px; background: transparent; padding: 5px 10px; font-size: 13px; }
.tiered-menu .tiered-close { border-color: transparent; color: var(--dsw-alias-label-secondary, #bfc0c5); }
.tiered-menu .tiered-close:hover, .tiered-menu .tiered-tabs button:hover { background: var(--dsw-alias-interactive-bg-hover, #ffffff09); }
.tiered-menu select option { color: var(--dsw-alias-label-primary, #ededee); background: var(--dsw-alias-bg-layer-2, #252527); }
.tiered-menu .tiered-tabs { display: flex; gap: 6px; padding-bottom: 14px; margin: 0 0 14px; border-bottom: 1px solid var(--dsw-alias-border-l3, #ffffff15); }
.tiered-menu .tiered-tabs [aria-selected="true"] { background: var(--dsw-alias-interactive-bg-active, #ffffff12); }
.tiered-menu .tiered-child-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.tiered-menu .tiered-child-heading .tiered-hint { margin: 0; }
.tiered-menu .tiered-plugin-list { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.tiered-menu .tiered-divider { display: flex; align-items: center; gap: 12px; margin: 18px 0 10px; color: var(--dsw-alias-label-tertiary, #a4a6ad); font-size: 12px; }
.tiered-menu .tiered-divider::before, .tiered-menu .tiered-divider::after { content: ''; height: 1px; flex: 1; background: var(--dsw-alias-border-l3, #ffffff20); }
.tiered-menu .tiered-action { color: inherit; border: 1px solid var(--dsw-alias-border-l3, #ffffff20); border-radius: 8px; padding: 6px 12px; background: transparent; font-size: 13px; }
.tiered-menu .tiered-action:hover { background: var(--dsw-alias-interactive-bg-hover, #ffffff09); }
.tiered-menu .tiered-config-json { box-sizing: border-box; display: block; width: 100%; min-height: 180px; margin: 8px 0 12px; padding: 10px; border: 1px solid var(--dsw-alias-border-l3, #ffffff20); border-radius: 8px; color: var(--dsw-alias-label-primary, #ededee); background: var(--dsw-alias-bg-layer-1, #1e1e20); font: 13px/1.6 monospace; resize: vertical; }
.tiered-menu .tiered-confirm-backdrop { position: fixed; inset: 0; z-index: 1100; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--dsw-alias-bg-mask-1, #0008); }
.tiered-menu .tiered-confirm { width: min(420px, 100%); padding: 22px; border: 1px solid var(--dsw-alias-border-l3, #ffffff20); border-radius: 14px; background: var(--dsw-alias-bg-layer-2, #252527); box-shadow: var(--dsw-elevation-prominent, 0 20px 70px #0005); }
.tiered-menu .tiered-confirm h3 { margin: 0 0 12px; font-size: 16px; }
.tiered-menu .tiered-confirm p { margin: 0; color: var(--dsw-alias-label-secondary, #bfc0c5); font-size: 13px; overflow-wrap: anywhere; }
.tiered-menu .tiered-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.tiered-menu .tiered-confirm-enable { background: var(--dsw-alias-interactive-bg-active, #3c3d43); }
.tiered-menu .tiered-plugin-card { min-width: 0; margin: 0 -8px; }
.tiered-menu .tiered-row-head { position: relative; display: flex; align-items: center; gap: 14px; padding: 8px; border-radius: 12px; }
.tiered-menu .tiered-row-head:hover { background: var(--dsw-alias-interactive-bg-hover, #ffffff07); }
.tiered-menu .tiered-artwork { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 48px; height: 48px; border: .5px solid var(--dsw-alias-border-l3, #ffffff22); border-radius: 12px; }
.tiered-menu .tiered-card-main { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 4px; }
.tiered-menu .tiered-card-open { align-self: flex-start; max-width: 100%; border: 0; padding: 0; border-radius: 0; background: transparent; color: inherit; font-size: 14px; line-height: 20px; font-weight: 500; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tiered-menu .tiered-card-open::after { content: ''; position: absolute; inset: 0; border-radius: 12px; }
.tiered-menu .tiered-card-open:focus-visible { outline: none; }
.tiered-menu .tiered-card-open:focus-visible::after { outline: 2px solid var(--dsw-alias-state-business-primary, #6e9cff); outline-offset: 2px; }
.tiered-menu .tiered-card-description { color: var(--dsw-alias-label-tertiary, #a4a6ad); font-size: 13px; line-height: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tiered-menu .tiered-controls { position: relative; z-index: 1; display: flex; flex: none; align-items: center; gap: 12px; }
.tiered-menu .tiered-mode { display: inline-flex; border: 1px solid var(--dsw-alias-border-l3, #ffffff22); border-radius: 8px; overflow: hidden; background: var(--dsw-alias-bg-layer-1, #1e1e20); }
.tiered-menu .tiered-mode button { min-width: 44px; border: 0; border-right: 1px solid var(--dsw-alias-border-l3, #ffffff15); border-radius: 0; padding: 5px 9px; background: transparent; color: var(--dsw-alias-label-secondary, #bfc0c5); font-size: 12px; line-height: 18px; }
.tiered-menu .tiered-mode button:last-child { border-right: 0; }
.tiered-menu .tiered-mode button[aria-pressed="true"] { background: var(--dsw-alias-interactive-bg-active, #3c3d43); color: var(--dsw-alias-label-primary, #fff); }
.tiered-menu .tiered-mode button:not(:disabled):hover { background: var(--dsw-alias-interactive-bg-hover, #ffffff0c); }
.tiered-menu .tiered-mode button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #6e9cff); outline-offset: -2px; }
.tiered-menu .tiered-expand { display: inline-flex; align-items: center; gap: 4px; border: 0; border-radius: 6px; padding: 6px 8px; background: transparent; color: var(--dsw-alias-label-secondary, #bfc0c5); font-size: 13px; }
.tiered-menu .tiered-expand:not(:disabled):hover { background: var(--dsw-alias-interactive-bg-hover, #ffffff09); }
.tiered-menu .tiered-expand svg { transition: transform 150ms; }
.tiered-menu .tiered-expand[aria-expanded="true"] svg { transform: rotate(90deg); }
.tiered-menu .tiered-inline-settings { margin: 4px 8px 12px; padding: 14px 0 4px; border-top: 1px solid var(--dsw-alias-border-l3, #ffffff15); }
.tiered-menu .tiered-hint, .tiered-menu .tiered-notice { color: var(--dsw-alias-label-tertiary, #a4a6ad); font-size: 12px; }
.tiered-menu .tiered-hint { margin: 0 0 12px; }
.tiered-menu .tiered-notice { margin: 10px 0 0; }
.tiered-menu .tiered-backdrop { position: fixed; inset: 0; box-sizing: border-box; padding: max(24px, var(--dsh-frame-overlay-top, 24px)) 24px; background: var(--dsw-alias-bg-mask-1, #0008); z-index: 1000; display: flex; align-items: center; justify-content: center; pointer-events: auto; }
.tiered-menu .tiered-panel { box-sizing: border-box; color: inherit; background: var(--dsw-alias-bg-layer-2, #252527); border: 1px solid var(--dsw-alias-border-l3, #ffffff16); border-radius: var(--dsw-radius-panel, 16px); box-shadow: var(--dsw-elevation-prominent, 0 20px 70px #0005); padding: 24px; width: min(920px, 100%); max-height: 100%; overflow: auto; }
@media (max-width: 640px) {
  .tiered-menu .tiered-resource-layout { gap: 12px; }
  .tiered-menu .tiered-resource-tabs { width: 58px; padding-right: 8px; }
  .tiered-menu .tiered-resource-tabs button { padding: 8px; }
  .tiered-menu .tiered-panel { padding: 18px; }
  .tiered-menu .tiered-row-head { flex-wrap: wrap; }
  .tiered-menu .tiered-controls { margin-left: 62px; }
  .tiered-menu .tiered-card-main { flex-basis: calc(100% - 62px); }
}
@media (prefers-reduced-motion: reduce) { .tiered-menu .tiered-expand svg { transition: none; } }`
