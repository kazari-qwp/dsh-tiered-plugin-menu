import type { RemoteResult, TypertCodec, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { ChildSettings, MenuContext, MenuSettings, Scope, PluginConfig, PluginRow, ChangeMode, ChangePlan, SkillRow } from './shared.ts'

export interface MenuRemote {
  settings(): Promise<RemoteResult<MenuSettings>>
  setWorkspaceTreeInheritance(enabled: boolean): Promise<RemoteResult<void>>
  setPluginIsolation(enabled: boolean): Promise<RemoteResult<void>>
  context(sessionId: string | null): Promise<RemoteResult<MenuContext>>
  list(scope: Scope): Promise<RemoteResult<PluginRow[]>>
  addMcp(scope: Scope, config: PluginConfig): Promise<RemoteResult<string>>
  skills(scope: Scope): Promise<RemoteResult<SkillRow[]>>
  skillConfig(scope: Scope, name: string): Promise<RemoteResult<PluginConfig>>
  configureSkill(scope: Scope, name: string, enabled: boolean, config: PluginConfig): Promise<RemoteResult<void>>
  inheritSkill(scope: Scope, name: string): Promise<RemoteResult<void>>
  childSettings(scope: Scope): Promise<RemoteResult<ChildSettings>>
  setChildSettings(scope: Scope, independent: boolean): Promise<RemoteResult<void>>
  resetChildSettings(scope: Scope): Promise<RemoteResult<void>>
  plan(scope: Scope, id: string, mode: ChangeMode): Promise<RemoteResult<ChangePlan>>
  change(scope: Scope, id: string, mode: ChangeMode, signature: string): Promise<RemoteResult<void>>
  call(scope: Scope, id: string, namespace: string, method: string, args: PluginConfig): Promise<RemoteResult<unknown>>
  inherit(scope: Scope, id: string): Promise<RemoteResult<void>>
  saveConfig(scope: Scope, id: string, config: PluginConfig): Promise<RemoteResult<void>>
  configure(scope: Scope, id: string, enabled: boolean, config: PluginConfig, confirmed: boolean): Promise<RemoteResult<void>>
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap { tieredPluginMenu: MenuRemote }
}

const codec = (kind: string): TypertCodec => ({ mode: 'strict', typeSymbol: kind, create: () => ({
  parse(value: unknown) {
    const valid = kind === 'session' ? value === null || typeof value === 'string'
      : kind === 'scope' ? !!value && typeof value === 'object' && ['client', 'workspace', 'session'].includes((value as Scope).level) && typeof (value as Scope).id === 'string'
        && ((value as Scope).children === undefined || typeof (value as Scope).children === 'boolean')
      : kind === 'config' ? value !== null && typeof value === 'object' && !Array.isArray(value)
        : kind === 'args' ? Array.isArray(value) : typeof value === kind
    if (!valid) throw new TypeError(`参数应为 ${kind}`)
    return value
  },
}) })

export const remoteContribution: TypertRemoteContribution = {
  package: 'dsh-tiered-plugin-menu',
  descriptors: [
    ['settings', []],
    ['setWorkspaceTreeInheritance', [['enabled', 'boolean']]],
    ['setPluginIsolation', [['enabled', 'boolean']]],
    ['context', [['sessionId', 'session']]],
    ['list', [['scope', 'scope']]],
    ['addMcp', [['scope', 'scope'], ['config', 'config']]],
    ['skills', [['scope', 'scope']]],
    ['skillConfig', [['scope', 'scope'], ['name', 'string']]],
    ['configureSkill', [['scope', 'scope'], ['name', 'string'], ['enabled', 'boolean'], ['config', 'config']]],
    ['inheritSkill', [['scope', 'scope'], ['name', 'string']]],
    ['childSettings', [['scope', 'scope']]],
    ['setChildSettings', [['scope', 'scope'], ['independent', 'boolean']]],
    ['resetChildSettings', [['scope', 'scope']]],
    ['plan', [['scope', 'scope'], ['id', 'string'], ['mode', 'string']]],
    ['change', [['scope', 'scope'], ['id', 'string'], ['mode', 'string'], ['signature', 'string']]],
    ['call', [['scope', 'scope'], ['id', 'string'], ['namespace', 'string'], ['method', 'string'], ['args', 'config']]],
    ['inherit', [['scope', 'scope'], ['id', 'string']]],
    ['saveConfig', [['scope', 'scope'], ['id', 'string'], ['config', 'config']]],
    ['configure', [['scope', 'scope'], ['id', 'string'], ['enabled', 'boolean'], ['config', 'config'], ['confirmed', 'boolean']]],
  ].map(([method, parameters]) => ({
    id: `tieredPluginMenu/${method}`, service: 'tieredPluginMenu', namespace: 'tieredPluginMenu', method: method as string,
    invocation: { kind: 'direct' as const },
    parameters: (parameters as string[][]).map(([name, kind]) => ({ name, wire: name, source: 'json' as const, codec: codec(kind!) })),
    cancellation: { parameter: 'signal' }, result: { mode: 'src-json' as const },
  })),
}
