export type Level = 'client' | 'workspace' | 'session'
export interface Scope { level: Level; id: string; children?: boolean }
export const clientScope: Scope = { level: 'client', id: '' }
export const scopeKey = (scope: Scope): string => `${scope.children ? 'children:' : ''}${scope.level}:${scope.id}`
export const ownScope = ({ level, id }: Scope): Scope => ({ level, id })
export const childScope = (scope: Scope): Scope => ({ ...ownScope(scope), children: true })
export const isClientScope = (scope: Scope): boolean => scope.level === 'client' && !scope.children
export type PluginConfig = Record<string, unknown>

export interface SavedConfig { enabled: boolean; config: PluginConfig }
export interface ChildDefaults { independent: boolean; plugins: Record<string, SavedConfig> }
export interface ChildSettings { independent: boolean; source: Scope | null }
export interface MenuSettings { inheritWorkspaceTree: boolean; pluginIsolation: boolean }
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
  routePrefix?: string
  projections?: Record<string, string>
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

/** 插件作者在 package.json 中声明自兼容性：同一插件的多个独立实例能否共存。 */
export interface TieredPluginMetadata {
  selfCompatible?: boolean
}
