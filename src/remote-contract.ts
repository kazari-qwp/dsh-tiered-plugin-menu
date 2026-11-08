import type { RemoteResult, TypertCodec, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { MenuContext, Scope, PluginConfig, PluginRow, ChangeMode, ChangePlan } from './shared.ts'

export interface MenuRemote {
  context(sessionId: string | null): Promise<RemoteResult<MenuContext>>
  list(scope: Scope): Promise<RemoteResult<PluginRow[]>>
  plan(scope: Scope, id: string, mode: ChangeMode): Promise<RemoteResult<ChangePlan>>
  change(scope: Scope, id: string, mode: ChangeMode, signature: string): Promise<RemoteResult<void>>
  call(scope: Scope, id: string, namespace: string, method: string, args: PluginConfig): Promise<RemoteResult<unknown>>
  inherit(scope: Scope, id: string): Promise<RemoteResult<void>>
  configure(scope: Scope, id: string, enabled: boolean, config: PluginConfig, confirmed: boolean): Promise<RemoteResult<void>>
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap { tieredPluginMenu: MenuRemote }
}

const codec = (kind: string): TypertCodec => ({ mode: 'strict', typeSymbol: kind, create: () => ({
  parse(value: unknown) {
    const valid = kind === 'session' ? value === null || typeof value === 'string'
      : kind === 'scope' ? !!value && typeof value === 'object' && ['client', 'workspace', 'session'].includes((value as Scope).level) && typeof (value as Scope).id === 'string'
      : kind === 'config' ? value !== null && typeof value === 'object' && !Array.isArray(value)
        : kind === 'args' ? Array.isArray(value) : typeof value === kind
    if (!valid) throw new TypeError(`参数应为 ${kind}`)
    return value
  },
}) })

export const remoteContribution: TypertRemoteContribution = {
  package: 'dsh-tiered-plugin-menu',
  descriptors: [
    ['context', [['sessionId', 'session']]],
    ['list', [['scope', 'scope']]],
    ['plan', [['scope', 'scope'], ['id', 'string'], ['mode', 'string']]],
    ['change', [['scope', 'scope'], ['id', 'string'], ['mode', 'string'], ['signature', 'string']]],
    ['call', [['scope', 'scope'], ['id', 'string'], ['namespace', 'string'], ['method', 'string'], ['args', 'config']]],
    ['inherit', [['scope', 'scope'], ['id', 'string']]],
    ['configure', [['scope', 'scope'], ['id', 'string'], ['enabled', 'boolean'], ['config', 'config'], ['confirmed', 'boolean']]],
  ].map(([method, parameters]) => ({
    id: `tieredPluginMenu/${method}`, service: 'tieredPluginMenu', namespace: 'tieredPluginMenu', method: method as string,
    invocation: { kind: 'direct' as const },
    parameters: (parameters as string[][]).map(([name, kind]) => ({ name, wire: name, source: 'json' as const, codec: codec(kind!) })),
    cancellation: { parameter: 'signal' }, result: { mode: 'src-json' as const },
  })),
}
