import type { Context } from '@deepseek-ai/cordis'
import type { SkillDefinition, SkillSummary, SkillViewOptions } from '@deepseek-ai/dsh-skill'
import type { ConfigStore } from './store.ts'
import { clientScope, isClientScope, type PluginConfig, type Scope, type SkillRow } from './shared.ts'

const key = (name: string) => `skill:${name}`

/** Apply policies at the registry's read boundary, preserving providers, paths and resources. */
export class SkillPolicies {
  private native?: Pick<Context['skills'], 'snapshot' | 'get'>

  constructor(private ctx: Context, private store: ConfigStore, private chain: (scope: Scope) => Scope[],
    private lookup: <T>(scope: Scope, read: (options: SkillViewOptions) => Promise<T>) => Promise<T>, private view: (options: SkillViewOptions) => Scope) {}

  private policy(scope: Scope, name: string) {
    const source = this.chain(scope).find(candidate => this.store.get(candidate, key(name))) ?? clientScope
    return { source, saved: this.store.get(source, key(name)) }
  }

  private apply<T extends SkillSummary>(skill: T, config: PluginConfig): T {
    return { ...skill,
      ...(typeof config.description === 'string' ? { description: config.description } : {}),
      ...('content' in skill && typeof config.content === 'string' ? { content: config.content } : {}),
      invocation: { ...skill.invocation,
        ...(typeof config.modelInvocable === 'boolean' ? { modelInvocable: config.modelInvocable } : {}),
        ...(typeof config.userInvocable === 'boolean' ? { userInvocable: config.userInvocable } : {}),
      },
    }
  }

  start(): void {
    this.ctx.effect(() => this.ctx.inject(['skills'], ctx => {
      const registry = ctx.skills
      const snapshot = registry.snapshot, get = registry.get
      const native = { snapshot: snapshot.bind(registry), get: get.bind(registry) }
      this.native = native
      registry.snapshot = async (options = {}) => {
        const result = await native.snapshot(options)
        const scope = this.view(options)
        return { ...result, skills: result.skills.flatMap(skill => {
          const { saved } = this.policy(scope, skill.name)
          return saved?.enabled === false ? [] : [this.apply(skill, saved?.config ?? {})]
        }) }
      }
      registry.get = async (name, options = {}) => {
        const { saved } = this.policy(this.view(options), name)
        if (saved?.enabled === false) return undefined
        const skill = await native.get(name, options)
        return skill && this.apply(skill, saved?.config ?? {})
      }
      return () => { registry.snapshot = snapshot; registry.get = get; this.native = undefined }
    }).dispose)
  }

  async rows(scope: Scope): Promise<SkillRow[]> {
    const found = this.native ? await this.lookup(scope, async options => (await this.native!.snapshot(options)).skills) : []
    const names = new Set([...found.map(skill => skill.name), ...this.chain(scope).flatMap(candidate =>
      this.store.keys(candidate).filter(id => id.startsWith('skill:')).map(id => id.slice(6)))])
    return [...names].sort().map(name => {
      const skill = found.find(skill => skill.name === name)
      const { source, saved } = this.policy(scope, name)
      return { id: name, name, source, enabled: saved?.enabled ?? true, config: saved?.config ?? {},
        own: isClientScope(scope) || !!this.store.get(scope, key(name)), available: !!skill,
        description: String(saved?.config.description ?? skill?.description ?? '此作用域中暂不可用'),
      }
    })
  }

  async config(scope: Scope, name: string): Promise<PluginConfig> {
    const original = this.native && await this.lookup(scope, options => this.native!.get(name, options))
    if (!original) throw new Error(`此作用域中找不到技能：${name}`)
    const skill = this.apply<SkillDefinition>(original, this.policy(scope, name).saved?.config ?? {})
    return { description: skill.description, content: skill.content, ...skill.invocation }
  }

  configure(scope: Scope, name: string, enabled: boolean, config: PluginConfig): void {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error('无效的技能名称')
    for (const field of ['description', 'content']) if (config[field] !== undefined && typeof config[field] !== 'string') throw new Error(`${field} 应为文本`)
    for (const field of ['modelInvocable', 'userInvocable']) if (config[field] !== undefined && typeof config[field] !== 'boolean') throw new Error(`${field} 应为布尔值`)
    if (scope.children && !this.store.children(scope).independent) throw new Error('请先切换为独立下级设置')
    this.store.set(scope, key(name), { enabled, config })
    this.ctx.emit('skills/change')
  }

  inherit(scope: Scope, name: string): void {
    if (isClientScope(scope)) throw new Error('客户端没有上级配置')
    this.store.remove(scope, key(name))
    this.ctx.emit('skills/change')
  }
}
