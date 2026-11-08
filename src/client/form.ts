import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PluginConfig } from '../shared.ts'
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
      const value = { ...snapshot.value }
      for (const op of ops) {
        if (op.path.length !== 1) throw new Error('骨架版仅适配顶层配置字段')
        const field = String(op.path[0])
        if (op.op === 'set') value[field] = op.value
        else delete value[field]
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
