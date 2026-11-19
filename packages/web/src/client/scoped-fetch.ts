import { scopeKey, type PluginRow } from 'dsh-tiered-plugin-core/shared'
import { installFetchBridge } from '../fetch-bridge.ts'

/** Same-origin plugin routes carry the currently selected instance, including pages without a sessionId. */
export function scopePluginFetch() {
  let rows: PluginRow[] = []
  const dispose = installFetchBridge(globalThis).use((input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, globalThis.location?.href ?? 'http://localhost')
    const sameOrigin = !globalThis.location || url.origin === globalThis.location.origin
    const row = sameOrigin && rows.find(row => row.routes?.some(path => url.pathname === path || url.pathname.startsWith(`${path}/`)))
    if (!row) return undefined
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.set('x-dsh-tiered-scope', row.enabled ? scopeKey(row.source) : 'disabled')
    if (row.routePrefix) {
      url.pathname = row.routePrefix + url.pathname
      input = input instanceof Request ? new Request(url, input) : url
    }
    return [input, { ...init, headers }]
  })
  return {
    select(row: PluginRow) { rows = row.components ?? [row] },
    dispose,
  }
}
