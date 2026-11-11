import { AsyncLocalStorage } from 'node:async_hooks'
import { Context, Service } from '@deepseek-ai/cordis'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { clientScope, scopeKey, type Scope } from './shared.ts'

interface Declaration { config: { id: string }; [key: string]: unknown }
interface Registration { scope: Scope; applies(view: Scope): boolean }
interface Lookup { scope: Scope; registration?: Registration }

/** DSH 0.2.2 keeps declarations here; its revision leases and Agent bindings stay native. */
interface Registry {
  definitions: Map<string, Declaration>
  owner: Context
  [method: string]: any
}

/** A declaration keeps its public ID. Only its lookup table is scoped. */
class Declarations extends Map<string, Declaration> {
  readonly tables = new Map<string, Map<string, Declaration>>()
  private owners = new WeakMap<Declaration, Registration>()

  constructor(readonly original: Map<string, Declaration>, private lookup: () => Lookup,
    private chain: (scope: Scope) => Scope[]) {
    super()
    this.tables.set(scopeKey(clientScope), original)
  }

  private own() {
    const key = scopeKey(this.lookup().scope)
    let table = this.tables.get(key)
    if (!table) { table = new Map(); this.tables.set(key, table) }
    return table
  }

  private view() {
    const lookup = this.lookup()
    if (lookup.registration) return this.own()
    const view = new Map<string, Declaration>()
    for (const scope of this.chain(lookup.scope).reverse()) {
      for (const [id, record] of this.tables.get(scopeKey(scope)) ?? []) {
        const owner = this.owners.get(record)
        if (!owner || owner.applies(lookup.scope)) view.set(id, record)
      }
    }
    return view
  }

  override get size() { return this.view().size }
  override get(id: string) { return this.view().get(id) }
  override has(id: string) { return this.view().has(id) }
  override set(id: string, record: Declaration) {
    const owner = this.lookup().registration
    if (owner) this.owners.set(record, owner)
    this.own().set(id, record)
    return this
  }
  override delete(id: string) { return this.own().delete(id) }
  override keys() { return this.view().keys() }
  override values() { return this.view().values() }
  override entries() { return this.view().entries() }
  override [Symbol.iterator]() { return this.entries() }
}

export class ScopedPresets {
  private lookup = new AsyncLocalStorage<Lookup>()
  private registry: Registry
  private restores: (() => void)[] = []

  constructor(private ctx: Context, private chain: (scope: Scope) => Scope[],
    private realm: (scope: Scope) => Context,
    private withSession: <T>(id: string, resume: () => Promise<T>) => Promise<T> = (_id, resume) => resume()) {
    const service = ctx.get('agentPresets') as any
    const registry = this.registry = (service[Symbol.for('cordis.original')] ?? service) as Registry
    const definitions = registry.definitions
    const owner = registry.owner
    registry.definitions = new Declarations(definitions, () => this.current(), chain)
    // Preset rows must see the services of the registering workspace/session too.
    Object.defineProperty(registry, 'owner', { configurable: true, get: () => {
      const registration = this.lookup.getStore()?.registration
      return registration ? owner.extend({ [Context.isolate]: this.realm(registration.scope)[Context.isolate] }) : owner
    } })
    const restores = this.restores
    for (const method of ['mount', 'recompose', 'select']) {
      const original = registry[method]
      const self = this
      registry[method] = function (subject: any, ...args: any[]) {
        const context = method === 'select' ? subject.ctx : subject
        const key = scopeOf(context) as { id?: string } | undefined
        const scope = key?.id ? { level: 'session' as const, id: String(key.id) } : self.current().scope
        // Before publication, the controller's workspace is the known parent.
        const current = self.current()
        const parent = self.chain(scope)[1]
        const view = parent?.level === 'client' && current.scope.level !== 'client' ? current.scope : scope
        return self.lookup.run({ scope: view }, () => original.call(this, subject, ...args))
      }
      restores.push(() => { registry[method] = original })
    }
    restores.push(() => {
      registry.definitions = definitions
      Object.defineProperty(registry, 'owner', { configurable: true, writable: true, value: owner })
    })
    ctx.effect(() => ctx.inject(['sessionController'], child => {
      const service = child.get('sessionController') as any
      const controller = service[Symbol.for('cordis.original')] ?? service
      const originals = new Map<string, (...args: any[]) => any>()
      for (const method of ['create', 'resolveAgent']) {
        const original = controller[method]
        originals.set(method, original)
        const self = this
        controller[method] = async function (...args: any[]) {
          const request = args[0]
          let scope: Scope
          if (method === 'resolveAgent') scope = { level: 'session', id: String(request) }
          else {
            const workspace = request.workspaceId ? ctx.workspaceRegistry.get(request.workspaceId)
              : request.cwd ? await ctx.workspaceRegistry.resolveByPath(request.cwd) : undefined
            const session = request.sessionId && { level: 'session' as const, id: String(request.sessionId) }
            scope = session && self.chain(session).length > 2 ? session
              : workspace ? { level: 'workspace', id: String(workspace.id) } : self.current().scope
          }
          // A scoped plugin may create a separate workspace; resolve there first.
          const run = () => self.lookup.run({ scope }, () => original.apply(this, args))
          return method === 'resolveAgent' ? self.withSession(String(request), run) : run()
        }
      }
      child.effect(() => () => { for (const [method, original] of originals) controller[method] = original })
    }).dispose)
  }

  private current(): Lookup { return this.lookup.getStore() ?? { scope: clientScope } }

  read<T>(scope: Scope, read: () => T): T { return this.lookup.run({ scope }, read) }

  /** Restore the host only after all managed registrations have been released. */
  dispose(): void { for (const restore of this.restores.splice(0)) restore() }

  facade(context: Context, registration: Registration): object {
    const registry = this.registry
    const self = this
    return new Proxy({ ctx: context, [Service.tracker]: { property: 'ctx' } }, { get: (target, key) => {
      if (key in target) return Reflect.get(target, key)
      const value = Reflect.get(registry, key)
      if (typeof value !== 'function') return value
      return function (this: { ctx: Context }, ...args: unknown[]) {
        const context = this.ctx
        const caller = new Proxy(registry, { get: (target, key) => key === 'ctx' ? context : Reflect.get(target, key) })
        if (key === 'register') return self.lookup.run({ scope: registration.scope, registration }, async () => {
          const dispose = await value.apply(caller, args)
          return () => self.lookup.run({ scope: registration.scope, registration }, dispose)
        })
        return self.lookup.run({ scope: registration.scope }, () => value.apply(caller, args))
      }
    } })
  }
}
