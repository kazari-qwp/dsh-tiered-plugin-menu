import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import { ComponentVersions } from '../packages/web/src/client/component-versions.tsx'

test('component versions work before core startup and follow native package updates', async () => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  let version = '0.9.0', loaded = false, stopped = false
  let changed!: () => Promise<void>
  const remote = {
    pluginManager: { async listBundles() { return { ok: true, value: [
      { name: 'dsh-tiered-plugin-menu', version: '0.9.0', installed: true, rows: [] },
      { name: 'dsh-tiered-plugin-core', version, installed: true, enabled: true, rows: [{ entryId: loaded ? 'core-host' : undefined }] },
    ] } } },
    $on(_event: string, callback: () => Promise<void>) { changed = callback; return () => { stopped = true } },
  } as unknown as TypertClientRemote
  const opened: string[] = []
  let tree!: ReturnType<typeof create>
  await act(async () => { tree = create(createElement(ComponentVersions, {
    subject: { kind: 'bundle', pkg: { name: 'dsh-tiered-plugin-menu', installed: true, enabled: true, official: false, availability: 'profile', rows: [] } },
    remote, open: name => { opened.push(name) },
  })) })
  assert.match(JSON.stringify(tree.toJSON()), /共享核心/)
  assert.match(JSON.stringify(tree.toJSON()), /重启 Harness 完成组件加载/)
  tree.root.findByType('button').props.onClick()
  assert.deepEqual(opened, ['dsh-tiered-plugin-core'])
  version = '0.9.1'; loaded = true
  await act(changed)
  assert.match(JSON.stringify(tree.toJSON()), /0\.9\.1/)
  assert.doesNotMatch(JSON.stringify(tree.toJSON()), /重启 Harness 完成组件加载/)
  await act(async () => tree.unmount())
  assert.equal(stopped, true)
})
