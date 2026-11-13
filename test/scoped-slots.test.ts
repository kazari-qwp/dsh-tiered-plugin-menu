import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import { scopedSlot } from '../packages/core/src/scoped-slots.ts'

test('single-slot services route concurrent callbacks by session and restore global registration on disposal', async () => {
  const ctx = new Context()
  const session = (id: string) => ({ id, snapshotEvents: () => [] })
  let native!: Host
  class Host extends Service {
    constructor(ctx: Context) { super(ctx, 'probe'); native = this }
    registration?: () => string
    register(value: () => string) {
      return this.ctx.effect(() => {
        if (this.registration) throw new Error('already registered')
        this.registration = value
        return () => { this.registration = undefined }
      })
    }
    async run(session: { id: string }) {
      const before = this.registration?.()
      await new Promise(resolve => setImmediate(resolve))
      return [session.id, before, this.registration?.()]
    }
  }
  await ctx.plugin(Host)
  const unregisterGlobal = native.register(() => 'global')
  const original = native.run
  try {
    const menu = await ctx.plugin(() => {})
    const router = scopedSlot(menu.ctx, 'probe', 'registration')
    const a = await ctx.plugin(() => {})
    const b = await ctx.plugin(() => {})
    router.register(a.ctx, { accepts: id => id === 'a' }, 'register', () => 'A')
    router.register(b.ctx, { accepts: id => id === 'b' }, 'register', () => 'B')
    assert.deepEqual(await Promise.all(['a', 'b', 'c'].map(id => native.run(session(id)))), [
      ['a', 'A', 'A'], ['b', 'B', 'B'], ['c', 'global', 'global'],
    ])
    await a.dispose()
    assert.deepEqual(await native.run(session('a')), ['a', 'global', 'global'])
    assert.deepEqual(await native.run(session('b')), ['b', 'B', 'B'])
    await menu.dispose()
    assert.equal(native.run, original)
    assert.equal(native.registration?.(), 'global')
    await b.dispose()
    assert.equal(native.registration?.(), 'global', 'late owner cleanup cannot clear the restored host slot')
    unregisterGlobal()
    assert.equal(native.registration, undefined)
  } finally { await ctx.fiber.dispose() }
})

test('scoped permission admission stays unavailable in unrelated sessions', async () => {
  const ctx = new Context()
  class Presets {
    autoAdmit?: () => void
    registerAuto(admit: () => void) {
      if (this.autoAdmit) throw new Error('already registered')
      this.autoAdmit = admit
      return () => { this.autoAdmit = undefined }
    }
    catalog() { return this.autoAdmit ? ['auto'] : [] }
    apply(session: { id: string; snapshotEvents(): unknown[] }) {
      if (!this.autoAdmit) throw new Error('auto unavailable')
      this.autoAdmit()
      return session.id
    }
  }
  const native = new Presets()
  ctx.provide('probe', native)
  try {
    const menu = await ctx.plugin(() => {})
    const owner = await ctx.plugin(() => {})
    let calls = 0
    scopedSlot(menu.ctx, 'probe', 'autoAdmit').register(owner.ctx, { accepts: id => id === 'a' }, 'registerAuto', () => { calls++ })
    assert.deepEqual(native.catalog(), ['auto'])
    native.apply({ id: 'a', snapshotEvents: () => [] })
    assert.equal(calls, 1)
    assert.throws(() => native.apply({ id: 'b', snapshotEvents: () => [] }), /unavailable/)
    await owner.dispose()
    assert.deepEqual(native.catalog(), [])
    await menu.dispose()
  } finally { await ctx.fiber.dispose() }
})
