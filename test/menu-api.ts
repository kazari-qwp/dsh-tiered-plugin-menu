import type { MenuRemote } from '../src/remote-contract.ts'
import type { ChangePlan } from '../src/shared.ts'

export function withChangePlans(base: Omit<MenuRemote, 'plan' | 'change' | 'call'>): MenuRemote {
  const api: MenuRemote = { ...base,
    call: async () => ({ ok: true, value: undefined }),
    plan: async (scope, id, mode) => {
      const result = await base.list(scope)
      if (!result.ok) throw new Error(result.error.message)
      const row = result.value.find(row => row.id === id)!
      const unverified = mode === 'on' && scope.level !== 'client' && !row.verified ? [row.name] : []
      const plan: ChangePlan = { scope, id, mode, changes: [{ scope, id, mode, name: row.name }],
        dependencies: [], missing: [], unverified, signature: `${id}/${mode}` }
      return { ok: true, value: plan }
    },
    change: async (scope, id, mode) => {
      const result = await base.list(scope)
      if (!result.ok) throw new Error(result.error.message)
      const row = result.value.find(row => row.id === id)!
      return mode === 'inherit' ? base.inherit(scope, id) : base.configure(scope, id, mode === 'on', row.config, scope.level !== 'client' && !row.verified)
    },
  }
  return api
}
