import type { Context } from '@deepseek-ai/cordis'
import { interpolate } from '@deepseek-ai/cordis-plugin-loader'
import { readProfileManifest } from '@deepseek-ai/dsh-app-boot'
import { readFileSync } from 'node:fs'

export const corePackage = 'dsh-tiered-plugin-core'
export const interfacePackages = ['dsh-tiered-plugin-menu', 'dsh-tiered-plugin-tui', 'dsh-tiered-plugin-go']
const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const registering = new WeakSet<Context>()

/** Keep a custom dataFile saved on the pre-component interface entry. */
export function legacyDataFile(ctx: Context): string | undefined {
  for (const entry of ctx.loader.entries()) {
    if (!interfacePackages.includes(entry.options.name)) continue
    const config = interpolate(ctx, entry.options.config ?? {})
    if (config.dataFile) return config.dataFile
  }
}

/** A transitive npm dependency is invisible to Harness's native updater. */
export function manageCoreUpdates(ctx: Context): void {
  const manifest = readProfileManifest('tiered-plugin-menu', ctx.profileContext.dir)
  if (!manifest.dsh?.profile || registering.has(ctx.root)) return
  if (manifest.dependencies?.[corePackage] && manifest.dsh.profile.bundles?.includes(corePackage)) return

  // Timers created inside HMR retain its AsyncLocalStorage transaction even
  // after apply returns. Use the native operation's settled event in that case.
  const hmr = ctx.get('hmr') as { executing?: { getStore(): unknown } } | undefined
  if (hmr?.executing?.getStore()) {
    const stop = ctx.on('plugin-manager/operation', operation => {
      if (operation.phase !== 'settled' || !interfacePackages.includes(operation.target ?? '')) return
      stop()
      manageCoreUpdates(ctx)
    })
    return
  }
  ctx.effect(() => {
    const task = setImmediate(() => {
      if (registering.has(ctx.root)) return
      registering.add(ctx.root)
      const change = manifest.dependencies?.[corePackage]
        ? ctx.pluginManager.setBundleEnabled(corePackage, true)
        : ctx.pluginManager.installBundle(`${corePackage}@${metadata.version}`, { enabled: true, saveExact: true })
      void change
        .then(result => {
          if (result.application === 'failed') throw new Error(result.error?.diagnostic ?? result.error?.code)
          if (result.application === 'restart-required') ctx.logger.info('共享核心已安装，请重启 Harness 完成组件加载。')
        })
        .catch(error => ctx.logger.error('共享核心未能登记到更新器：%s', error))
        .finally(() => registering.delete(ctx.root))
    })
    return () => clearImmediate(task)
  })
}
