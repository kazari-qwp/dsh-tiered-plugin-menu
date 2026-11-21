import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import { ComponentVersions } from '../packages/web/src/client/component-versions.tsx'
import type { CoreRegistrationStatus } from '../packages/core/src/remote-contract.ts'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const subject = {
  kind: 'bundle' as const,
  pkg: { name: 'dsh-tiered-plugin-menu', installed: true, enabled: true, official: false, availability: 'profile' as const, rows: [] },
}

function events() {
  const callbacks = new Map<string, Set<(value?: unknown) => void | Promise<void>>>()
  return {
    on(event: string, callback: (value?: unknown) => void | Promise<void>) {
      if (!callbacks.has(event)) callbacks.set(event, new Set())
      callbacks.get(event)!.add(callback)
      return () => { callbacks.get(event)!.delete(callback) }
    },
    async emit(event: string, value?: unknown) { await Promise.all([...callbacks.get(event) ?? []].map(callback => callback(value))) },
    empty() { return [...callbacks.values()].every(group => group.size === 0) },
  }
}

test('component versions work with an older Core and follow native package updates', async () => {
  const native = events()
  let version = '0.9.0'
  const remote = {
    pluginManager: { async listBundles() { return { ok: true, value: [
      { name: 'dsh-tiered-plugin-menu', version: '0.9.0', installed: true, rows: [] },
      { name: 'dsh-tiered-plugin-core', version, installed: true, enabled: true, rows: [] },
    ] } } },
    $on: native.on,
  } as unknown as TypertClientRemote
  const opened: string[] = []
  let tree!: ReturnType<typeof create>
  await act(async () => { tree = create(createElement(ComponentVersions, {
    subject, remote, open: name => { opened.push(name) },
  })) })
  assert.match(JSON.stringify(tree.toJSON()), /共享核心/)
  assert.doesNotMatch(JSON.stringify(tree.toJSON()), /重启 Harness 完成组件加载/)
  tree.root.findByType('button').props.onClick()
  assert.deepEqual(opened, ['dsh-tiered-plugin-core'])
  version = '0.9.1'
  await act(() => native.emit('plugin-manager/changed'))
  assert.match(JSON.stringify(tree.toJSON()), /0\.9\.1/)
  assert.doesNotMatch(JSON.stringify(tree.toJSON()), /重启 Harness 完成组件加载/)
  await act(async () => tree.unmount())
  assert.ok(native.empty())
})

test('component versions render native registration progress, failure, retry and the restart result', async () => {
  const native = events()
  let status: CoreRegistrationStatus = { state: 'working', phase: 'installing', attempt: { index: 2, total: 3 } }
  let retries = 0
  const remote = {
    pluginManager: { async listBundles() { return { ok: true, value: [] } } },
    tieredCoreRegistration: {
      async status() { return { ok: true, value: status } },
      async retry() {
        retries++
        status = { state: 'working', phase: 'applying' }
        return { ok: true, value: status }
      },
    },
    $on: native.on,
  } as unknown as TypertClientRemote
  let tree!: ReturnType<typeof create>
  try {
    await act(async () => { tree = create(createElement(ComponentVersions, { subject, remote, open() {} })) })
    assert.match(JSON.stringify(tree.toJSON()), /正在安装共享核心.*安装源 2\/3/)
    status = { state: 'finished', application: 'failed', reason: 'registry unavailable' }
    await act(() => native.emit('plugin-manager/changed'))
    assert.match(JSON.stringify(tree.toJSON()), /共享核心登记失败.*registry unavailable/)
    await act(async () => { tree.root.findByType('button').props.onClick() })
    assert.equal(retries, 1)
    assert.match(JSON.stringify(tree.toJSON()), /正在应用共享核心安装/)
    status = { state: 'finished', application: 'restart-required', reason: 'package-moved' }
    await act(() => native.emit('plugin-manager/changed'))
    assert.match(JSON.stringify(tree.toJSON()), /核心已安装，请重启 Harness 完成组件加载/)
  } finally { if (tree) await act(async () => tree.unmount()) }
  assert.ok(native.empty())
})
