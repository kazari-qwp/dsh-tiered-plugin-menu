import { Context } from '@deepseek-ai/cordis'
import { carrierKeyOf } from '@deepseek-ai/dsh-scope'

export const routing = Symbol('tiered-plugin-routing')
const wrapped = Symbol('tiered-plugin-listener')
export interface Route { accepts(sessionId: string): boolean }
type RoutedContext = Context & { [routing]?: Route }

/** 为原插件的监听器加作用域过滤，不改动原插件，也不改 Agent 的原生作用域。 */
export function installRouting(ctx: Context): void {
  ctx.on('internal/listener', function (this: RoutedContext, name, listener, options) {
    const route = this[routing]
    if (!route || typeof name !== 'string' || name.startsWith('internal/') || listener[wrapped]) return
    const filtered = function (this: unknown, ...args: any[]) {
      const carrier = carrierKeyOf(this) as { id?: string } | undefined
      const subject = args[0]
      const sessionId = subject?.agent?.id ?? subject?.sessionId ?? subject?.session?.id ?? carrier?.id
      if (sessionId && !route.accepts(String(sessionId))) {
        const next = args.at(-1)
        return typeof next === 'function' ? next() : undefined
      }
      return listener.apply(this, args)
    }
    filtered[wrapped] = true
    return this.on(name as never, filtered, options)
  })
}

export function attachRoute(ctx: Context, route: Route): void {
  ;(ctx as RoutedContext)[routing] = route
}