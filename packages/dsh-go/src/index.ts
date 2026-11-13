import type { Context } from '@deepseek-ai/cordis'
import { installNativeRouting } from './routing.ts'
import { mountMenu } from './menu.ts'

export { Config, tieredManagerFrontend } from 'dsh-tiered-plugin-core'
export const inject: string[] = []
export const name = 'tiered-plugin-go'
export async function apply(ctx: Context): Promise<void> {
  ctx.inject(['tieredPlugins', 'tieredGo', 'dshGo'], async child => {
    const manager = child.tieredPlugins
    await manager.adaptService('dshGo', installNativeRouting)
    mountMenu(child, manager)
  })
}
