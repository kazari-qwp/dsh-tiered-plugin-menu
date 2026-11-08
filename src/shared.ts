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
  settings: 'temporary-messages' | 'native' | 'registered'
}
export interface MenuContext {
  workspaces: { id: string; title: string; path: string }[]
  workspaceId: string | null
}

// 适配表只声明包和服务名；各层共用同一套实例、配置和事件路由。
export const adapters = [{
  id: 'temporary-messages', name: '临时消息', package: 'dsh-temporary-messages',
  services: ['temporaryMessages', 'temporaryMessageCompressors', 'temporaryMessagesUi'],
  uiService: 'temporaryMessagesUi',
  scopedRegistries: false,
}, {
  id: 'dsh-context', name: 'dsh-context', package: 'dsh-context',
  services: [], uiService: undefined, scopedRegistries: true,
}] as const

export type Adapter = typeof adapters[number]

/** package.json 中由插件作者声明；未声明的层级保持未验证。 */
export interface TieredPluginMetadata {
  verifiedScopes?: ('workspace' | 'session')[]
}
