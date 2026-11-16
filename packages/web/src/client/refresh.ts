import type { MenuRemote } from 'dsh-tiered-plugin-core/remote-contract'
import { scopeKey, type PluginRow, type Scope } from 'dsh-tiered-plugin-core/shared'

export type ReadRows = (scope: Scope) => Promise<PluginRow[]>

/** Share concurrent reads and one discovery pass, without retaining stale settings. */
export function rowReader(api: MenuRemote) {
  const pending = new Map<string, Promise<PluginRow[]>>()
  const read: ReadRows = scope => {
    const key = scopeKey(scope)
    let request = pending.get(key)
    if (!request) {
      request = api.list(scope).then(result => {
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      }).finally(() => { if (pending.get(key) === request) pending.delete(key) })
      pending.set(key, request)
    }
    return request
  }
  return {
    read,
    invalidate() { pending.clear() },
    snapshot(): ReadRows {
      const rows = new Map<string, Promise<PluginRow[]>>()
      return scope => {
        const key = scopeKey(scope)
        if (!rows.has(key)) rows.set(key, read(scope))
        return rows.get(key)!
      }
    },
  }
}

/** A burst schedules one pass; changes during a pass schedule one follow-up. */
export function coalesce(run: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | undefined
  let dirty = false
  return () => {
    dirty = true
    return pending ??= Promise.resolve().then(async () => {
      try { do { dirty = false; await run() } while (dirty) }
      finally { pending = undefined }
    })
  }
}
