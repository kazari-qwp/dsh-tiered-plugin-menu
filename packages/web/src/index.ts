import type { Context } from '@deepseek-ai/cordis'
import { acquireCore } from 'dsh-tiered-plugin-core'

export { Config, inject, tieredManagerFrontend } from 'dsh-tiered-plugin-core'
export const name = 'tiered-plugin-menu'
export async function apply(ctx: Context, config: { dataFile?: string }): Promise<void> {
  await acquireCore(ctx, config)
}
