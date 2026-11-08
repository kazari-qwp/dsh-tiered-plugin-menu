import { Context, Service, type Fiber } from '@deepseek-ai/cordis'
import type { PromptSection, PromptContext } from '@deepseek-ai/dsh-system-prompt'
import type { ProjectionDefinition, ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { z } from 'zod'
import { scopeKey, type Scope } from './shared.ts'

interface Owner { scope: Scope; accepts(sessionId: string): boolean; configKey(): string }
interface Contribution<T> { owner: Owner; value: T }
type Definition = ProjectionDefinition<any, any>
interface ProjectionState { sessionId: string; owner: string | null; config: string; value: any }

/** 同名注册只进入宿主一次；各实例仍拥有自己的回调、配置和释放函数。 */
export class ScopedServices {
  private prompts = new Map<string, { entries: Contribution<PromptSection | PromptContext>[]; dispose(): void }>()
  private routes = new Map<string, { entries: Contribution<ConnectionFetchRoute>[]; dispose(): void }>()
  private projections = new Map<string, {
    entries: Contribution<Definition>[]; handle?: ProjectionHandle<ProjectionState>; pending: Promise<void>
  }>()

  constructor(private root: Context) {}

  private pick<T>(entries: Contribution<T>[], sessionId?: string) {
    return entries.find(entry => sessionId ? entry.owner.accepts(sessionId) : entry.owner.scope.level === 'client')
  }

  prompt(ctx: Context, owner: Owner, kind: 'section' | 'context', value: PromptSection | PromptContext) {
    return ctx.effect(() => {
      const key = `${kind}/${value.name}`
      let group = this.prompts.get(key)
      if (!group) {
        const entries: Contribution<PromptSection | PromptContext>[] = []
        const dispose = (this.root.get('systemPrompt') as Context['systemPrompt'])[kind]({ ...value, text: context => {
          const selected = this.pick(entries, (context.scope as { id?: string })?.id)?.value
          return selected ? typeof selected.text === 'function' ? selected.text(context) : selected.text : ''
        } } as PromptSection)
        group = { entries, dispose }
        this.prompts.set(key, group)
      }
      const entry = { owner, value }
      group.entries.push(entry)
      return () => {
        group.entries.splice(group.entries.indexOf(entry), 1)
        if (!group.entries.length) { group.dispose(); this.prompts.delete(key) }
      }
    })
  }

  fetch(ctx: Context, owner: Owner, value: ConnectionFetchRoute) {
    return ctx.effect(() => {
      let group = this.routes.get(value.path)
      if (!group) {
        const entries: Contribution<ConnectionFetchRoute>[] = []
        const dispose = (this.root.get('connection') as Context['connection']).fetch.register({ ...value, fetch: async request => {
          // 读副本，原请求仍交给插件解析。会话型接口按请求中的 sessionId 选择实例。
          const body = request.headers.get('content-type')?.includes('json')
            ? await request.clone().json().catch(() => null) : null
          const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined
          const selected = this.pick(entries, sessionId)
            ?? (!sessionId ? entries[0] : undefined)
          if (!selected) return Response.json({ ok: false, error: { code: 'plugin-disabled', message: '此会话未启用插件' } }, { status: 404 })
          return selected.value.fetch(request)
        } })
        group = { entries, dispose }
        this.routes.set(value.path, group)
      }
      const entry = { owner, value }
      group.entries.push(entry)
      return () => {
        group.entries.splice(group.entries.indexOf(entry), 1)
        if (!group.entries.length) { group.dispose(); this.routes.delete(value.path) }
      }
    })
  }

  projection(ctx: Context, owner: Owner, value: Definition) {
    let group = this.projections.get(value.key)
    if (!group) {
      group = { entries: [], pending: Promise.resolve() }
      this.projections.set(value.key, group)
    }
    const entry = { owner, value }
    group.entries.push(entry)
    const ready = this.refreshProjection(value.key)
    const dispose = ctx.effect(() => async () => {
      group.entries.splice(group.entries.indexOf(entry), 1)
      await this.refreshProjection(value.key)
    })
    const stateOf = (session: Session) => {
      const state = group.handle?.stateOf(session)
      return state?.owner === scopeKey(owner.scope) ? state.value : undefined
    }
    const handle = { dispose: async () => { await dispose() }, stateOf, readerFor: (session: Session) => () => stateOf(session) }
    // DSH 同时支持旧式 disposer 和 await 后取得的 reader handle。
    const promise = ready.then(() => handle)
    return Object.assign(dispose, { then: promise.then.bind(promise) })
  }

  private refreshProjection(key: string): Promise<void> {
    const group = this.projections.get(key)!
    const refresh = async () => {
      await group.handle?.dispose()
      group.handle = undefined
      if (!group.entries.length) return
      const example = group.entries[0]!.value
      group.handle = await (this.root.get('sessionProjections') as Context['sessionProjections']).register({
        key,
        // 保持重启后的缓存版本稳定；归属或配置变化的缓存才需要重算。
        stateVersion: 1_000_000 + example.stateVersion,
        stateSchema: z.object({ sessionId: z.string(), owner: z.string().nullable(), config: z.string(), value: z.unknown() })
          .superRefine((state, validation) => {
            const entry = this.pick(group.entries, state.sessionId)
            if (state.owner !== (entry ? scopeKey(entry.owner.scope) : null)
              || state.config !== (entry?.owner.configKey() ?? '')
              || (entry && !entry.value.stateSchema.safeParse(state.value).success)) {
              validation.addIssue({ code: 'custom', message: '作用域或配置已变化，请从会话日志重新计算' })
            }
          }),
        init: (header, inherited) => {
          const entry = this.pick(group.entries, String(header.id))
          return { sessionId: String(header.id), owner: entry ? scopeKey(entry.owner.scope) : null,
            config: entry?.owner.configKey() ?? '',
            value: entry?.value.init(header, inherited) ?? null }
        },
        apply: (state: ProjectionState, event) => {
          const entry = this.pick(group.entries, state.sessionId)
          if (!entry || state.owner !== scopeKey(entry.owner.scope)) return state
          const value = entry.value.apply(state.value, event)
          return value === state.value ? state : { ...state, value }
        },
        wire: example.wire && {
          ...example.wire, viewSchema: example.wire.viewSchema.nullable(),
          view: (state: ProjectionState) => {
            const entry = this.pick(group.entries, state.sessionId)
            return entry && state.owner === scopeKey(entry.owner.scope) ? entry.value.wire!.view(state.value) : null
          },
        },
      } as Definition)
    }
    group.pending = group.pending.then(refresh, refresh)
    return group.pending
  }

  async refresh(): Promise<void> {
    await Promise.all([...this.projections.keys()].map(key => this.refreshProjection(key)))
  }

  stateOf(session: Session, key: string) { return this.projections.get(key)?.handle?.stateOf(session).value }

  async mount(ctx: Context, owner: Owner): Promise<Fiber> {
    const broker = this
    // inject 使用未隔离的宿主来等待服务，提供者则放进实例的隔离空间。
    return ctx.plugin((child: Context) => {
      for (const [name, Factory] of [
        ['systemPrompt', PromptFacade], ['sessionProjections', ProjectionFacade], ['connection', ConnectionFacade],
      ] as const) {
        child.effect(() => broker.root.inject([name], async () => {
          const fiber = await child.plugin((serviceCtx: Context) => { new Factory(serviceCtx, broker, owner, broker.root) })
          return fiber.dispose
        }).dispose)
      }
    })
  }
}

class PromptFacade extends Service {
  constructor(ctx: Context, private broker: ScopedServices, private owner: Owner, private root: Context) { super(ctx, 'systemPrompt') }
  section(value: PromptSection) { return this.broker.prompt(this.ctx, this.owner, 'section', value) }
  context(value: PromptContext) { return this.broker.prompt(this.ctx, this.owner, 'context', value) }
  getSectionOrder(name: any) { return (this.root.get('systemPrompt') as Context['systemPrompt']).getSectionOrder(name) }
  getContextOrder(name: any) { return (this.root.get('systemPrompt') as Context['systemPrompt']).getContextOrder(name) }
}

class ProjectionFacade extends Service {
  constructor(ctx: Context, private broker: ScopedServices, private owner: Owner, private root: Context) { super(ctx, 'sessionProjections') }
  register(value: Definition) { return this.broker.projection(this.ctx, this.owner, value) }
  stateOf(session: Session, key: string) { return this.broker.stateOf(session, key) }
  snapshot(session: Session, keys?: any) { return (this.root.get('sessionProjections') as Context['sessionProjections']).snapshot(session, keys) }
}

class ConnectionFacade extends Service {
  constructor(ctx: Context, private broker: ScopedServices, private owner: Owner, private root: Context) { super(ctx, 'connection') }
  get fetch() { return { register: (value: ConnectionFetchRoute) => this.broker.fetch(this.ctx, this.owner, value) } }
  get rpc() { return (this.root.get('connection') as Context['connection']).rpc }
}

export const scopedServiceNames = ['systemPrompt', 'sessionProjections', 'connection'] as const
