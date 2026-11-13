import type { Context } from '@deepseek-ai/cordis'
import { createPanel } from './panel.ts'

export { Config, tieredManagerFrontend } from 'dsh-tiered-plugin-core'
export const inject: string[] = []
export const name = 'tiered-plugin-tui'
export function apply(ctx: Context): void {
  ctx.inject(['tieredPlugins', 'tieredTui', 'tuiPanels', 'tuiDialogs'], child => {
    const manager = child.tieredPlugins
    const panels = child.get('tuiPanels') as any
    panels.register({ apiVersion: 1, id: 'tiered-menu', title: '分级配置', icon: '≡', minColumns: 32,
      component: createPanel(child, manager) }, child)
  })
}
