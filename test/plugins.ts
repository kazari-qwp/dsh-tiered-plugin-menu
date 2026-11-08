import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveBundleDir } from '@deepseek-ai/dsh-app-boot'
import type { BundleInfo } from '@deepseek-ai/dsh-plugin-manager'

/** 内存 Loader 使用相同管理接口；变更仍交给真实 Entry.update。 */
export function mountPluginManagement(ctx: Context, directory = resolve('.')) {
  const selected = new Map<string, boolean>()
  const profile = { dir: directory, installAnchor: join(directory, 'package.json') }
  ctx.provide('profileContext', profile as Context['profileContext'])
  ctx.provide('configEditor', {
    edit: async (entry: any, change: any) => { await entry.update({ config: change(entry.options.config ?? {}, {}) }) },
  } as Context['configEditor'])
  const calls: { package?: string; entry?: string; enabled: boolean }[] = []
  ctx.provide('pluginManager', {
    async listBundles(): Promise<BundleInfo[]> {
      const entries = [...ctx.loader.entries()]
      return [...new Set(entries.map(entry => entry.options.name))].map(name => {
        const dir = resolveBundleDir('dsh', name, profile.installAnchor, directory)
        const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
        return { name, description: manifest.description, installed: true, optional: false, removable: true,
          official: false, availability: 'profile', updatable: false,
          enabled: selected.get(name) ?? true, overrides: [],
          rows: entries.filter(entry => entry.options.name === name).map(entry => ({
            rowId: entry.options.id, moduleName: name, entryId: entry.id as never,
          })),
        }
      })
    },
    async setPluginEnabled(id: string, enabled: boolean) {
      calls.push({ entry: id, enabled })
      const entry = [...ctx.loader.entries()].find(entry => entry.id === id)!
      await entry.update({ disabled: !enabled })
      return { changed: true, application: 'applied', stage: 'enable', target: id, enabled }
    },
    async setBundleEnabled(name: string, enabled: boolean) {
      calls.push({ package: name, enabled })
      selected.set(name, enabled)
      return { changed: true, application: 'applied', stage: 'enable', target: name, enabled }
    },
  } as Context['pluginManager'])
  return { calls, selected }
}
