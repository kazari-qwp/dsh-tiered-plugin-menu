export interface DependencyNode {
  id: string
  name: string
  provides: string[]
  requires: string[]
  enabled: boolean
}

export interface DependencyPlan {
  enable: string[]
  disable: string[]
  missing: string[]
}

/** Declared services form edges; sharing an npm package does not form an edge. */
export function dependencyPlan(nodes: DependencyNode[], targets: string[], enabled: boolean, hostServices: Set<string>): DependencyPlan {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const providers = new Map<string, DependencyNode[]>()
  for (const node of nodes) for (const name of node.provides) {
    const group = providers.get(name) ?? []
    group.push(node)
    providers.set(name, group)
  }
  const changes = new Set<string>(targets)
  const order: string[] = []
  const visited = new Set<string>()
  const missing = new Set<string>()
  if (enabled) {
    const visit = (id: string) => {
      if (visited.has(id)) return
      visited.add(id)
      for (const service of byId.get(id)?.requires ?? []) {
        const candidates = providers.get(service) ?? []
        if (candidates.some(node => node.enabled && !changes.has(node.id))) continue
        const selected = candidates.find(node => changes.has(node.id)) ?? (candidates.length === 1 ? candidates[0] : undefined)
        if (selected) { changes.add(selected.id); visit(selected.id) }
        else if (!hostServices.has(service)) missing.add(`${byId.get(id)!.name}: ${service}${candidates.length > 1 ? '（多个提供者，请先选择启用其中一个）' : ''}`)
      }
      order.push(id)
    }
    for (const id of targets) visit(id)
  } else {
    let changed = true
    while (changed) {
      changed = false
      for (const node of nodes) {
        if (!node.enabled || changes.has(node.id)) continue
        const blocked = node.requires.some(service => {
          const candidates = providers.get(service) ?? []
          return candidates.some(provider => changes.has(provider.id))
            && !candidates.some(provider => provider.enabled && !changes.has(provider.id))
            && !hostServices.has(service)
        })
        if (blocked) { changes.add(node.id); changed = true }
      }
    }
    const visit = (id: string) => {
      if (visited.has(id)) return
      visited.add(id)
      const provided = new Set(byId.get(id)?.provides)
      for (const dependent of nodes) if (changes.has(dependent.id) && dependent.requires.some(service => provided.has(service))) visit(dependent.id)
      order.push(id)
    }
    for (const id of changes) visit(id)
  }
  return { enable: enabled ? order : [], disable: enabled ? [] : order, missing: [...missing] }
}
