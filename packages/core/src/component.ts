import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { legacyDataFile, manageCoreUpdates } from './components.ts'
import type {} from './index.ts'

export const name = 'tiered-plugin-core-component'
export const tieredManagerFrontend = true
export const inject = ['loader', 'pluginManager', 'profileContext']
export const Config = z.object({ service: z.string().required(), dataFile: z.string() })

/** A bundle's core component holds a lease on the separately updatable host. */
export function apply(ctx: Context, config: { service: string; dataFile?: string }): void {
  manageCoreUpdates(ctx)
  ctx.inject(['tieredCore'], async child => {
    await child.tieredCore.acquire(child, { dataFile: config.dataFile ?? legacyDataFile(ctx) })
    child.provide(config.service, true)
  })
}
