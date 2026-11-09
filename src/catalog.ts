import type { Context } from '@deepseek-ai/cordis'
import type { BundleInfo } from '@deepseek-ai/dsh-plugin-manager'
import { resolveBundleDir, bundlePatchPaths, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TieredPluginMetadata } from './shared.ts'

export interface InstalledPlugin {
  id: string
  package: string
  description: string
  bundle: BundleInfo
  options: EntryOptions
  parentId: string
  supportsChildInstances: boolean
}

export async function installedPlugins(ctx: Context): Promise<InstalledPlugin[]> {
  const bundles = await ctx.pluginManager.listBundles()
  return bundles.filter(bundle => bundle.installed).flatMap(bundle => {
    let metadata: TieredPluginMetadata | undefined
    const declared = new Map<string, EntryOptions>()
    try {
      const profile = ctx.profileContext
      const directory = resolveBundleDir('dsh', bundle.name, profile.installAnchor, profile.dir)
      const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
      metadata = manifest.dsh?.tieredPluginMenu
      for (const filename of bundlePatchPaths(directory, manifest.dsh.bundle)) {
        const collect = (patches: any[]) => {
          for (const patch of patches) {
            if (patch.insert) for (const row of patch.insert) declared.set(row.id, row)
            if (patch.config && Array.isArray(patch.config)) collect(patch.config)
          }
        }
        collect(loadOverlayPatches('dsh', filename))
      }
    } catch { /* 元数据不可读仍列出插件，兼容状态为未验证。 */ }
    const rows = bundle.rows.length ? bundle.rows : [{ rowId: bundle.name, moduleName: bundle.name }]
    const parentId = rows.length === 1 ? rows[0]!.rowId : bundle.name
    return rows.map(row => ({
      id: rows.length === 1 ? parentId : `${bundle.name}#${row.rowId}`,
      parentId, package: bundle.name, description: bundle.description ?? '', bundle: { ...bundle, rows: [row] },
      options: declared.get(row.rowId) ?? { id: row.rowId, name: row.moduleName },
      supportsChildInstances: metadata?.supportsChildInstances === true,
    }))
  })
}
