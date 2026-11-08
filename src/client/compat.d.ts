declare module 'dsh-temporary-messages/client' {
  import type { Context } from '@deepseek-ai/cordis'
  export const inject: string[]
  export function apply(ctx: Context): Promise<void>
}

declare module 'dsh-context/client' {
  import type { Context } from '@deepseek-ai/cordis'
  export const inject: string[]
  export function apply(ctx: Context): void
}
