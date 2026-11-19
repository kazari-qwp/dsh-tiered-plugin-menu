type FetchArgs = Parameters<typeof fetch>
type Rewrite = (...args: FetchArgs) => FetchArgs | undefined
type FetchBridge = { use(rewrite: Rewrite): () => void }

/** Serialized into the host's index. Keep this function independent of module state. */
export function installFetchBridge(target: typeof globalThis, keep = false): FetchBridge {
  const key = Symbol.for('dsh-tiered-plugin-menu.fetch-bridge.v1')
  const browser = target as typeof globalThis & { [key]?: FetchBridge }
  if (browser[key]) return browser[key]

  const nativeFetch = target.fetch
  const rewrites: Rewrite[] = []
  const dispatch: typeof fetch = (...args) => {
    for (const rewrite of rewrites) {
      const rewritten = rewrite(...args)
      if (rewritten) return nativeFetch.apply(target, rewritten)
    }
    return nativeFetch.apply(target, args)
  }
  const bridge: FetchBridge = {
    use(rewrite) {
      rewrites.unshift(rewrite)
      return () => {
        const index = rewrites.indexOf(rewrite)
        if (index !== -1) rewrites.splice(index, 1)
        if (!keep && !rewrites.length && target.fetch === dispatch) {
          target.fetch = nativeFetch
          delete browser[key]
        }
      }
    },
  }
  browser[key] = bridge
  target.fetch = dispatch
  return bridge
}
