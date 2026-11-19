import type { Context } from '@deepseek-ai/cordis'
import { installFetchBridge } from './fetch-bridge.ts'
export { Config, tieredManagerFrontend } from 'dsh-tiered-plugin-core'
export const inject: string[] = []
export const name = 'tiered-plugin-menu'
export function apply(ctx: Context): void {
  // A client module may capture fetch as soon as its factory is evaluated.
  // Install the dispatcher in the document before the module graph starts.
  const row = { kind: 'script', placement: 'head', text: `(${installFetchBridge.toString()})(globalThis, true)` }
  ctx.on('webserver/index-inject' as never, (rows: unknown[]) => { rows.push(row) })
}
