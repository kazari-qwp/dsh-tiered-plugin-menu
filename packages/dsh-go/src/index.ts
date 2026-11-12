import type { Context } from '@deepseek-ai/cordis'
import { acquireCore } from 'dsh-tiered-plugin-core'
import { installNativeRouting } from './routing.ts'
import { mountMenu } from './menu.ts'

export { Config, inject, tieredManagerFrontend } from 'dsh-tiered-plugin-core'
export const name = 'tiered-plugin-go'
export async function apply(ctx: Context, config: { dataFile?: string }): Promise<void> {
  const manager = await acquireCore(ctx, config)
  await manager.adaptService('dshGo', installNativeRouting)
  ctx.inject(['dshGo'], child => {
    mountMenu(child, manager)
  })
}
