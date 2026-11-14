import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { ownScope, scopeKey, type ChildDefaults, type MenuSettings, type SavedConfig, type Scope } from './shared.ts'

interface StoredData {
  version: 2
  configs: Record<string, Record<string, SavedConfig>>
  children: Record<string, ChildDefaults>
  parents: Record<string, Scope>
  settings?: MenuSettings
  mcp?: Record<string, { name: string }>
}

export class ConfigStore {
  private data: StoredData

  constructor(readonly filename: string) {
    const saved = existsSync(filename) ? JSON.parse(readFileSync(filename, 'utf8')) : {}
    this.data = saved.version === 2 ? saved : { version: 2, configs: saved, children: {}, parents: {} }
  }

  get(scope: Scope, id: string): SavedConfig | undefined {
    if (!scope.children) return this.data.configs[scopeKey(scope)]?.[id]
    const defaults = this.children(scope)
    return defaults.independent ? defaults.plugins[id] : undefined
  }

  mcp() { return this.data.mcp ?? {} }
  addMcp(id: string, name: string): void {
    ;(this.data.mcp ??= {})[id] = { name }
    this.save()
  }
  removeMcp(id: string): void { delete this.data.mcp?.[id]; this.save() }
  keys(scope: Scope): string[] {
    return Object.keys(scope.children ? this.children(scope).plugins : this.data.configs[scopeKey(scope)] ?? {})
  }

  settings(): MenuSettings { return { inheritWorkspaceTree: true, pluginIsolation: false, ...this.data.settings } }

  setWorkspaceTreeInheritance(enabled: boolean): void {
    this.data.settings = { ...this.settings(), inheritWorkspaceTree: enabled }
    this.save()
  }

  setPluginIsolation(enabled: boolean): void {
    this.data.settings = { ...this.settings(), pluginIsolation: enabled }
    this.save()
  }

  hasScoped(id: string): boolean {
    return Object.entries(this.data.configs).some(([key, configs]) => key !== 'client:' && !!configs[id])
  }

  scopes(): Scope[] {
    return Object.keys(this.data.configs).map(key => ({ level: key.slice(0, key.indexOf(':')) as Scope['level'], id: key.slice(key.indexOf(':') + 1) }))
  }

  workspaceScopes(): Scope[] {
    const keys = new Set([...Object.keys(this.data.configs), ...Object.keys(this.data.children), ...Object.keys(this.data.parents),
      ...Object.values(this.data.parents).map(scopeKey)])
    return [...keys].filter(key => key.startsWith('workspace:')).map(key => ({ level: 'workspace', id: key.slice('workspace:'.length) }))
  }

  removeScope(scope: Scope, replacement: Scope): void {
    const key = scopeKey(ownScope(scope))
    delete this.data.configs[key]
    delete this.data.children[key]
    delete this.data.parents[key]
    // Keep each child's own settings; only replace its link to the deleted workspace.
    for (const [child, parent] of Object.entries(this.data.parents)) {
      if (scopeKey(parent) === key) this.data.parents[child] = replacement
    }
    this.save()
  }

  children(scope: Scope): ChildDefaults {
    return this.data.children[scopeKey(ownScope(scope))] ?? { independent: false, plugins: {} }
  }

  setChildren(scope: Scope, independent: boolean): void {
    this.data.children[scopeKey(ownScope(scope))] = { ...this.children(scope), independent }
    this.save()
  }

  resetChildren(scope: Scope): void {
    delete this.data.children[scopeKey(ownScope(scope))]
    this.save()
  }

  parent(scope: Scope): Scope | undefined { return this.data.parents[scopeKey(ownScope(scope))] }

  remember(scope: Scope, parent: Scope): void {
    const previous = this.parent(scope)
    if (previous && scopeKey(previous) === scopeKey(parent)) return
    this.data.parents[scopeKey(scope)] = parent
    this.save()
  }

  initialize(scope: Scope, parent: Scope, defaults: Record<string, SavedConfig>): void {
    if (this.parent(scope)) return
    this.data.configs[scopeKey(scope)] = { ...structuredClone(defaults), ...this.data.configs[scopeKey(scope)] }
    this.data.parents[scopeKey(scope)] = parent
    this.save()
  }

  migrate(packageName: string, componentIds: string[]): void {
    if (componentIds.includes(packageName)) return
    let changed = false
    for (const configs of [...Object.values(this.data.configs), ...Object.values(this.data.children).map(value => value.plugins)]) {
      const previous = configs[packageName]
      if (!previous) continue
      for (const id of componentIds) configs[id] ??= previous
      delete configs[packageName]
      changed = true
    }
    if (changed) this.save()
  }

  set(scope: Scope, id: string, config: SavedConfig): void {
    if (scope.children && !this.children(scope).independent) {
      this.data.children[scopeKey(ownScope(scope))] = { independent: true, plugins: {} }
    }
    const configs = scope.children
      ? (this.data.children[scopeKey(ownScope(scope))] ??= { independent: true, plugins: {} }).plugins
      : this.data.configs[scopeKey(scope)] ??= {}
    configs[id] = config
    this.save()
  }

  remove(scope: Scope, id: string): void {
    if (scope.children) delete this.children(scope).plugins[id]
    else delete this.data.configs[scopeKey(scope)]?.[id]
    this.save()
  }

  private save(): void {
    mkdirSync(dirname(this.filename), { recursive: true })
    writeFileSync(this.filename, JSON.stringify(this.data, null, 2) + '\n')
  }
}
