import type { Context } from '@deepseek-ai/cordis'
import { acquireCore, inject as coreInject } from 'dsh-tiered-plugin-core'
import { createPanel } from './panel.ts'

export { Config, tieredManagerFrontend } from 'dsh-tiered-plugin-core'
export const inject = [...coreInject, 'tieredPlugins']
export const name = 'tiered-plugin-tui'
export async function apply(ctx: Context, config: { dataFile?: string }): Promise<void> {
  const manager = await acquireCore(ctx, config)
  ctx.inject(['tuiPanels', 'tuiDialogs'], child => {
    const panels = child.get('tuiPanels') as any
    panels.register({ apiVersion: 1, id: 'tiered-menu', title: '分级配置', icon: '≡', minColumns: 32,
      component: createPanel(child, manager) }, child)
  })
}
