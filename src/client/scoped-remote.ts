import type { Context } from '@deepseek-ai/cordis'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { MenuRemote } from '../remote-contract.ts'
import type { PluginRow, Scope } from '../shared.ts'

/** Bind the original client's declared Remote methods to the selected host instance. */
export function scopedRemote(ctx: Context, api: MenuRemote, row: PluginRow, scope: Scope) {
  const services: Record<string, any> = {}
  const provided = new Set<string>()
  return new Proxy({}, { get(_target, key) {
    if (key === '$mount') return async (contribution: TypertRemoteContribution) => {
      const disposers: (() => void)[] = []
      for (const descriptor of contribution.descriptors) {
        const service = services[descriptor.namespace] ??= {}
        service[descriptor.method] = (...values: unknown[]) => api.call(scope, row.id, descriptor.namespace, descriptor.method,
          Object.fromEntries(descriptor.parameters.map((parameter, index) => [parameter.wire, values[index]])))
      }
      for (const namespace of new Set(contribution.descriptors.map(descriptor => descriptor.namespace))) {
        if (provided.has(namespace)) continue
        provided.add(namespace)
        const remove = ctx.provide(`remote.${namespace}`, services[namespace])
        disposers.push(() => { provided.delete(namespace); remove() })
      }
      return () => { for (const dispose of disposers) dispose() }
    }
    return services[String(key)]
  } })
}
