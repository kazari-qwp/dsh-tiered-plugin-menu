// Run only inside the same disposable, offline VM as the third-party matrix.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { ContextClient } from '../../packages/web/src/client/context-client.tsx'
import type { MenuRemote } from '../../packages/core/src/remote-contract.ts'
import type { PluginRow, Scope } from '../../packages/core/src/shared.ts'

const require = createRequire(import.meta.url)
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document })
let plugin!: Plugin
new Function('window', readFileSync(require.resolve('@deepcodec/dsh-clock/client'), 'utf8'))({ __ModuleLoader__: {
  // The portal menu is not under test; render its original anchor in the component harness.
  load({ factory }: any) { plugin = factory((id: string) => id === '@deepseek-ai/dsh-client-ui-primitives'
    ? { Menu: ({ anchor }: any) => anchor } : require(id)) },
} })
const root = new Context()
const dictionaries = new Map()
root.provide('locale', { register(name: string, dictionary: unknown) { dictionaries.set(name, dictionary); return () => dictionaries.delete(name) },
  bind: () => (key: string) => key, getLocale: () => 'en-US', subscribe: () => () => {} } as any)
const rows = new Map<string, PluginRow>(['A', 'B'].map(id => [id, { id: 'dsh-clock', name: 'Clock', package: '@deepcodec/dsh-clock',
  description: '', source: { level: 'session', id }, own: true, enabled: true, active: true, settings: 'registered', verified: false,
  configNamespace: 'dsh-clock', config: { mode: 'dateTime', weekday: true, showSeconds: true, intervalMs: id === 'A' ? 1000 : 2000 } }]))
const writes: unknown[] = []
const api = {
  list: async (scope: Scope) => ({ ok: true, value: [rows.get(scope.id) ?? rows.get('A')] }),
  configure: async (scope: Scope, id: string, enabled: boolean, config: any) => {
    writes.push({ scope, id, config }); Object.assign(rows.get(scope.id)!, { enabled, config }); return { ok: true, value: undefined }
  },
} as unknown as MenuRemote
const controller = new ContextClient(root, api, plugin, 'dsh-clock', '@deepcodec/dsh-clock')
const views: ReturnType<typeof create>[] = []
try {
  for (const id of ['A', 'B']) {
    const Page = await controller.settings(rows.get(id)!, { level: 'session', id })
    await act(async () => { views.push(create(createElement(Page))) })
  }
  const a = views[0]!.root.findByProps({ type: 'number' })
  assert.equal(a.props.value, '1000')
  assert.equal(views[1]!.root.findByProps({ type: 'number' }).props.value, '2000')
  await act(async () => { a.props.onChange({ target: { value: '3500' } }) })
  assert.equal(rows.get('A')!.config.intervalMs, 3500)
  assert.equal(rows.get('B')!.config.intervalMs, 2000)
  assert.equal(writes.length, 1)
  writeFileSync('work/client-settings-result.json', JSON.stringify({ plugin: '@deepcodec/dsh-clock', ok: true,
    checks: ['original settings render twice', 'separate session values', 'actual form mutation persists only to A'] }, null, 2))
  console.log('Clock original settings: render, independent values, mutation — PASS')
} finally {
  await act(async () => { for (const view of views) view.unmount() })
  await controller.dispose(); await root.fiber.dispose(); dom.window.close()
}
