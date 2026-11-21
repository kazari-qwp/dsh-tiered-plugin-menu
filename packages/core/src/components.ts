import type { Context } from '@deepseek-ai/cordis'
import { interpolate } from '@deepseek-ai/cordis-plugin-loader'
import { readProfileManifest } from '@deepseek-ai/dsh-app-boot'
import type { PluginInstallRequestId } from '@deepseek-ai/dsh-plugin-manager/types'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { coreRegistrationContribution, coreRegistrationRequestPrefix, type CoreRegistrationStatus } from './remote-contract.ts'

export const corePackage = 'dsh-tiered-plugin-core'
export const interfacePackages = ['dsh-tiered-plugin-menu', 'dsh-tiered-plugin-tui', 'dsh-tiered-plugin-go']
const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
// Native installation can reload this component from a new package location.
const registrationKey = Symbol.for('dsh-tiered-plugin-core.registrations.v1')
const registrationGlobal = globalThis as typeof globalThis & { [registrationKey]?: WeakMap<Context, CoreRegistrationStatus> }
const registrations = registrationGlobal[registrationKey] ??= new WeakMap()

class CoreRegistrationService extends TypertRemoteService {
  static inject = ['pluginManager', 'profileContext']
  constructor(ctx: Context) { super(ctx, 'tieredCoreRegistration') }
  status() { return registrations.get(this.ctx.root) ?? null }
  retry() {
    const status = this.status()
    if (status?.state !== 'finished' || status.application === 'applied' || status.application === 'restart-required') return status
    const manifest = readProfileManifest('tiered-plugin-menu', this.ctx.profileContext.dir)
    if (manifest.dsh?.profile) startRegistration(this.ctx, !!manifest.dependencies?.[corePackage])
    return this.status()
  }
}

export async function exposeCoreRegistration(ctx: Context): Promise<void> {
  await ctx.plugin(CoreRegistrationService)
  ctx.effect(() => ctx.typert.register({
    package: coreRegistrationContribution.package, face: 'host', schemas: [],
    model: { services: [], events: [], objects: [] }, invocations: coreRegistrationContribution.descriptors,
  }))
}

function startRegistration(ctx: Context, installed: boolean): void {
  const root = ctx.root
  if (registrations.get(root)?.state === 'working') return
  registrations.set(root, { state: 'working', phase: installed ? 'enabling' : 'waiting' })
  const requestId = `${coreRegistrationRequestPrefix}${randomUUID()}` as PluginInstallRequestId
  const stop = ctx.on('plugin-manager/install-state', ({ requestId: id, phase, attempt }) => {
    if (id !== requestId) return
    registrations.set(root, { state: 'working', phase, attempt: attempt && { index: attempt.index, total: attempt.total } })
  })
  void (async () => {
    try {
      const result = installed
        ? await ctx.pluginManager.setBundleEnabled(corePackage, true)
        : await ctx.pluginManager.installBundle(`${corePackage}@${metadata.version}`, { enabled: true, saveExact: true, requestId })
      const reason = result.error?.diagnostic ?? result.packageResult?.kind ?? result.error?.code ?? result.restartReason
      registrations.set(root, { state: 'finished', application: result.application, reason })
      if (result.application === 'failed') ctx.logger.error('共享核心未能登记到更新器：%s', reason)
      if (result.application === 'restart-required') ctx.logger.info('共享核心已安装，请重启 Harness 完成组件加载。')
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      registrations.set(root, { state: 'finished', application: 'failed', reason })
      ctx.logger.error('共享核心未能登记到更新器：%s', reason)
    } finally { stop() }
  })()
}

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
  if (!manifest.dsh?.profile || registrations.get(ctx.root)?.state === 'working') return
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
    const task = setImmediate(() => startRegistration(ctx, !!manifest.dependencies?.[corePackage]))
    return () => clearImmediate(task)
  })
}
