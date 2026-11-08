import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { ScopePanel } from '../src/client/menu.tsx'
import { clientScope, type PluginRow, type ChangePlan } from '../src/shared.ts'
import type { MenuRemote } from '../src/remote-contract.ts'
import { dependencyPlan } from '../src/dependencies.ts'

test('package row opens component details; dependency dialogs cancel without writes and confirm the complete change', async () => {
  const enabled = new Set<string>()
  const writes: string[] = []
  const component = (id: string): PluginRow => ({ id, name: id, package: 'bundle', description: '', config: {},
    own: true, active: enabled.has(id), enabled: enabled.has(id), source: clientScope, verified: true, settings: 'native' })
  const rows = () => {
    const components = ['provider', 'consumer', 'independent'].map(component)
    return [{ ...component('bundle'), components, enabled: components.every(row => row.enabled), partial: enabled.size > 0 && enabled.size < 3 }]
  }
  let lastPlan: ChangePlan
  const api = {
    list: async () => ({ ok: true, value: rows() }),
    plan: async (scope, id, mode) => {
      const targets = id === 'bundle' ? ['provider', 'consumer', 'independent'] : [id]
      const calculated = dependencyPlan(['provider', 'consumer', 'independent'].map(id => ({ id, name: id,
        provides: id === 'provider' ? ['data'] : [], requires: id === 'consumer' ? ['data'] : [], enabled: enabled.has(id) })), targets, mode === 'on', new Set())
      const changes = [...calculated.enable, ...calculated.disable].map(id => ({ scope, id, name: id, mode }))
      lastPlan = { scope, id, mode, changes, dependencies: changes.filter(change => !targets.includes(change.id)), missing: [], unverified: [], signature: 'confirmed' }
      return { ok: true, value: lastPlan }
    },
    change: async () => {
      for (const change of lastPlan.changes) { writes.push(`${change.id}:${change.mode}`); change.mode === 'on' ? enabled.add(change.id) : enabled.delete(change.id) }
      return { ok: true, value: undefined }
    },
  } satisfies Pick<MenuRemote, 'list' | 'plan' | 'change'> as unknown as MenuRemote
  let view: ReactTestRenderer
  const click = async (label: string) => act(async () => { view.root.findAllByType('button').find(button => button.children.includes(label))!.props.onClick() })
  const mode = async (id: string, value: string) => act(async () => {
    view.root.findByProps({ 'aria-label': `${id}配置方式` }).findByProps({ 'data-mode': value }).props.onClick()
  })
  try {
    await act(async () => { view = create(createElement(ScopePanel, { api, scope: clientScope, Page: () => null,
      ui: { Artwork: () => null, openDetails() {} } })) })
    assert.equal(view!.root.findAllByProps({ className: 'tiered-plugin-card' }).length, 1)
    await click('bundle')
    assert.equal(view!.root.findAllByProps({ className: 'tiered-plugin-card' }).length, 3)
    await mode('consumer', 'on')
    assert.equal(view!.root.findByProps({ role: 'alertdialog' }).findByType('li').children[0], 'provider')
    await click('取消')
    assert.deepEqual(writes, [])
    await mode('consumer', 'on'); await click('自动启用')
    assert.deepEqual(writes, ['provider:on', 'consumer:on'])
    await mode('provider', 'off'); await click('取消')
    assert.equal(enabled.size, 2)
    await mode('provider', 'off'); await click('自动关闭')
    assert.deepEqual(writes.slice(-2), ['consumer:off', 'provider:off'])
    await click('‹ 插件'); await mode('bundle', 'on')
    assert.equal(enabled.size, 3)
    assert.equal(view!.root.findAllByProps({ role: 'alertdialog' }).length, 0)
  } finally { await act(async () => view?.unmount()) }
})
