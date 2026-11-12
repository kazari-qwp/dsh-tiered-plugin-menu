import type { Context } from '@deepseek-ai/cordis'
import { registrationOwner, type RegistrationOwner, type PluginManager } from 'dsh-tiered-plugin-core'

interface Scope { sessionId?: string }
type Callback = (...args: any[]) => any
type Definition = Callback | { view: unknown; data?: Callback; actions?: Record<string, Callback> }
interface Entry { ctx: Context; owner: RegistrationOwner; value: Definition }
interface Group { entries: Entry[]; actions: Record<string, Callback>; dispose?: () => void }

/** Route public dshGo registrations; unrelated service operations stay native. */
export function installNativeRouting(ctx: Context, manager?: PluginManager): void {
  const service = ctx.get('dshGo') as any
  const groups = new Map<string, Group>()
  const originals = new Map<string, Callback>()
  const feeds = new Set<() => Promise<void>>()
  if (manager) ctx.effect(() => manager.onInstancesChanged(async () => {
    for (const refresh of feeds) await refresh()
  }))
  const pick = (group: Group, scope: Scope) => group.entries.find(entry => scope.sessionId
    ? entry.owner.accepts(scope.sessionId) : entry.owner.scope.level === 'client')
  const unavailable = () => ({ toast: '此会话未启用该插件' })
  for (const method of ['panel', 'strip', 'turnNote', 'on', 'media', 'micro', 'onCapability']) {
    const original = service[method] as Callback | undefined
    if (!original) continue
    originals.set(method, original)
    service[method] = function (this: { ctx: Context }, ...args: any[]) {
      const caller = this.ctx
      const owner = registrationOwner(caller)
      if (!owner) return original.apply(this, args)
      const [id, value] = method === 'onCapability' ? ['events', args[0]] : args
      const key = `${owner.package}\0${method}\0${id}`
      let group = groups.get(key)
      if (!group) { group = { entries: [], actions: {} }; groups.set(key, group) }
      const selected = (scope: Scope) => pick(group!, scope)?.value as any
      const data = async (scope: Scope, emit: Callback, caps: unknown) => {
        let current: Entry | undefined, cancel: (() => void) | undefined, live = true, started = false
        const refresh = async () => {
          const entry = pick(group!, scope)
          if (started && current === entry) return
          current = entry
          cancel?.(); cancel = undefined
          if (started && group!.entries.length) service.refresh.call({ ctx: group!.entries[0]!.ctx }, id, scope)
          started = true
          emit(null)
          const def = entry?.value as any
          const fn = typeof def === 'function' ? def : def?.data
          if (!fn) return
          const stop = await fn(scope, (value: unknown) => {
            if (live && current === entry && pick(group!, scope) === entry) emit(value)
          }, caps)
          if (live && current === entry) cancel = stop
          else stop?.()
        }
        feeds.add(refresh)
        try { await refresh() }
        catch (error) { feeds.delete(refresh); throw error }
        return () => { live = false; feeds.delete(refresh); cancel?.() }
      }
      const mount = () => {
        if (!group!.entries.length) { group!.dispose?.(); group!.dispose = undefined; groups.delete(key); return }
        const actions = new Set(group!.entries.flatMap(entry => Object.keys((entry.value as any).actions ?? {})))
        for (const key of Object.keys(group!.actions)) if (!actions.has(key)) delete group!.actions[key]
        for (const action of actions) group!.actions[action] ??= (scope: Scope, event: unknown) => {
          const handler = selected(scope)?.actions?.[action]
          return handler ? handler(scope, event) : unavailable()
        }
        // Keep one native registration alive. Replacing it ends every session's stream.
        if (group!.dispose) return
        let routed: unknown
        if (method === 'panel') {
          routed = {
            view: (scope: Scope, caps: unknown) => {
              const def = selected(scope)
              return typeof def?.view === 'function' ? def.view(scope, caps) : def?.view
                ?? { v: 1, type: 'text', text: '此会话未启用该插件' }
            }, data,
            actions: group!.actions,
          }
        } else if (['strip', 'turnNote', 'micro'].includes(method)) routed = { data }
        else routed = (scope: Scope, event: unknown) => {
          const handler = selected(scope)
          if (handler) return handler(scope, event)
          if (method === 'media') throw new Error('此会话未启用该插件')
          return method === 'onCapability' ? undefined : unavailable()
        }
        // Preserve the caller's package identity, but own the shared registration in the core.
        const registration = caller.extend({ effect: ctx.effect.bind(ctx) })
        group!.dispose = original.call({ ctx: registration }, ...(method === 'onCapability' ? [routed] : [id, routed]))
      }
      return caller.effect(() => {
        const entry = { ctx: caller, owner, value }; group!.entries.push(entry)
        mount()
        return () => { group!.entries.splice(group!.entries.indexOf(entry), 1); mount() }
      })
    }
  }
  ctx.effect(() => () => {
    for (const [method, original] of originals) service[method] = original
    for (const group of groups.values()) group.dispose?.()
    groups.clear()
    feeds.clear()
  })
}
