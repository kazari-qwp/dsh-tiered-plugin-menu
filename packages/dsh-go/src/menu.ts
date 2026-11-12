import type { Context } from '@deepseek-ai/cordis'
import type { PluginManager } from 'dsh-tiered-plugin-core'
import { MenuModel, levelLabel } from 'dsh-tiered-plugin-core/model'
import { ownScope, type PluginRow, type ResourceKind, type Scope } from 'dsh-tiered-plugin-core/shared'

interface GoScope { sessionId?: string }
type Json = Record<string, any>
const button = (label: string, id: string, args: Json = {}) => ({ label, action: { id, args } })
const buttons = (...items: Json[]) => ({ type: 'actions', items })
const text = (value: string) => ({ type: 'text', text: value })
const pageSize = 5

export function mountMenu(ctx: Context, manager: PluginManager): void {
  const bridge = ctx.get('dshGo') as any
  const menus = new Map<string, { model: MenuModel; page: number; scopePage: number; edit?: string; json: string; notice: string; emitters: Set<(data: Json) => void> }>()
  const menu = (scope: GoScope) => {
    const key = scope.sessionId ?? ''
    let value = menus.get(key)
    if (!value) { value = { model: new MenuModel(manager, scope.sessionId ?? null), page: 0, scopePage: 0, json: '{}', notice: '', emitters: new Set() }; menus.set(key, value) }
    return value
  }
  const changed = (scope: GoScope, refresh = true) => {
    const state = menu(scope)
    for (const emit of state.emitters) emit({ form: { json: state.json }, nav: { scope: JSON.stringify(ownScope(state.model.selection.scope)) } })
    if (refresh) bridge.refresh('menu', scope)
  }
  async function view(scope: GoScope): Promise<Json> {
    const state = menu(scope)
    const { model } = state
    const { scope: target, kind, component } = model.selection
    const children: Json[] = [text(`${levelLabel(target)} · ${target.children ? '下级默认' : '本级'}`)]
    const scopes = model.scopes()
    children.push({ type: 'select', label: '配置层级', bind: 'data.nav.scope', value: JSON.stringify(ownScope(target)),
      options: scopes.slice(state.scopePage * 24, (state.scopePage + 1) * 24).map(item => ({ label: item.label, value: JSON.stringify(item.scope) })), onChange: 'scope' })
    if (scopes.length > 24) children.push(buttons(button('上一组层级', 'scopePage', { value: -1 }), button('下一组层级', 'scopePage', { value: 1 })))
    children.push(buttons(button('本级', 'children', { value: false }), button('下级', 'children', { value: true })))
    children.push(buttons(...(['plugin', 'mcp', 'skill'] as const).map((value, i) => button(['插件', 'MCP', 'Skill'][i]!, 'kind', { value }))))
    if (target.level === 'client' && !target.children) {
      const settings = manager.settings()
      children.push(buttons(button(`工作区树继承：${settings.inheritWorkspaceTree ? '开' : '关'}`, 'tree'),
        button(`插件隔离（实验性）：${settings.pluginIsolation ? '开' : '关'}`, 'isolation')))
      children.push(text('插件隔离重启 DSH 后生效；可能修复冲突，也可能带来新的兼容性问题。'))
    }
    if (target.children) {
      const independent = manager.childSettings(ownScope(target)).independent
      children.push(text(independent ? '下级默认：独立' : '下级默认：继承'))
      children.push(buttons(button('继承', 'policy', { value: false }), button('独立', 'policy', { value: true })))
    }
    if (state.notice) children.push(text(state.notice))
    if (model.pending) {
      const plan = model.pending
      children.push(text([...plan.dependencies.map(item => `${item.mode === 'on' ? '启用' : '关闭'}依赖：${item.name}`),
        ...(plan.unverified.length ? ['这些插件尚未声明自兼容性，确认在本级启用？'] : [])].join('\n')))
      children.push(buttons(button('确认执行', 'confirm'), button('取消', 'cancel')))
      return { v: 2, type: 'stack', children }
    }
    if (state.edit) {
      children.push(text(state.edit === '$new-mcp' ? '添加 MCP' : '编辑配置（JSON）'))
      children.push({ type: 'form', submit: 'save', submitLabel: '保存', children: [
        { type: 'textField', label: '配置 JSON', bind: 'data.form.json', multiline: true, maxLines: 8, maxLength: 2000 },
      ] })
      children.push(buttons(button('返回', 'back')))
      return { v: 2, type: 'stack', children }
    }
    if (component) children.push(buttons(button('返回插件列表', 'back')))
    const rows = await model.rows()
    state.page = Math.min(state.page, Math.max(0, Math.ceil(rows.length / pageSize) - 1))
    const disabled = target.children && !manager.childSettings(ownScope(target)).independent
    for (const row of rows.slice(state.page * pageSize, (state.page + 1) * pageSize)) {
      children.push(text(`${row.name} · ${row.own ? row.enabled ? '启用' : '关闭' : '继承'}`))
      if (!disabled) children.push(buttons(...(['inherit', 'on', 'off'] as const).filter(mode => mode !== 'inherit' || target.level !== 'client' || target.children)
        .map((mode) => button({ inherit: '继承', on: '启用', off: '关闭' }[mode], 'change', { id: row.id, mode }))))
      if ((row as PluginRow).components) children.push(buttons(button('组件', 'components', { id: row.id })))
      else if (!disabled && row.own && row.enabled) children.push(buttons(button('设置', 'edit', { id: row.id })))
    }
    if (!rows.length) children.push(text('此范围没有可配置的项目'))
    children.push(buttons(button('上一页', 'page', { value: -1 }), button(`${state.page + 1} / ${Math.max(1, Math.ceil(rows.length / pageSize))}`, 'refresh'), button('下一页', 'page', { value: 1 })))
    if (kind === 'mcp' && !disabled) children.push(buttons(button('添加 MCP', 'add')))
    return { v: 2, type: 'stack', children }
  }
  const run = (action: (state: ReturnType<typeof menu>, value: Json) => void | Promise<void>, deferred = true) => (scope: GoScope, event: { value?: Json }) => {
    const result = async () => {
      const state = menu(scope)
      // Immediate inputs refresh through their response, so the client can accept
      // the result before replacing the view that owns the input request.
      try { await action(state, event.value ?? {}); state.notice = ''; changed(scope, deferred); return deferred ? { toast: '已更新' } : { refresh: true } }
      catch (error) { state.notice = String(error); changed(scope, deferred); return deferred ? { toast: String(error).slice(0, 180) } : { refresh: true } }
    }
    return deferred ? { pending: { label: '正在处理', timeoutMs: 60000 }, result } : result()
  }
  bridge.panel('menu', {
    view,
    data(scope: GoScope, emit: (data: Json) => void) {
      const state = menu(scope); state.emitters.add(emit)
      emit({ form: { json: state.json }, nav: { scope: JSON.stringify(ownScope(state.model.selection.scope)) } })
      return () => { state.emitters.delete(emit) }
    },
    actions: {
      scope: run((s, v) => { s.model.select({ ...s.model.selection, scope: JSON.parse(v.value) as Scope, component: undefined }); s.page = 0; s.edit = undefined }, false),
      scopePage: run((s, v) => { s.scopePage = Math.max(0, Math.min(Math.ceil(s.model.scopes().length / 24) - 1, s.scopePage + v.value)) }, false),
      children: run((s, v) => { s.model.select({ ...s.model.selection, scope: { ...ownScope(s.model.selection.scope), children: !!v.value } }); s.edit = undefined }),
      kind: run((s, v) => { s.model.select({ ...s.model.selection, kind: v.value as ResourceKind, component: undefined }); s.page = 0; s.edit = undefined }),
      policy: run((s, v) => s.model.children(!!v.value)),
      tree: run(() => manager.setWorkspaceTreeInheritance(!manager.settings().inheritWorkspaceTree)),
      isolation: run(() => manager.setPluginIsolation(!manager.settings().pluginIsolation)),
      change: run((s, v) => s.model.change(v.id, v.mode)), confirm: run(s => s.model.confirm()), cancel: run(s => { s.model.pending = undefined }),
      components: run((s, v) => { s.model.select({ ...s.model.selection, component: v.id }); s.page = 0 }),
      edit: run(async (s, v) => {
        const json = JSON.stringify(await s.model.config(v.id), null, 2)
        if ([...json].length > 2000 || Buffer.byteLength(JSON.stringify({ values: { 'data.form.json': json } })) > 3800) throw new Error('配置超过手机输入限制，请在 Web 菜单编辑')
        s.json = json; s.edit = v.id
      }),
      add: run(s => { s.edit = '$new-mcp'; s.json = JSON.stringify({ serverName: 'my-server', transport: 'stdio', command: 'node', args: [] }, null, 2) }),
      save: run(async (s, v) => { const json = v.values['data.form.json']; if (s.edit === '$new-mcp') await s.model.addMcp(json); else await s.model.save(s.edit!, json); s.edit = undefined }),
      back: run(s => { if (s.edit) s.edit = undefined; else s.model.select({ ...s.model.selection, component: undefined }) }),
      page: run((s, v) => { s.page = Math.max(0, s.page + v.value) }), refresh: run(() => {}),
    },
  })
  ctx.effect(() => () => menus.clear())
}
