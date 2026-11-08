import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { scopeKey, type SavedConfig, type Scope } from './shared.ts'

export class ConfigStore {
  private data: Record<string, Record<string, SavedConfig>>

  constructor(readonly filename: string) {
    this.data = existsSync(filename) ? JSON.parse(readFileSync(filename, 'utf8')) : {}
  }

  get(scope: Scope, id: string): SavedConfig | undefined {
    return this.data[scopeKey(scope)]?.[id]
  }

  hasScoped(id: string): boolean {
    return Object.entries(this.data).some(([key, configs]) => key !== 'client:' && !!configs[id])
  }

  scopes(): Scope[] {
    return Object.keys(this.data).map(key => ({ level: key.slice(0, key.indexOf(':')) as Scope['level'], id: key.slice(key.indexOf(':') + 1) }))
  }

  migrate(packageName: string, componentIds: string[]): void {
    if (componentIds.includes(packageName)) return
    let changed = false
    for (const configs of Object.values(this.data)) {
      const previous = configs[packageName]
      if (!previous) continue
      for (const id of componentIds) configs[id] ??= previous
      delete configs[packageName]
      changed = true
    }
    if (changed) this.save()
  }

  set(scope: Scope, id: string, config: SavedConfig): void {
    const configs = this.data[scopeKey(scope)] ??= {}
    configs[id] = config
    this.save()
  }

  remove(scope: Scope, id: string): void {
    delete this.data[scopeKey(scope)]?.[id]
    this.save()
  }

  private save(): void {
    mkdirSync(dirname(this.filename), { recursive: true })
    writeFileSync(this.filename, JSON.stringify(this.data, null, 2) + '\n')
  }
}
