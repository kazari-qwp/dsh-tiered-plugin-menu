import { Context, Service, type Fiber } from '@deepseek-ai/cordis'
import type { PromptSection, PromptContext } from '@deepseek-ai/dsh-system-prompt'
import type { ProjectionDefinition, ProjectionHandle, ProjectionKeySelection, ProjectionSnapshot } from '@deepseek-ai/dsh-session-projection'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { z } from 'zod'
import { catalogScope, scopeKey, type Scope } from './shared.ts'
import type { ToolDefinition, ToolRegistrationOptions } from '@deepseek-ai/dsh-tools'
import type { SkillCandidate, SkillProvider, SkillProviderControl, SkillRegistration, SkillViewOptions } from '@deepseek-ai/dsh-skill'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { McpResourceProvider } from '@deepseek-ai/dsh-mcp-resources'
import { createScope, type Scope as RegistrationScope } from '@deepseek-ai/dsh-scope'
import { resourceName } from './resource-names.ts'

interface Owner { scope: Scope; accepts(sessionId: string): boolean; applies?(scope: Scope): boolean; configKey(): string }
interface Contribution<T> { owner: Owner; value: T }
type Definition = ProjectionDefinition<any, any>
interface ProjectionState { sessionId: string; owner: string | null; config: string; value: any }
interface SkillGroup { entries: Contribution<SkillProvider>[]; dispose(): void; invalidate(): void }
type ToolEntry = Contribution<{ definition: ToolDefinition; options?: ToolRegistrationOptions }>
interface ToolMount { entry: ToolEntry; dispose(): void }

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
  private tools = new Map<string, { entries: ToolEntry[]; mounted: Map<Agent | undefined, ToolMount> }>()
  private toolScopes = new Map<Agent, RegistrationScope>()
  private resources = new Map<string, { entries: Contribution<McpResourceProvider>[]; mounted: Map<Agent, { entry: Contribution<McpResourceProvider>; dispose(): void }> }>()
  private resourceScopes = new Map<Agent, RegistrationScope>()
  private web = new Map<string, { entries: Contribution<any>[]; dispose(): void }>()
  private titles: Contribution<any>[] = []
  private removeTitle?: () => void
  private commands = new Map<string, { entries: Contribution<any>[]; mounted: Map<string, Fiber> }>()
  private projections = new Map<string, {
    entries: Contribution<Definition>[]; handle?: ProjectionHandle<ProjectionState>; pending: Promise<void>
  }>()
  private skills: Map<string, SkillGroup>

  constructor(private root: Context, private namespace?: string) {
    let skills = hostSkills.get(root)
    if (!skills) { skills = new Map(); hostSkills.set(root, skills) }
    this.skills = skills
  }

  name(name: string) { return this.namespace ? resourceName(this.namespace, name) : name }
  get routePrefix() { return this.namespace ? `/api/__tiered/${encodeURIComponent(this.namespace)}` : '' }
  private path(path: string) { return this.routePrefix + path }
  private request(request: Request): Request {
    if (!this.namespace) return request
    const url = new URL(request.url)
    url.pathname = url.pathname.slice(this.routePrefix.length)
    return new Request(url, request)
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
        const original = create({ signal: lifecycle.signal, invalidate: () => { if (!lifecycle.signal.aborted) group?.invalidate() } })
        const candidates = new WeakMap<SkillCandidate, SkillCandidate>()
        const provider: SkillProvider = !this.namespace ? original : { ...original, name: this.name(original.name),
          list: async options => {
            const result = await original.list(options)
            const observation = 'candidates' in result ? result : { candidates: result, complete: true }
            return { ...observation, candidates: observation.candidates.map(candidate => {
              const named = { ...candidate, name: this.name(candidate.name), provider: this.name(original.name) }
              candidates.set(named, candidate)
              return named
            }) }
          },
          get: async (candidate, options) => {
            const skill = await original.get(candidates.get(candidate)!, options)
            return skill && { ...skill, name: this.name(skill.name), provider: this.name(original.name) }
          },
        }
        group = this.skills.get(provider.name)
        if (!group) {
          const entries: Contribution<SkillProvider>[] = []
          const sources = new WeakMap<SkillCandidate, { entry: Contribution<SkillProvider>; candidate: SkillCandidate }>()
          let invalidate!: () => void
          const visible = (entry: Contribution<SkillProvider>, options: SkillViewOptions) => {
            const view = (options.scope as { [catalogScope]?: Scope } | undefined)?.[catalogScope]
            if (view) return entry.owner.applies?.(view) ?? scopeKey(entry.owner.scope) === scopeKey(view)
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
    const group = this.tools.get(definition.name) ?? { entries: [] as ToolEntry[], mounted: new Map<Agent | undefined, ToolMount>() }
    this.tools.set(definition.name, group)
    const broker = this
    return ctx.effect(function* () {
      const entry = { owner, value: { definition, options } }
      group.entries.push(entry)
      // Register cleanup first so a native registration failure releases this contribution too.
      yield () => {
        group.entries.splice(group.entries.indexOf(entry), 1)
        broker.refreshTools()
        if (!group.entries.length) broker.tools.delete(definition.name)
      }
      broker.refreshTools()
    })
  }

  refreshTools() {
    const agents = (this.root.get('agents') as Context['agents'] | undefined)?.list() ?? []
    for (const group of this.tools.values()) {
      const wanted = new Map<Agent | undefined, ToolEntry>()
      const client = this.pick(group.entries)
      if (client) wanted.set(undefined, client)
      for (const agent of agents) {
        const entry = this.pick(group.entries, agent.id)
        if (entry && entry.owner.scope.level !== 'client') wanted.set(agent, entry)
      }
      for (const [agent, mounted] of group.mounted) if (wanted.get(agent) !== mounted.entry) {
        group.mounted.delete(agent); mounted.dispose()
      }
      for (const [agent, entry] of wanted) {
        if (group.mounted.has(agent)) continue
        let target = this.root
        if (agent) {
          const scope = this.toolScopes.get(agent) ?? createScope(this.root, agent)
          this.toolScopes.set(agent, scope); target = scope.ctx
        }
        const { definition, options } = entry.value
        const publicDefinition = this.namespace ? { ...definition, name: this.name(definition.name) } : definition
        const dispose = (target.get('tools') as Context['tools']).register(agent ? publicDefinition : { ...publicDefinition,
          execute: (args, exec) => {
            if (exec.agent && !entry.owner.accepts(exec.agent.id)) throw new Error('此会话未启用该工具')
            return definition.execute(args, exec)
          },
        }, agent ? options : { when: async request => entry.owner.accepts(request.agent.id)
          && (await options?.when?.(request) ?? true) })
        group.mounted.set(agent, { entry, dispose })
      }
    }
    for (const [agent, scope] of this.toolScopes) if (![...this.tools.values()].some(group => group.mounted.has(agent))) {
      this.toolScopes.delete(agent); void scope.dispose()
    }
    this.refreshResources()
  }

  resource(ctx: Context, owner: Owner, server: string, provider: McpResourceProvider) {
    const group = this.resources.get(server) ?? { entries: [] as Contribution<McpResourceProvider>[], mounted: new Map<Agent, { entry: Contribution<McpResourceProvider>; dispose(): void }>() }
    this.resources.set(server, group)
    return ctx.effect(() => {
      const entry = { owner, value: provider }
      group.entries.push(entry)
      try { this.refreshResources() }
      catch (error) { group.entries.splice(group.entries.indexOf(entry), 1); this.refreshResources(); throw error }
      return () => {
        group.entries.splice(group.entries.indexOf(entry), 1)
        this.refreshResources()
        if (!group.entries.length) this.resources.delete(server)
      }
    })
  }

  private refreshResources() {
    const agents = (this.root.get('agents') as Context['agents'] | undefined)?.list() ?? []
    for (const [server, group] of this.resources) {
      const wanted = new Map(agents.map(agent => [agent, this.pick(group.entries, agent.id)] as const).filter(([, entry]) => entry))
      for (const [agent, mounted] of group.mounted) if (wanted.get(agent) !== mounted.entry) {
        group.mounted.delete(agent); mounted.dispose()
      }
      for (const [agent, entry] of wanted) {
        if (group.mounted.has(agent)) continue
        const scope = this.resourceScopes.get(agent) ?? createScope(this.root, agent)
        this.resourceScopes.set(agent, scope)
        const dispose = (scope.ctx.get('mcpResources') as Context['mcpResources']).register(this.name(server), entry!.value)
        group.mounted.set(agent, { entry: entry!, dispose })
      }
    }
    for (const [agent, scope] of this.resourceScopes) if (![...this.resources.values()].some(group => group.mounted.has(agent))) {
      this.resourceScopes.delete(agent); void scope.dispose()
    }
  }

  localTool(name: string, owner: Owner) {
    return this.namespace ? this.tools.get(name)?.entries.find(entry => entry.owner === owner)?.value.definition : undefined
  }

  releaseTools(sessionId: string) {
    for (const group of this.resources.values()) for (const [agent, mounted] of group.mounted) if (agent.id === sessionId) {
      group.mounted.delete(agent); mounted.dispose()
    }
    for (const [agent, scope] of this.resourceScopes) if (agent.id === sessionId) {
      this.resourceScopes.delete(agent); void scope.dispose()
    }
    for (const group of this.tools.values()) for (const [agent, mounted] of group.mounted) if (agent?.id === sessionId) {
      group.mounted.delete(agent); mounted.dispose()
    }
    for (const [agent, scope] of this.toolScopes) if (agent.id === sessionId) {
      this.toolScopes.delete(agent); void scope.dispose()
    }
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
        const route = { ...value, path: this.path(value.path),
          ...(value.resource ? { resource: (request: Request, peer: unknown) => pick(request)?.value.resource(this.request(request), peer) ?? new Response('Plugin disabled', { status: 404 }) }
            : { handler: (request: any, response: any, ...args: any[]) => {
              const selected = pick(request)
              if (selected) {
                if (this.namespace) request.url = request.url.slice(this.routePrefix.length)
                return selected.value.handler(request, response, ...args)
              }
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
          commands.register({ ...selected.value, name: this.name(selected.value.name), handler: (request: any) => {
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
        const dispose = (this.root.get('systemPrompt') as Context['systemPrompt'])[kind]({ ...value, name: this.name(value.name), text: context => {
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
        const dispose = (this.root.get('connection') as Context['connection']).fetch.register({ ...value, path: this.path(value.path), fetch: async request => {
          // 读副本，原请求仍交给插件解析。会话型接口按请求中的 sessionId 选择实例。
          const body = request.headers.get('content-type')?.includes('json')
            ? await request.clone().json().catch(() => null) : null
          const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined
          const scope = request.headers.get('x-dsh-tiered-scope')
          const selected = scope ? entries.find(entry => scopeKey(entry.owner.scope) === scope) : this.pick(entries, sessionId)
          if (!selected) return Response.json({ ok: false, error: { code: 'plugin-disabled', message: '此会话未启用插件' } }, { status: 404 })
          return selected.value.fetch(this.request(request))
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
        key: this.name(key),
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
    this.refreshTools()
    for (const group of this.skills.values()) group.invalidate()
    await Promise.all([...this.projections.keys()].map(key => this.refreshProjection(key)))
    await this.refreshCommands()
  }

  stateOf(session: Session, key: string) { return this.projections.get(key)?.handle?.stateOf(session).value }

  projectionKeys(keys?: Iterable<string>): ProjectionKeySelection | undefined {
    return keys && [...keys].map(key => this.projections.has(key) ? this.name(key) : key) as ProjectionKeySelection
  }

  projectionLocalKey(hostKey: string): string {
    for (const key of this.projections.keys()) if (this.name(key) === hostKey) return key
    return hostKey
  }

  projectionNames(): Record<string, string> {
    return Object.fromEntries([...this.projections.keys()].map(key => [key, this.name(key)]))
  }

  projectionValues(values: ProjectionSnapshot['values']): ProjectionSnapshot['values'] {
    const result: Record<string, unknown> = { ...values }
    for (const key of this.projections.keys()) {
      const hostKey = this.name(key)
      if (hostKey === key || !Object.hasOwn(result, hostKey)) continue
      result[key] = result[hostKey]
      delete result[hostKey]
    }
    return result
  }

  projectionSnapshot<T extends ProjectionSnapshot | undefined>(snapshot: T): T {
    return snapshot && { ...snapshot, values: this.projectionValues(snapshot.values) }
  }

  async mount(ctx: Context, owner: Owner): Promise<Fiber> {
    const broker = this
    // inject 使用未隔离的宿主来等待服务，提供者则放进实例的隔离空间。
    return ctx.plugin((child: Context) => {
      for (const [name, Factory] of [
        ['systemPrompt', PromptFacade], ['sessionProjections', ProjectionFacade], ['sessionProjectionCache', ProjectionCacheFacade], ['connection', ConnectionFacade],
        ['tools', ToolsFacade], ['webServer', WebFacade], ['sessionTitle', TitleFacade],
        ['commands', CommandsFacade], ['skills', SkillsFacade], ['mcpResources', McpResourcesFacade],
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
  get(name: string, scope?: any) { return this.broker.localTool(name, this.owner) ?? (this.root.get('tools') as Context['tools']).get(name, scope) }
  definitions(scope?: any) { return (this.root.get('tools') as Context['tools']).definitions(scope) }
  schemas(scope?: any) { return (this.root.get('tools') as Context['tools']).schemas(scope) }
}

class CommandsFacade extends Service {
  constructor(ctx: Context, private broker: ScopedServices, private owner: Owner, root: Context) { super(ctx, 'commands'); forwardService(this, root, 'commands') }
  register(value: any) { return this.broker.command(this.ctx, this.owner, value) }
}

class SkillsFacade extends Service {
  constructor(ctx: Context, private broker: ScopedServices, private owner: Owner, private root: Context) { super(ctx, 'skills'); forwardService(this, root, 'skills') }
  registerProvider(create: (control: SkillProviderControl) => SkillProvider) { return this.broker.skillProvider(this.ctx, this.owner, create) }
  register(value: SkillRegistration) { return this.broker.runtimeSkill(this.ctx, this.owner, value) }
  async get(name: string, options?: SkillViewOptions) {
    const skills = this.root.get('skills') as Context['skills']
    const local = this.broker.name(name)
    if (local === name) return skills.get(name, options)
    return await skills.get(local, options) ?? skills.get(name, options)
  }
}

class McpResourcesFacade extends Service {
  constructor(ctx: Context, private broker: ScopedServices, private owner: Owner, root: Context) { super(ctx, 'mcpResources'); forwardService(this, root, 'mcpResources') }
  register(server: string, provider: McpResourceProvider) { return this.broker.resource(this.ctx, this.owner, server, provider) }
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
  constructor(ctx: Context, private broker: ScopedServices, private owner: Owner, private root: Context) { super(ctx, 'sessionProjections'); forwardService(this, root, 'sessionProjections') }
  private get native() { return this.root.get('sessionProjections') as Context['sessionProjections'] }
  register(value: Definition) { return this.broker.projection(this.ctx, this.owner, value) }
  stateOf(session: Session, key: string) { return this.broker.stateOf(session, key) }
  snapshot(session: Session, keys?: ProjectionKeySelection) { return this.broker.projectionSnapshot(this.native.snapshot(session, this.broker.projectionKeys(keys))) }
  cachedSnapshot(session: Session, keys?: ProjectionKeySelection) { return this.broker.projectionSnapshot(this.native.cachedSnapshot(session, this.broker.projectionKeys(keys))) }
  summaryKeys() { return new Set([...this.native.summaryKeys()].map(key => this.broker.projectionLocalKey(key))) }
  viewCheckpoint(...[checkpoint, keys]: Parameters<Context['sessionProjections']['viewCheckpoint']>) {
    return this.broker.projectionValues(this.native.viewCheckpoint(checkpoint, this.broker.projectionKeys(keys)))
  }
  // Checkpoints remain opaque host records, so restoration and write-back retain every plugin's data.
  restore(...args: Parameters<Context['sessionProjections']['restore']>) {
    const result = this.native.restore(...args)
    return { ...result, snapshot: this.broker.projectionSnapshot(result.snapshot) }
  }
  hydrate(...args: Parameters<Context['sessionProjections']['hydrate']>) { return this.broker.projectionSnapshot(this.native.hydrate(...args)) }
}

class ProjectionCacheFacade extends Service {
  constructor(ctx: Context, private broker: ScopedServices, _owner: Owner, private root: Context) { super(ctx, 'sessionProjectionCache'); forwardService(this, root, 'sessionProjectionCache') }
  private get native() { return this.root.get('sessionProjectionCache') as any }
  cachedSnapshot(header: unknown, keys?: ProjectionKeySelection) { return this.broker.projectionSnapshot(this.native.cachedSnapshot(header, this.broker.projectionKeys(keys))) }
  coldSnapshot(...args: any[]) { return this.broker.projectionSnapshot(this.native.coldSnapshot(...args)) }
  hydratePrepared(...args: any[]) { return this.broker.projectionSnapshot(this.native.hydratePrepared(...args)) }
}

class ConnectionFacade extends Service {
  constructor(ctx: Context, private broker: ScopedServices, private owner: Owner, private root: Context) { super(ctx, 'connection') }
  get fetch() { return { register: (value: ConnectionFetchRoute) => this.broker.fetch(this.ctx, this.owner, value) } }
  get rpc() { return (this.root.get('connection') as Context['connection']).rpc }
}

export const scopedServiceNames = ['systemPrompt', 'sessionProjections', 'sessionProjectionCache', 'connection', 'tools', 'webServer', 'sessionTitle', 'commands', 'skills', 'mcpResources'] as const
