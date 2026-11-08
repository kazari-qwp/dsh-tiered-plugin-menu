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
