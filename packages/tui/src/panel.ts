import type { Context } from '@deepseek-ai/cordis'
import type ReactTypes from 'react'
import type { PluginManager } from 'dsh-tiered-plugin-core'
import { MenuModel, levelLabel } from 'dsh-tiered-plugin-core/model'
import { ownScope, type ChangeMode, type PluginRow, type ResourceKind, type Scope } from 'dsh-tiered-plugin-core/shared'

// Public TUI panel contract only. React and terminal components come from the host.
export interface PanelProps {
  React: typeof ReactTypes
  ui: { Box: ReactTypes.ComponentType<any>; Text: ReactTypes.ComponentType<any> }
  host: { snapshot(): { sessionId: string }; onKey(fn: (event: { input: string; key: Record<string, boolean>; preventDefault(): void }) => void): () => void }
  height: number; focused: boolean; visible: boolean
}

export function createPanel(ctx: Context, manager: PluginManager) {
  const dialogs = ctx.get('tuiDialogs') as any
  return function TieredPanel({ React, ui, host, height, focused, visible }: PanelProps) {
    const { createElement: h, useState, useMemo, useEffect, useRef } = React
    const sessionId = host.snapshot().sessionId || null
    const model = useMemo(() => new MenuModel(manager, sessionId), [sessionId])
    const [rows, setRows] = useState<Awaited<ReturnType<MenuModel['rows']>>>([])
    const [cursor, setCursor] = useState(0)
    const [notice, setNotice] = useState('')
    const [revision, update] = useState(0)
    const busy = useRef(false)
    useEffect(() => {
      let live = true
      model.rows().then(value => { if (live) { setRows(value); setCursor(old => Math.min(old, Math.max(0, value.length - 1))) } }, error => { if (live) setNotice(String(error)) })
      return () => { live = false }
    }, [model, revision])
    const select = (scope: Scope, kind = model.selection.kind, component?: string) => {
      model.select({ scope, kind, component }); setCursor(0)
    }
    const chooseMode = async (id: string) => {
      const mode: ChangeMode | undefined = await dialogs.select({ title: '本级状态', options: [
        ...(model.selection.scope.level !== 'client' || model.selection.scope.children ? [{ id: 'inherit', label: '继承' }] : []),
        { id: 'on', label: '启用' }, { id: 'off', label: '关闭' },
      ] })
      if (!mode) return
      await model.change(id, mode)
      if (model.pending) {
        const plan = model.pending
        const message = [...plan.dependencies.map(item => `${item.mode === 'on' ? '启用' : '关闭'} ${item.name}`),
          ...(plan.unverified.length ? ['尚未声明自兼容性，确认在本级启用？'] : [])].join('\n')
        if (await dialogs.confirm({ title: '确认插件变更', message })) await model.confirm()
        else model.pending = undefined
      }
    }
    const edit = async (id: string) => {
      const config = await model.config(id)
      const key = await dialogs.select({ title: '选择配置字段', options: [
        ...Object.keys(config).map(key => ({ id: key, label: key })), { id: '$add', label: '+ 添加字段' },
      ] })
      if (!key) return
      const field = key === '$add' ? await dialogs.input({ title: '字段名称' }) : key
      if (!field) return
      const initial = JSON.stringify(config[field] ?? null)
      // The public single-line dialog is limited to 500 cells. Do not truncate a configuration.
      if ([...initial].length > 240) throw new Error('此字段超过终端输入框长度，请在 Web 菜单编辑')
      const value = await dialogs.input({ title: `${field}（JSON 值）`, initial })
      if (value === undefined) return
      await model.save(id, JSON.stringify({ ...config, [field]: JSON.parse(value) }))
    }
    useEffect(() => host.onKey(event => {
      const { input, key } = event
      if (!focused || !visible || key.ctrl || key.meta || key.super) return
      if (key.upArrow || key.downArrow) {
        event.preventDefault(); setCursor(i => Math.max(0, Math.min(rows.length - 1, i + (key.upArrow ? -1 : 1)))); return
      }
      if (!['1', '2', '3', 'l', 'c', 'd', 'e', 'a', 'b', 'r', 'g'].includes(input) && !key.return) return
      event.preventDefault()
      if (busy.current) return
      busy.current = true
      void (async () => {
        const { scope, kind } = model.selection
        if (['1', '2', '3'].includes(input)) select(scope, (['plugin', 'mcp', 'skill'] as ResourceKind[])[Number(input) - 1])
        else if (input === 'l') {
          const options = model.scopes().map(item => ({ id: JSON.stringify(item.scope), label: item.label }))
          const selected = await dialogs.select({ title: '配置层级', options })
          if (selected) select(JSON.parse(selected))
        } else if (input === 'c') select({ ...ownScope(scope), children: !scope.children })
        else if (input === 'd' && scope.children) model.children(!manager.childSettings(ownScope(scope)).independent)
        else if (input === 'b') select(scope, kind)
        else if (input === 'g') {
          const settings = manager.settings()
          const choice = await dialogs.select({ title: '菜单设置', options: [
            { id: 'tree', label: `工作区树继承：${settings.inheritWorkspaceTree ? '开' : '关'}` },
            { id: 'isolation', label: `插件隔离（实验性）：${settings.pluginIsolation ? '开' : '关'}` },
          ] })
          if (choice === 'tree') await manager.setWorkspaceTreeInheritance(!settings.inheritWorkspaceTree)
          if (choice === 'isolation') await manager.setPluginIsolation(!settings.pluginIsolation)
        } else if (input !== 'r') {
          if (scope.children && !manager.childSettings(ownScope(scope)).independent) throw new Error('先按 d 将下级默认切为独立')
          const row = rows[cursor]
          if (input === 'a' && kind === 'mcp') {
            const json = await dialogs.input({ title: 'MCP 配置（JSON）', initial: '{"serverName":"my-server","transport":"stdio","command":"node","args":[]}' })
            if (json !== undefined) await model.addMcp(json)
          } else if (row && input === 'e') await edit(row.id)
          else if (row && key.return) {
            if ((row as PluginRow).components) {
              const choice = await dialogs.select({ title: row.name, options: [{ id: 'state', label: '整包开关' }, { id: 'components', label: '组件列表' }] })
              if (choice === 'components') select(scope, kind, row.id)
              if (choice === 'state') await chooseMode(row.id)
            } else await chooseMode(row.id)
          }
        }
        setNotice('')
      })().catch(error => setNotice(String(error))).finally(() => { busy.current = false; update(value => value + 1) })
    }), [model, host, focused, visible, rows, cursor])
    const scope = model.selection.scope
    const size = Math.max(1, height - 8)
    const start = Math.floor(cursor / size) * size
    return h(ui.Box, { flexDirection: 'column' },
      h(ui.Text, { bold: true }, `${levelLabel(scope)} · ${scope.children ? '下级默认' : '本级'}`),
      h(ui.Text, {}, `1 插件 | 2 MCP | 3 Skill · ${model.selection.kind}`),
      h(ui.Text, { dimColor: true }, 'l 层级 · c 本级/下级 · g 菜单设置'),
      scope.children ? h(ui.Text, {}, `下级默认：${manager.childSettings(ownScope(scope)).independent ? '独立' : '继承'}（d 切换）`) : null,
      ...rows.slice(start, start + size).map((row, i) => h(ui.Text, { key: row.id, bold: cursor === start + i },
        `${cursor === start + i ? '›' : ' '} ${row.name} [${row.own ? row.enabled ? '启用' : '关闭' : '继承'}]`)),
      !rows.length ? h(ui.Text, {}, '没有可配置的项目') : null,
      h(ui.Text, { dimColor: true }, '↑↓ 选择 · Enter 开关/组件 · e 配置'),
      h(ui.Text, { dimColor: true }, 'a 添加 MCP · b 返回列表 · r 刷新'),
      notice ? h(ui.Text, { color: 'red' }, notice) : null)
  }
}
