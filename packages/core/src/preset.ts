import type { ChildDefaults, SavedConfig } from './shared.ts'

export interface ScopePreset {
  format: 'dsh-tiered-plugin-menu'
  version: 1
  own: Record<string, SavedConfig>
  children: ChildDefaults
  bundles?: Record<string, boolean>
}

export function parsePreset(text: string): ScopePreset {
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  const settings = (value: unknown) => record(value) && Object.values(value).every(row =>
    record(row) && typeof row.enabled === 'boolean' && record(row.config))
  const input: unknown = JSON.parse(text, (key, value) => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('配置包含不可导入的字段')
    return value
  })
  if (!record(input) || input.format !== 'dsh-tiered-plugin-menu' || input.version !== 1 || !settings(input.own)
    || !record(input.children) || typeof input.children.independent !== 'boolean' || !settings(input.children.plugins)
    || input.bundles !== undefined && (!record(input.bundles) || Object.values(input.bundles).some(value => typeof value !== 'boolean'))) {
    throw new Error('不是可识别的分级插件菜单配置')
  }
  return input as unknown as ScopePreset
}
