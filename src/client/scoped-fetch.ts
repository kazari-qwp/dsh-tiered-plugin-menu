import { scopeKey, type PluginRow } from '../shared.ts'

/** Same-origin plugin routes carry the currently selected instance, including pages without a sessionId. */
export function scopePluginFetch() {
  let rows: PluginRow[] = []
  const previous = globalThis.fetch
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, globalThis.location?.href ?? 'http://localhost')
    const sameOrigin = !globalThis.location || url.origin === globalThis.location.origin
    const row = sameOrigin && rows.find(row => row.routes?.some(path => url.pathname === path || url.pathname.startsWith(`${path}/`)))
    if (!row) return previous(input, init)
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.set('x-dsh-tiered-scope', row.enabled ? scopeKey(row.source) : 'disabled')
    return previous(input, { ...init, headers })
  }
  globalThis.fetch = fetch
  return {
    select(row: PluginRow) { rows = row.components ?? [row] },
    dispose() { rows = []; if (globalThis.fetch === fetch) globalThis.fetch = previous },
  }
}
