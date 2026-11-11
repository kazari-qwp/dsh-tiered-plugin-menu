import { useEffect, useId, useState } from 'react'
import type { MenuRemote } from '../remote-contract.ts'
import { isClientScope, scopeKey, type ChangeMode, type ChangePlan, type PluginConfig, type PluginRow, type Scope, type SkillRow } from '../shared.ts'
import { ConfirmEnable, labels, modes, value } from './menu.tsx'

type Kind = 'mcp' | 'skill'
type Row = PluginRow | SkillRow

function ResourceEditor({ api, scope, kind, row, onSaved, onCancel }: {
  api: MenuRemote; scope: Scope; kind: Kind; row?: Row; onSaved(): Promise<void>; onCancel?(): void
}) {
  const [config, setConfig] = useState<PluginConfig>(row?.config ?? { serverName: 'local-mcp', transport: 'stdio', command: '', args: [] })
  const [text, setText] = useState(() => JSON.stringify(config, null, 2))
  const [ready, setReady] = useState(kind === 'mcp')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (kind !== 'skill' || !row) return
    let active = true
    void api.skillConfig(scope, row.id).then(result => { if (active) { setConfig(value(result)); setReady(true) } })
      .catch(error => { if (active) setNotice(String(error)) })
    return () => { active = false }
  }, [api, kind, scopeKey(scope), row?.id])
  const save = async () => {
    setBusy(true)
    try {
      if (kind === 'skill') value(await api.configureSkill(scope, row!.id, row!.enabled, config))
      else if (row) value(await api.configure(scope, row.id, row.enabled, JSON.parse(text), true))
      else value(await api.addMcp(scope, JSON.parse(text)))
      await onSaved(); setNotice('已保存')
    } catch (error) { setNotice(String(error)) } finally { setBusy(false) }
  }
  return <div className="tiered-resource-editor">
    {kind === 'mcp' ? <>
      <p className="tiered-hint">填写服务器的连接参数。stdio 使用 command、args、env、cwd；streamable-http 使用 url、headers。</p>
      <label>服务器配置（JSON）<textarea className="tiered-config-json" aria-label="MCP 服务器配置" value={text} onChange={e => setText(e.target.value)} /></label>
    </> : ready ? <>
      <p className="tiered-hint">保存为此范围的独立配置，原始 SKILL.md 不变。</p>
      <label>说明<input aria-label="Skill 说明" value={String(config.description ?? '')} onChange={e => setConfig({ ...config, description: e.target.value })} /></label>
      <label>技能正文<textarea className="tiered-config-json" aria-label="Skill 正文" value={String(config.content ?? '')} onChange={e => setConfig({ ...config, content: e.target.value })} /></label>
      <div className="tiered-invocation">{([{ key: 'modelInvocable', label: '允许模型调用' }, { key: 'userInvocable', label: '允许用户调用' }] as const).map(option =>
        <label key={option.key}><input type="checkbox" checked={config[option.key] === true} onChange={e => setConfig({ ...config, [option.key]: e.target.checked })} />{option.label}</label>)}</div>
    </> : !notice && <p className="tiered-hint">加载技能…</p>}
    <button type="button" className="tiered-action" disabled={!ready || busy} onClick={() => void save()}>{row ? '保存设置' : '添加并启用'}</button>
    {onCancel && <button type="button" className="tiered-action" disabled={busy} onClick={onCancel}>取消</button>}
    {notice && <p className="tiered-notice" role="status">{notice}</p>}
  </div>
}

export function ResourcePanel({ api, scope, kind, disabled = false }: { api: MenuRemote; scope: Scope; kind: Kind; disabled?: boolean }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<ChangePlan | null>(null)
  const panelId = useId()
  const refresh = async () => {
    setRows(kind === 'skill' ? value(await api.skills(scope)) : value(await api.list(scope)).filter(row => row.kind === 'mcp'))
    setLoaded(true)
  }
  useEffect(() => { void refresh().catch(error => setNotice(String(error))) }, [api, scopeKey(scope), kind])
  const execute = async (plan: ChangePlan) => {
    setBusy(true)
    try { value(await api.change(scope, plan.id, plan.mode, plan.signature)); await refresh(); setNotice('已保存') }
    catch (error) { setNotice(String(error)) } finally { setBusy(false) }
  }
  const select = async (row: Row, mode: ChangeMode) => {
    setBusy(true)
    try {
      if (kind === 'mcp') {
        const plan = value(await api.plan(scope, row.id, mode))
        if (plan.missing.length) throw new Error(`缺少依赖：${plan.missing.join('、')}`)
        if (plan.dependencies.length || plan.unverified.length) setPending(plan)
        else await execute(plan)
      } else {
        value(mode === 'inherit' ? await api.inheritSkill(scope, row.id) : await api.configureSkill(scope, row.id, mode === 'on', row.config))
        await refresh(); setNotice('已保存')
      }
    } catch (error) { setNotice(String(error)) } finally { setBusy(false) }
  }
  return <>
    {kind === 'mcp' && <div className="tiered-resource-toolbar"><button type="button" className="tiered-action" disabled={disabled || busy} onClick={() => setAdding(!adding)}>＋ 添加 MCP</button></div>}
    {adding && !disabled && <ResourceEditor api={api} scope={scope} kind="mcp" onSaved={async () => { await refresh(); setAdding(false) }} onCancel={() => setAdding(false)} />}
    {loaded && !rows.length && <p className="tiered-hint">{kind === 'mcp' ? '还没有 MCP 服务器。可添加服务器，或自动识别 DSH 中已有的 MCP 配置。' : '此范围还没有可用技能。安装技能插件或在工作区的 .dsh/skills 中添加 SKILL.md 后可在这里配置。'}</p>}
    <ul className="tiered-plugin-list">{rows.map(row => {
      const mode = !row.own ? 'inherit' : row.enabled ? 'on' : 'off'
      const expanded = selected === row.id
      const settingsId = `${panelId}-${row.id}`
      return <li key={row.id} className="tiered-plugin-card">
        <div className="tiered-row-head">
          <span className="tiered-artwork tiered-resource-icon" aria-hidden="true">{kind === 'mcp' ? '↔' : '◇'}</span>
          <div className="tiered-card-main"><span className="tiered-card-open">{row.name}</span><span className="tiered-card-description">{row.description}</span></div>
          <div className="tiered-controls">
            <div className="tiered-mode" role="group" aria-label={`${row.name}配置方式`}>{modes.map(option => <button type="button" key={option.value}
              aria-pressed={mode === option.value} disabled={disabled || busy || isClientScope(scope) && option.value === 'inherit'}
              title={option.value === 'inherit' && !row.own ? `继承自${labels[row.source.level]}（${row.enabled ? '启用' : '关闭'}）` : undefined}
              onClick={() => { if (mode !== option.value) void select(row, option.value) }}>{option.label}</button>)}</div>
            <button type="button" className="tiered-expand" aria-expanded={expanded} aria-controls={settingsId}
              disabled={disabled || 'available' in row && !row.available} onClick={() => setSelected(expanded ? null : row.id)}>设置 {expanded ? '⌄' : '›'}</button>
          </div>
        </div>
        {expanded && !disabled && <div id={settingsId} className="tiered-inline-settings"><ResourceEditor key={JSON.stringify(row.config)} api={api} scope={scope} kind={kind} row={row} onSaved={refresh} /></div>}
      </li>
    })}</ul>
    {notice && <p className="tiered-notice" role="status">{notice}</p>}
    {pending && <ConfirmEnable plan={pending} onCancel={() => setPending(null)} onConfirm={() => { setPending(null); void execute(pending) }} />}
  </>
}
