import { Context, Service, type Fiber } from '@deepseek-ai/cordis'
import type { PromptSection, PromptContext } from '@deepseek-ai/dsh-system-prompt'
import type { ProjectionDefinition, ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { z } from 'zod'
import { scopeKey, type Scope } from './shared.ts'
import type { ToolDefinition, ToolRegistrationOptions } from '@deepseek-ai/dsh-tools'
import type { SkillCandidate, SkillProvider, SkillProviderControl, SkillRegistration, SkillViewOptions } from '@deepseek-ai/dsh-skill'

interface Owner { scope: Scope; accepts(sessionId: string): boolean; configKey(): string }
interface Contribution<T> { owner: Owner; value: T }
type Definition = ProjectionDefinition<any, any>
interface ProjectionState { sessionId: string; owner: string | null; config: string; value: any }
interface SkillGroup { entries: Contribution<SkillProvider>[]; dispose(): void; invalidate(): void }

// Different plugin brokers share the host registration, while retaining each provider's owner.
const hostSkills = new WeakMap<Context, Map<string, SkillGroup>>()

/** Unchanged operations keep the native implementation; only registrations are routed. */
function forwardService(facade: object, root: Context, name: string) {
  const native = root.get(name) as any
  for (let object = native; object && object !== Object.prototype; object = Object.getPrototypeOf(object)) {
    for (const key of Object.getOwnPropertyNames(object)) {
      if (key in facade) continue
      Object.defineProperty(facade, key, { configurable: true, get() {
        const value = native[key]
        return typeof value === 'function' ? value.bind(native) : value
      } })
    }
  }
}

/** 同名注册只进入宿主一次；各实例仍拥有自己的回调、配置和释放函数。 */
export class ScopedServices {
  private prompts = new Map<string, { entries: Contribution<PromptSection | PromptContext>[]; dispose(): void }>()
  private routes = new Map<string, { entries: Contribution<ConnectionFetchRoute>[]; dispose(): void }>()
  private tools = new Map<string, { entries: Contribution<{ definition: ToolDefinition; options?: ToolRegistrationOptions }>[]; dispose(): void }>()
  private web = new Map<string, { entries: Contribution<any>[]; dispose(): void }>()
  private titles: Contribution<any>[] = []
  private removeTitle?: () => void
  private commands = new Map<string, { entries: Contribution<any>[]; mounted: Map<string, Fiber> }>()
  private projections = new Map<string, {
    entries: Contribution<Definition>[]; handle?: ProjectionHandle<ProjectionState>; pending: Promise<void>
  }>()
  private skills: Map<string, SkillGroup>

  constructor(private root: Context) {
    let skills = hostSkills.get(root)
    if (!skills) { skills = new Map(); hostSkills.set(root, skills) }
    this.skills = skills
  }

  private pick<T>(entries: Contribution<T>[], sessionId?: string) {
    return entries.find(entry => sessionId ? entry.owner.accepts(sessionId) : entry.owner.scope.level === 'client')
  }

  paths() { return [...this.routes.keys(), ...[...this.web.values()].map(group => group.entries[0]!.value.path)] }

  skillProvider(ctx: Context, owner: Owner, create: (control: SkillProviderControl) => SkillProvider) {
    return ctx.effect(() => {
      const lifecycle = new AbortController()
      let group: ReturnType<typeof this.skills.get>
      try {
        const provider = create({ signal: lifecycle.signal, invalidate: () => { if (!lifecycle.signal.aborted) group?.invalidate() } })
        group = this.skills.get(provider.name)
        if (!group) {
          const entries: Contribution<SkillProvider>[] = []
          const sources = new WeakMap<SkillCandidate, { entry: Contribution<SkillProvider>; candidate: SkillCandidate }>()
          let invalidate!: () => void
          const visible = (entry: Contribution<SkillProvider>, options: SkillViewOptions) => {
            const id = (options.scope as { id?: string })?.id
            return id ? entry.owner.accepts(id) : entry.owner.scope.level === 'client'
          }
          const dispose = (this.root.get('skills') as Context['skills']).registerProvider(control => {
            invalidate = control.invalidate
            return { name: provider.name,
              list: async options => {
                const parts = await Promise.all(entries.filter(entry => visible(entry, options)).map(async entry => {
                  try {
                    const result = await entry.value.list(options)
                    const observation = 'candidates' in result ? result : { candidates: result, complete: true }
                    return { ...observation, candidates: observation.candidates.map(candidate => {
                      const routed = { ...candidate }
                      sources.set(routed, { entry, candidate })
                      return routed
                    }) }
                  } catch (error) {
                    if (options.signal?.aborted) throw error
                    this.root.logger.warn(`skill provider "${provider.name}" skipped: ${String(error)}`)
                    return { candidates: [], complete: false }
                  }
                }))
                return { candidates: parts.flatMap(part => part.candidates), complete: parts.every(part => part.complete) }
              },
              get: async (candidate, options) => {
                const source = sources.get(candidate)
                if (!source || !entries.includes(source.entry) || !visible(source.entry, options)) return undefined
                return source.entry.value.get(source.candidate, options)
              },
            }
          })
          group = { entries, dispose, invalidate }; this.skills.set(provider.name, group)
        }
        const entry = { owner, value: provider }; group.entries.push(entry)
        group.invalidate()
        return () => {
          group!.entries.splice(group!.entries.indexOf(entry), 1)
          lifecycle.abort(new Error(`skill provider "${provider.name}" disposed`))
          group!.invalidate()
          if (!group!.entries.length) { group!.dispose(); this.skills.delete(provider.name) }
        }
      } catch (error) { lifecycle.abort(error); throw error }
    })
  }

  runtimeSkill(ctx: Context, owner: Owner, value: SkillRegistration) {
    const skill = { ...value, invocation: value.invocation ?? { modelInvocable: true, userInvocable: true }, provider: value.provider ?? 'runtime' }
    // Route a static registration through the same catalog, retaining DSH's runtime rank and loaded metadata.
    const provider = `runtime:${value.name}`
    return this.skillProvider(ctx, owner, () => ({ name: provider,
      list: async () => [{ ...skill, provider, rank: 250, locator: skill }],
      get: async () => skill,
    }))
  }

  tool(ctx: Context, owner: Owner, definition: ToolDefinition, options?: ToolRegistrationOptions) {
    return ctx.effect(() => {
      let group = this.tools.get(definition.name)
      if (!group) {
        const entries: Contribution<{ definition: ToolDefinition; options?: ToolRegistrationOptions }>[] = []
        const dispose = (this.root.get('tools') as Context['tools']).register({ ...definition,
          execute: (args, exec) => {
            const selected = this.pick(entries, exec.agent?.id)
            if (!selected) throw new Error('此会话未启用该工具')
            return selected.value.definition.execute(args, exec)
          },
        }, { when: async request => {
          const selected = this.pick(entries, request.agent.id)
          return !!selected && (await selected.value.options?.when?.(request) ?? true)
        } })
        group = { entries, dispose }; this.tools.set(definition.name, group)
      }
      const entry = { owner, value: { definition, options } }; group.entries.push(entry)
      return () => {
        group.entries.splice(group.entries.indexOf(entry), 1)
        if (!group.entries.length) { group.dispose(); this.tools.delete(definition.name) }
      }
    })
  }

  webRoute(ctx: Context, owner: Owner, method: 'register' | 'registerUpgrade', value: any) {
    return ctx.effect(() => {
      const key = `${method}/${value.kind}/${value.path}`
      let group = this.web.get(key)
      if (!group) {
        const entries: Contribution<any>[] = []
        const pick = (request: any) => {
          const scope = request.headers instanceof Headers ? request.headers.get('x-dsh-tiered-scope') : request.headers['x-dsh-tiered-scope']
          return scope ? entries.find(entry => scopeKey(entry.owner.scope) === scope) : this.pick(entries)
        }
        const route = { ...value,
          ...(value.resource ? { resource: (request: Request, peer: unknown) => pick(request)?.value.resource(request, peer) ?? new Response('Plugin disabled', { status: 404 }) }
            : { handler: (request: any, response: any, ...args: any[]) => {
              const selected = pick(request)
              if (selected) return selected.value.handler(request, response, ...args)
              if ('writeHead' in response) response.writeHead(404)
              response.end()
            } }),
        }
        const dispose = (this.root.get('webServer') as any)[method](route)
        group = { entries, dispose }; this.web.set(key, group)
      }
      const entry = { owner, value }; group.entries.push(entry)
      return () => {
        group.entries.splice(group.entries.indexOf(entry), 1)
        if (!group.entries.length) { group.dispose(); this.web.delete(key) }
      }
    })
  }

  title(ctx: Context, owner: Owner, value: any) {
    return ctx.effect(() => {
      const entry = { owner, value }; this.titles.push(entry)
      this.removeTitle ??= (this.root.get('sessionTitle') as any).register({ ...value,
        generate: (request: any) => {
          const selected = this.pick(this.titles, request.session.id)
          if (!selected) throw new Error('此会话未启用标题插件')
          return selected.value.generate(request)
        },
      })
      return () => {
        this.titles.splice(this.titles.indexOf(entry), 1)
        if (!this.titles.length) { this.removeTitle!(); this.removeTitle = undefined }
      }
    })
  }

  command(ctx: Context, owner: Owner, value: any) {
    return ctx.effect(() => {
      const group = this.commands.get(value.name) ?? { entries: [] as Contribution<any>[], mounted: new Map<string, Fiber>() }
      this.commands.set(value.name, group)
      const entry = { owner, value }; group.entries.push(entry)
      const ready = this.refreshCommands()
      return async () => {
        await ready
        group.entries.splice(group.entries.indexOf(entry), 1)
        await this.refreshCommands()
        if (!group.entries.length) this.commands.delete(value.name)
      }
    })
  }

  async refreshCommands() {
    for (const [name, group] of this.commands) {
      const agents = (this.root.get('agents') as Context['agents']).list()
      for (const [id, fiber] of group.mounted) if (!agents.some(agent => agent.id === id) || !this.pick(group.entries, id)) {
        group.mounted.delete(id); await fiber.dispose()
      }
      for (const agent of agents) {
        const selected = this.pick(group.entries, agent.id)
        if (!selected || group.mounted.has(agent.id)) continue
        const fiber = agent.ctx.inject(['commands'], child => {
          const commands = child.get('commands') as any
          commands.register({ ...selected.value, handler: (request: any) => {
            const current = this.pick(group.entries, request.agent.id)
            return current ? current.value.handler(request) : { kind: 'error', message: '此会话未启用该命令' }
          } })
        })
        group.mounted.set(agent.id, fiber)
        await fiber
      }
    }
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
          const scope = request.headers.get('x-dsh-tiered-scope')
          const selected = scope ? entries.find(entry => scopeKey(entry.owner.scope) === scope) : this.pick(entries, sessionId)
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
          .transform(state => {
            const entry = this.pick(group.entries, state.sessionId)
            if (state.owner !== (entry ? scopeKey(entry.owner.scope) : null)
              || state.config !== (entry?.owner.configKey() ?? '')) {
              throw new Error('作用域或配置已变化，请从会话日志重新计算')
            }
            return { ...state, value: entry ? entry.value.stateSchema.parse(state.value) : state.value }
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
          ...example.wire, viewSchema: z.unknown().transform(value => value === null ? null : example.wire!.viewSchema.parse(value)),
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
    for (const group of this.skills.values()) group.invalidate()
    await Promise.all([...this.projections.keys()].map(key => this.refreshProjection(key)))
    await this.refreshCommands()
  }

  stateOf(session: Session, key: string) { return this.projections.get(key)?.handle?.stateOf(session).value }

  async mount(ctx: Context, owner: Owner): Promise<Fiber> {
    const broker = this
    // inject 使用未隔离的宿主来等待服务，提供者则放进实例的隔离空间。
    return ctx.plugin((child: Context) => {
      for (const [name, Factory] of [
        ['systemPrompt', PromptFacade], ['sessionProjections', ProjectionFacade], ['connection', ConnectionFacade],
        ['tools', ToolsFacade], ['webServer', WebFacade], ['sessionTitle', TitleFacade],
        ['commands', CommandsFacade], ['skills', SkillsFacade],
      ] as const) {
        child.effect(() => broker.root.inject([name], async () => {
          const fiber = await child.plugin((serviceCtx: Context) => { new Factory(serviceCtx, broker, owner, broker.root) })
          return fiber.dispose
        }).dispose)
      }
    })
  }
}

class ToolsFacade extends Service {
  constructor(ctx: Context, private broker: ScopedServices, private owner: Owner, private root: Context) { super(ctx, 'tools'); forwardService(this, root, 'tools') }
  register(value: ToolDefinition, options?: ToolRegistrationOptions) { return this.broker.tool(this.ctx, this.owner, value, options) }
  get(name: string, scope?: any) { return (this.root.get('tools') as Context['tools']).get(name, scope) }
  definitions(scope?: any) { return (this.root.get('tools') as Context['tools']).definitions(scope) }
  schemas(scope?: any) { return (this.root.get('tools') as Context['tools']).schemas(scope) }
}

class CommandsFacade extends Service {
  constructor(ctx: Context, private broker: ScopedServices, private owner: Owner, root: Context) { super(ctx, 'commands'); forwardService(this, root, 'commands') }
  register(value: any) { return this.broker.command(this.ctx, this.owner, value) }
}

class SkillsFacade extends Service {
  constructor(ctx: Context, private broker: ScopedServices, private owner: Owner, root: Context) { super(ctx, 'skills'); forwardService(this, root, 'skills') }
  registerProvider(create: (control: SkillProviderControl) => SkillProvider) { return this.broker.skillProvider(this.ctx, this.owner, create) }
  register(value: SkillRegistration) { return this.broker.runtimeSkill(this.ctx, this.owner, value) }
}

class WebFacade extends Service {
  constructor(ctx: Context, private broker: ScopedServices, private owner: Owner, private root: Context) { super(ctx, 'webServer'); forwardService(this, root, 'webServer') }
  register(value: any) { return this.broker.webRoute(this.ctx, this.owner, 'register', value) }
  registerUpgrade(value: any) { return this.broker.webRoute(this.ctx, this.owner, 'registerUpgrade', value) }
  get server() { return (this.root.get('webServer') as any).server }
}

class TitleFacade extends Service {
  constructor(ctx: Context, private broker: ScopedServices, private owner: Owner, private root: Context) { super(ctx, 'sessionTitle'); forwardService(this, root, 'sessionTitle') }
  register(value: any) { return this.broker.title(this.ctx, this.owner, value) }
  read(...args: any[]) { return (this.root.get('sessionTitle') as any).read(...args) }
  rename(...args: any[]) { return (this.root.get('sessionTitle') as any).rename(...args) }
  generate(...args: any[]) { return (this.root.get('sessionTitle') as any).generate(...args) }
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

export const scopedServiceNames = ['systemPrompt', 'sessionProjections', 'connection', 'tools', 'webServer', 'sessionTitle', 'commands', 'skills'] as const
