import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PluginConfig } from 'dsh-tiered-plugin-core/shared'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'

type FieldValue = Extract<SettingsPathOpView, { op: 'set' }>['value']

// 让原插件的 ConfigForm 接口读写当前会话的配置表。
export function sessionForm(initial: PluginConfig, save: (value: PluginConfig) => Promise<void>): ConfigForm<PluginConfig> & { replace(value: PluginConfig): void } {
  let snapshot: ConfigFormSnapshot<PluginConfig> = {
    status: 'ready', writable: true, revision: 0, value: initial, base: initial, user: initial,
  }
  const listeners = new Set<() => void>()
  const form: ConfigForm<PluginConfig> & { replace(value: PluginConfig): void } = {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    replace(value) {
      if (JSON.stringify(value) === JSON.stringify(snapshot.value)) return
      snapshot = { ...snapshot, value, user: value, revision: snapshot.revision! + 1 }
      for (const listener of listeners) listener()
    },
    async mutate(ops) {
      let value = structuredClone(snapshot.value!)
      for (const op of ops) {
        if (!op.path.length) { value = op.op === 'set' ? op.value as PluginConfig : {}; continue }
        let parent: any = value
        for (let index = 0; index < op.path.length - 1; index++) {
          const field = op.path[index]!
          if (!Object.hasOwn(parent, field)) Object.defineProperty(parent, field, {
            value: /^\d+$/.test(op.path[index + 1]!) ? [] : {}, writable: true, enumerable: true, configurable: true,
          })
          parent = parent[field]
        }
        const field = op.path.at(-1)!
        if (op.op === 'set') Object.defineProperty(parent, field, { value: op.value, writable: true, enumerable: true, configurable: true })
        else if (Array.isArray(parent)) parent.splice(Number(field), 1)
        else delete parent[field]
      }
      await save(value)
      snapshot = { ...snapshot, value, user: value, revision: snapshot.revision! + 1 }
      for (const listener of listeners) listener()
      return true
    },
    set: (field, value) => form.mutate([{ op: 'set', path: [field], value: value as FieldValue }]),
    unset: field => form.mutate([{ op: 'unset', path: [field] }]),
  }
  return form
}
