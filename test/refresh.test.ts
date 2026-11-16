import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import type { MenuRemote } from '../packages/core/src/remote-contract.ts'
import { clientScope, type PluginRow } from '../packages/core/src/shared.ts'
import { ContextClient } from '../packages/web/src/client/context-client.tsx'
import { coalesce, rowReader } from '../packages/web/src/client/refresh.ts'

test('many frontend controllers share one discovery snapshot and never retain it across edits', async () => {
  const ctx = new Context()
  let calls = 0, version = 1
  const rows = () => Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, package: `p${i}`, name: `p${i}`,
    description: '', source: clientScope, own: true, enabled: true, active: true, verified: false,
    managed: false, settings: 'registered' as const, config: { version } }))
  const api = { list: async () => { calls++; return { ok: true, value: rows() } } } as unknown as MenuRemote
  const reader = rowReader(api)
  const controllers = rows().map(row => new ContextClient(ctx, api, { apply() {} }, row.id, row.package, reader.read))
  try {
    const first = reader.snapshot()
    for (const controller of controllers) await controller.refresh(first)
    assert.equal(calls, 1, 'one client list, not two full lists per plugin')
    await Promise.all(controllers.map(controller => controller.select('session-A')))
    assert.equal(calls, 2, 'unmanaged plugins do not request session-specific lists')
    version = 2
    const second = reader.snapshot()
    for (const controller of controllers) await controller.refresh(second)
    assert.equal(calls, 3)
    assert.equal((await second(clientScope))[0]!.config.version, 2, 'a new pass sees saved settings')
  } finally { for (const controller of controllers) await controller.dispose(); await ctx.fiber.dispose() }
})

test('in-flight reads deduplicate by scope, invalidate safely and recover from RPC failure', async () => {
  const pending: { scope: string; resolve(value: any): void }[] = []
  const reader = rowReader({ list: (scope: any) => new Promise(resolve => pending.push({ scope: scope.id, resolve })) } as MenuRemote)
  const first = reader.read(clientScope)
  assert.equal(first, reader.read(clientScope))
  const session = reader.read({ level: 'session', id: 'A' })
  reader.invalidate()
  const fresh = reader.read(clientScope)
  pending[0]!.resolve({ ok: true, value: [{ config: { version: 1 } }] })
  await first
  assert.equal(reader.read(clientScope), fresh, 'old completion cannot evict the new in-flight read')
  pending[1]!.resolve({ ok: false, error: { message: 'temporary failure' } })
  await assert.rejects(session, /temporary failure/)
  pending[2]!.resolve({ ok: true, value: [{ config: { version: 2 } }] })
  assert.equal((await fresh)[0]!.config.version, 2)
  const retry = reader.read({ level: 'session', id: 'A' })
  pending[3]!.resolve({ ok: true, value: [] as PluginRow[] })
  assert.deepEqual(await retry, [])
})

test('refresh bursts coalesce but changes during a pass get one follow-up; failures can retry', async () => {
  let runs = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let fail = false
  const refresh = coalesce(async () => { runs++; if (runs === 1) await gate; if (fail) throw new Error('fail') })
  const first = Promise.all(Array.from({ length: 30 }, () => refresh()))
  await Promise.resolve()
  assert.equal(runs, 1)
  const second = Promise.all(Array.from({ length: 30 }, () => refresh()))
  release()
  await Promise.all([first, second])
  assert.equal(runs, 2)
  fail = true
  await assert.rejects(refresh(), /fail/)
  fail = false
  await refresh()
  assert.equal(runs, 4)
})

test('a change immediately after a pass finishes is not lost during promise settlement', async () => {
  let runs = 0
  const refresh = coalesce(async () => { runs++ })
  const first = refresh()
  await Promise.resolve(); await Promise.resolve()
  await Promise.all([first, refresh()])
  assert.equal(runs, 2)
})
