import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dependencyPlan, type DependencyNode } from '../packages/core/src/dependencies.ts'

const sample = (enabled: boolean): DependencyNode[] => [
  { id: 'data', name: 'Data', provides: ['data'], requires: [], enabled },
  { id: 'api', name: 'API', provides: ['api'], requires: ['data'], enabled },
  { id: 'ui', name: 'UI', provides: [], requires: ['api'], enabled },
  { id: 'independent', name: 'Independent', provides: [], requires: [], enabled },
]
test('enable dependencies first, disable dependents first, leave unrelated components alone', () => {
  assert.deepEqual(dependencyPlan(sample(false), ['ui'], true, new Set()), { enable: ['data', 'api', 'ui'], disable: [], missing: [] })
  assert.deepEqual(dependencyPlan(sample(true), ['data'], false, new Set()), { enable: [], disable: ['ui', 'api', 'data'], missing: [] })
})
test('cycles terminate, missing/ambiguous providers are reported, an enabled alternative is sufficient', () => {
  const nodes = sample(false)
  nodes[0]!.requires.push('api')
  assert.deepEqual(new Set(dependencyPlan(nodes, ['ui'], true, new Set()).enable), new Set(['data', 'api', 'ui']))
  nodes[0]!.requires.push('missing')
  assert.deepEqual(dependencyPlan(nodes, ['ui'], true, new Set()).missing, ['Data: missing'])
  const active = sample(true)
  active.push({ id: 'alternative', name: 'Alternative', requires: [], provides: ['data'], enabled: true })
  assert.deepEqual(dependencyPlan(active, ['data'], false, new Set()).disable, ['data'])
})
