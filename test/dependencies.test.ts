import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dependencyPlan, type DependencyNode } from '../packages/core/src/dependencies.ts'

const sample = (enabled: boolean): DependencyNode[] => [
  { id: 'data', name: 'Data', provides: ['data'], requires: [], enabled },
  { id: 'api', name: 'API', provides: ['api'], requires: ['data'], enabled },
  { id: 'ui', name: 'UI', provides: [], requires: ['api'], enabled },
  { id: 'independent', name: 'Independent', provides: [], requires: [], enabled },
]

test('constructor-named services start before their bundle consumers without hiding external missing dependencies', () => {
  const nodes: DependencyNode[] = [
    { id: 'consumer', name: 'Consumer', package: 'bundle', provides: [], requires: ['runtime-service'], enabled: false },
    { id: 'provider', name: 'Provider', package: 'bundle', dynamicProvides: true, provides: [], requires: [], enabled: false },
  ]
  assert.deepEqual(dependencyPlan(nodes, ['consumer', 'provider'], true, new Set()), { enable: ['provider', 'consumer'], disable: [], missing: [] })
  assert.deepEqual(dependencyPlan(nodes, ['consumer'], true, new Set()).missing, ['Consumer: runtime-service'])
  nodes[1]!.package = 'other-bundle'
  assert.deepEqual(dependencyPlan(nodes, ['consumer', 'provider'], true, new Set()).missing, ['Consumer: runtime-service'])
  nodes[1]!.package = 'bundle'
  nodes[1]!.dynamicProvides = false
  nodes[1]!.provides = ['runtime-service']
  assert.deepEqual(dependencyPlan(nodes, ['consumer'], true, new Set()).enable, ['provider', 'consumer'])
})
test('enable dependencies first, disable dependents first, leave unrelated components alone', () => {
  assert.deepEqual(dependencyPlan(sample(false), ['ui'], true, new Set()), { enable: ['data', 'api', 'ui'], disable: [], missing: [] })
  assert.deepEqual(dependencyPlan(sample(true), ['data'], false, new Set()), { enable: [], disable: ['ui', 'api', 'data'], missing: [] })
})

test('dynamic service chains preserve bundle order instead of moving the last consumer before its provider', () => {
  const nodes: DependencyNode[] = [
    { id: 'registry', name: 'Registry', package: 'bundle', dynamicProvides: true, provides: [], requires: [], enabled: false },
    { id: 'session', name: 'Session', package: 'bundle', dynamicProvides: true, provides: [], requires: ['registry'], enabled: false },
    { id: 'panel', name: 'Panel', package: 'bundle', dynamicProvides: true, provides: [], requires: ['registry', 'session'], enabled: false },
  ]
  assert.deepEqual(dependencyPlan(nodes, nodes.map(n => n.id), true, new Set()), { enable: ['registry', 'session', 'panel'], disable: [], missing: [] })
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
