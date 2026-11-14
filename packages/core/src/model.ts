import type { PluginManager } from './manager.ts'
import { clientScope, ownScope, type ChangeMode, type ChangePlan, type PluginConfig, type PluginRow, type ResourceKind, type Scope, type SkillRow } from './shared.ts'

export interface MenuSelection { scope: Scope; kind: ResourceKind; component?: string }
export const levelLabel = (scope: Scope) => ({ client: '客户端', workspace: '工作区', session: '会话' }[scope.level])

/** Presentation-independent menu actions; web/terminal/mobile use the same manager. */
export class MenuModel {
  selection: MenuSelection
  pending?: ChangePlan
  constructor(readonly manager: PluginManager, readonly sessionId: string | null) {
    this.selection = { scope: sessionId ? { level: 'session', id: sessionId } : clientScope, kind: 'plugin' }
  }

  scopes() {
    const context = this.manager.context(this.sessionId)
    return [
      { scope: clientScope, label: '客户端' },
      ...context.workspaces.map(workspace => ({ scope: { level: 'workspace' as const, id: workspace.id }, label: workspace.title || workspace.path })),
      ...(this.sessionId ? [{ scope: { level: 'session' as const, id: this.sessionId }, label: '当前会话' }] : []),
    ]
  }

  select(selection: MenuSelection): void { this.selection = selection; this.pending = undefined }
  async rows(): Promise<(PluginRow | SkillRow)[]> {
    const { scope, kind, component } = this.selection
    if (kind === 'skill') return this.manager.skills.rows(scope)
    const rows = (await this.manager.rows(scope)).filter(row => kind === 'mcp' ? row.kind === 'mcp'
      : row.kind !== 'mcp' && !!row.official === (kind === 'official'))
    return component ? rows.find(row => row.id === component)?.components ?? []
      : rows.map(row => row.bundleEnabled === undefined ? row : { ...row, enabled: row.bundleEnabled, partial: false })
  }

  async change(id: string, mode: ChangeMode): Promise<void> {
    this.pending = undefined
    const { scope, kind } = this.selection
    if (kind === 'skill') {
      if (mode === 'inherit') await this.manager.skills.inherit(scope, id)
      else {
        const config = await this.manager.skills.config(scope, id)
        await this.manager.skills.configure(scope, id, mode === 'on', config)
      }
      return
    }
    const plan = await this.manager.plan(scope, id, mode)
    if (plan.missing.length) throw new Error(`缺少依赖：${plan.missing.join('、')}`)
    if (plan.dependencies.length || plan.unverified.length) { this.pending = plan; return }
    await this.manager.change(scope, id, mode, plan.signature)
  }

  async confirm(): Promise<void> {
    const plan = this.pending
    if (!plan) return
    await this.manager.change(plan.scope, plan.id, plan.mode, plan.signature)
    this.pending = undefined
  }

  async config(id: string): Promise<PluginConfig> {
    return this.selection.kind === 'skill' ? this.manager.skills.config(this.selection.scope, id)
      : (await this.rows()).find(row => row.id === id)!.config
  }

  async save(id: string, text: string): Promise<void> {
    const config = JSON.parse(text)
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('配置应为 JSON 对象')
    const row = (await this.rows()).find(row => row.id === id)
    if (!row?.own) throw new Error('请先选择本级启用或关闭，再编辑配置')
    if (this.selection.kind === 'skill') await this.manager.skills.configure(this.selection.scope, id, row.enabled, config)
    else await this.manager.saveConfig(this.selection.scope, id, config)
  }

  async addMcp(text: string): Promise<void> {
    const config = JSON.parse(text)
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('MCP 配置应为 JSON 对象')
    await this.manager.addMcp(this.selection.scope, config)
  }

  children(independent: boolean): void { this.manager.setChildSettings(ownScope(this.selection.scope), independent) }
  resetChildren(): void { this.manager.resetChildSettings(ownScope(this.selection.scope)); this.pending = undefined }
}
