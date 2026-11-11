import type { MenuRemote } from '../src/remote-contract.ts'
import { isClientScope, scopeKey, type ChangePlan } from '../src/shared.ts'

export function withChangePlans(base: Omit<MenuRemote, 'plan' | 'change' | 'call' | 'childSettings' | 'setChildSettings' | 'settings' | 'setWorkspaceTreeInheritance' | 'setPluginIsolation' | 'addMcp' | 'skills' | 'skillConfig' | 'configureSkill' | 'inheritSkill'>): MenuRemote {
  const children = new Set<string>()
  let inheritWorkspaceTree = true
  let pluginIsolation = false
  const api: MenuRemote = { ...base,
    addMcp: async () => ({ ok: true, value: 'mcp:test' }),
    skills: async () => ({ ok: true, value: [] }),
    skillConfig: async () => ({ ok: true, value: {} }),
    configureSkill: async () => ({ ok: true, value: undefined }),
    inheritSkill: async () => ({ ok: true, value: undefined }),
    settings: async () => ({ ok: true, value: { inheritWorkspaceTree, pluginIsolation } }),
    setWorkspaceTreeInheritance: async enabled => { inheritWorkspaceTree = enabled; return { ok: true, value: undefined } },
    setPluginIsolation: async enabled => { pluginIsolation = enabled; return { ok: true, value: undefined } },
    childSettings: async scope => ({ ok: true, value: { independent: children.has(scopeKey(scope)), source: children.has(scopeKey(scope)) ? scope : null } }),
    setChildSettings: async (scope, independent) => {
      independent ? children.add(scopeKey(scope)) : children.delete(scopeKey(scope))
      return { ok: true, value: undefined }
    },
    call: async () => ({ ok: true, value: undefined }),
    plan: async (scope, id, mode) => {
      const result = await base.list(scope)
      if (!result.ok) throw new Error(result.error.message)
      const row = result.value.find(row => row.id === id)!
      const unverified = mode === 'on' && !isClientScope(scope) && !row.verified ? [row.name] : []
      const plan: ChangePlan = { scope, id, mode, changes: [{ scope, id, mode, name: row.name }],
        dependencies: [], missing: [], unverified, signature: `${id}/${mode}` }
      return { ok: true, value: plan }
    },
    change: async (scope, id, mode) => {
      const result = await base.list(scope)
      if (!result.ok) throw new Error(result.error.message)
      const row = result.value.find(row => row.id === id)!
      return mode === 'inherit' ? base.inherit(scope, id) : base.configure(scope, id, mode === 'on', row.config, !isClientScope(scope) && !row.verified)
    },
  }
  return api
}
