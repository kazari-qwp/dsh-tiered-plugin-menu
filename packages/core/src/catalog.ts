import type { Context } from '@deepseek-ai/cordis'
import type { BundleInfo } from '@deepseek-ai/dsh-plugin-manager'
import { resolveBundleDir, bundlePatchPaths, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TieredPluginMetadata } from './shared.ts'

export interface InstalledPlugin {
  kind?: 'mcp'
  owned?: boolean
  id: string
  package: string
  title?: string
  description: string
  bundle: BundleInfo
  options: EntryOptions
  parentId: string
  compatible: boolean
  peers: string[]
}

export const mcpModule = '@deepseek-ai/dsh-mcp-client'

/** A configured MCP server uses the same lifecycle and scoped services as a plugin entry. */
export function mcpAdapter(id: string, options: EntryOptions, enabled: boolean, owned = false): InstalledPlugin {
  return { id, parentId: id, kind: 'mcp', owned, package: mcpModule,
    description: 'MCP 服务器', options, compatible: true, peers: [],
    bundle: { name: mcpModule, enabled, installed: true, optional: false, removable: false, official: true, availability: 'profile', updatable: false, overrides: [],
      rows: owned ? [{ rowId: options.id, moduleName: mcpModule }] : [{ rowId: options.id, moduleName: mcpModule, entryId: id.slice(4) as never }] },
  }
}

export async function installedPlugins(ctx: Context): Promise<InstalledPlugin[]> {
  const bundles = await ctx.pluginManager.listBundles()
  return bundles.filter(bundle => bundle.installed || bundle.official && bundle.availability === 'installation'
    && (bundle.listedByDefault !== false || bundle.enabled)).flatMap(bundle => {
    let metadata: TieredPluginMetadata | undefined
    let peers: string[] = []
    const declared = new Map<string, EntryOptions>()
    try {
      const profile = ctx.profileContext
      const directory = resolveBundleDir('dsh', bundle.name, profile.installAnchor, profile.dir)
      const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
      metadata = manifest.dsh?.tieredPluginMenu
      peers = Object.keys(manifest.peerDependencies ?? {})
      for (const filename of bundlePatchPaths(directory, manifest.dsh.bundle)) {
        const collect = (patches: any[]) => {
          for (const patch of patches) {
            if (patch.insert) for (const row of patch.insert) {
              declared.set(row.id, row)
              if (row.group && Array.isArray(row.config)) collect([{ insert: row.config }])
            }
            if (patch.config && Array.isArray(patch.config)) collect(patch.config)
          }
        }
        collect(loadOverlayPatches('dsh', filename))
      }
    } catch { /* 元数据不可读仍列出插件，兼容状态为未验证。 */ }
    const rows = bundle.rows.length ? bundle.rows : [{ rowId: bundle.name, moduleName: bundle.name }]
    const parentId = rows.length === 1 ? rows[0]!.rowId : bundle.name
    const text = (value: string | Record<string, string> | undefined) => typeof value === 'string' ? value : value?.['zh-CN'] ?? value?.zh ?? value?.en
    return rows.map(row => ({
      id: rows.length === 1 ? parentId : `${bundle.name}#${row.rowId}`,
      parentId, package: bundle.name, title: text(bundle.meta?.title), description: text(bundle.meta?.description) ?? bundle.description ?? '', bundle: { ...bundle, rows: [row] },
      options: declared.get(row.rowId) ?? { id: row.rowId, name: row.moduleName },
      compatible: metadata?.Compatible === true,
      peers,
    }))
  })
}
