import type { Context } from '@deepseek-ai/cordis'
import type { BundleInfo } from '@deepseek-ai/dsh-plugin-manager'
import { resolveBundleDir } from '@deepseek-ai/dsh-app-boot'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { adapters, type TieredPluginMetadata } from './shared.ts'

export interface InstalledPlugin {
  id: string
  package: string
  description: string
  bundle: BundleInfo
  services: readonly string[]
  uiService?: string
  scopedRegistries: boolean
  verifiedScopes: readonly string[]
}

export async function installedPlugins(ctx: Context): Promise<InstalledPlugin[]> {
  const bundles = await ctx.pluginManager.listBundles()
  return bundles.filter(bundle => bundle.installed).map(bundle => {
    const adapter = adapters.find(item => item.package === bundle.name)
    let metadata: TieredPluginMetadata | undefined
    try {
      const profile = ctx.profileContext
      const directory = resolveBundleDir('dsh', bundle.name, profile.installAnchor, profile.dir)
      metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).dsh?.tieredPluginMenu
    } catch { /* 元数据不可读仍列出插件，兼容状态为未验证。 */ }
    return {
      id: adapter?.id ?? bundle.name, package: bundle.name, description: bundle.description ?? '', bundle,
      services: adapter?.services ?? [], uiService: adapter?.uiService,
      scopedRegistries: adapter?.scopedRegistries ?? false,
      verifiedScopes: Array.isArray(metadata?.verifiedScopes) ? metadata.verifiedScopes : [],
    }
  })
}
