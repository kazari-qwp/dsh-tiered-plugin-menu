export type Level = 'client' | 'workspace' | 'session'
export interface Scope { level: Level; id: string }
export const clientScope: Scope = { level: 'client', id: '' }
export const scopeKey = (scope: Scope): string => `${scope.level}:${scope.id}`
export type PluginConfig = Record<string, unknown>

export interface SavedConfig { enabled: boolean; config: PluginConfig }
export interface PluginRow extends SavedConfig {
  id: string
  name: string
  package: string
  description: string
  own: boolean
  source: Scope
  active: boolean
  managed?: boolean
  verified: boolean
  settings: 'native' | 'registered'
  /** The installed package is the list item; components are shown in its details. */
  components?: PluginRow[]
  partial?: boolean
  configNamespace?: string
  routes?: string[]
}
export interface MenuContext {
  workspaces: { id: string; title: string; path: string }[]
  workspaceId: string | null
}

export type ChangeMode = 'on' | 'off' | 'inherit'
export interface PlannedChange { scope: Scope; id: string; name: string; mode: ChangeMode }
export interface ChangePlan {
  scope: Scope
  id: string
  mode: ChangeMode
  changes: PlannedChange[]
  dependencies: PlannedChange[]
  missing: string[]
  unverified: string[]
  signature: string
}

/** package.json 中由插件作者声明；未声明的层级保持未验证。 */
export interface TieredPluginMetadata {
  verifiedScopes?: ('workspace' | 'session')[]
}
