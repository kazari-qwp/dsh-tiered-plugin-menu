import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'

interface Owner { accepts(sessionId: string): boolean }
interface Binding { owner: Owner; value: unknown; dispose?: () => unknown }
interface Selection { binding?: Binding; sessionId?: string; catalog?: boolean }

const routers = new WeakMap<Context, Map<string, ScopedSlot>>()

/** Preserve native service behavior while separating its single registration slot. */
export class ScopedSlot {
  private selected = new AsyncLocalStorage<Selection>()
  private bindings: Binding[] = []
  private restore: (() => void)[] = []
  private native: any

  constructor(private root: Context, service: string, slot: string) {
    this.native = root.get(service)
    const native = this.native
    const descriptor = Object.getOwnPropertyDescriptor(native, slot)
    let globalValue = native[slot]
    const binding = () => {
      const selected = this.selected.getStore()
      if (selected?.binding) return selected.binding
      if (selected?.sessionId) return this.bindings.find(item => item.value !== undefined && item.owner.accepts(selected.sessionId!))
      if (selected?.catalog) return this.bindings.find(item => item.value !== undefined)
    }
    Object.defineProperty(native, slot, { configurable: true,
      get: () => { const current = binding(); return current ? current.value : globalValue },
      set: value => { const current = binding(); if (current) current.value = value; else globalValue = value },
    })
    this.restore.push(() => {
      if (descriptor) Object.defineProperty(native, slot, { ...descriptor, value: globalValue })
      else { delete native[slot]; native[slot] = globalValue }
    })
    const wrapped = new Set<string>()
    for (let object = native; object && object !== Object.prototype; object = Object.getPrototypeOf(object)) {
      for (const name of Object.getOwnPropertyNames(object)) {
        if (name === 'constructor' || wrapped.has(name)) continue
        const method = Object.getOwnPropertyDescriptor(object, name)?.value
        if (typeof method !== 'function') continue
        wrapped.add(name)
        const own = Object.getOwnPropertyDescriptor(native, name)
        const router = this
        Object.defineProperty(native, name, { configurable: true, writable: true, value: function(this: unknown, ...args: any[]) {
          const session = args.find(value => value && typeof value.snapshotEvents === 'function')
            ?? args.find(value => value?.session)?.session
          const sessionId = session?.id ?? args.find(value => value?.sessionId)?.sessionId
            ?? args.find(value => value?.scope?.level === 'session' || value?.scope?.type === 'session')?.scope?.id
          const selection = sessionId ? { sessionId: String(sessionId) }
            : name === 'catalog' ? { ...router.selected.getStore(), catalog: true } : undefined
          return selection ? router.selected.run(selection, () => method.apply(this, args)) : method.apply(this, args)
        } })
        this.restore.push(() => { if (own) Object.defineProperty(native, name, own); else delete native[name] })
      }
    }
  }

  register(ctx: Context, owner: Owner, method: string, value: unknown) {
    const binding: Binding = { owner, value: undefined }
    const release = ctx.effect(() => {
      this.bindings.push(binding)
      let dispose: () => unknown
      try { dispose = this.selected.run({ binding }, () => this.native[method](value)) }
      catch (error) { this.bindings.splice(this.bindings.indexOf(binding), 1); throw error }
      return async () => {
        await this.selected.run({ binding }, () => dispose())
        this.bindings.splice(this.bindings.indexOf(binding), 1)
      }
    })
    binding.dispose = release
    // Native register() may attach an effect to the host context. Collect its
    // routed release after registration so host shutdown also enters the binding.
    this.root.effect(() => release)
    return release
  }

  async dispose() {
    // Keep routing in place until native disposers have cleared their own slots.
    for (const binding of [...this.bindings]) await binding.dispose?.()
    for (const restore of this.restore.reverse()) restore()
    this.selected.disable()
  }
}

export function scopedSlot(ctx: Context, service: string, slot: string) {
  let map = routers.get(ctx)
  if (!map) {
    map = new Map(); routers.set(ctx, map)
    ctx.effect(() => async () => { for (const router of map!.values()) await router.dispose(); routers.delete(ctx) })
  }
  const key = `${service}/${slot}`
  if (!map.has(key)) map.set(key, new ScopedSlot(ctx, service, slot))
  return map.get(key)!
}
