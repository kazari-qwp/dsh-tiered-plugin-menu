import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { z } from 'zod'
import { ScopedServices } from '../packages/core/src/scoped-services.ts'
import { resourceName } from '../packages/core/src/resource-names.ts'

test('a scoped projection handle can scan other sessions without publishing there', async () => {
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await mountAgentLoopTestHarness(ctx)
    const { agent: a } = await ctx.agents.create({ sessionId: SessionId('reader-A') })
    const { agent: b } = await ctx.agents.create({ sessionId: SessionId('reader-B') })
    const broker = new ScopedServices(ctx, 'scan')
    const owner = await ctx.plugin(() => {})
    const definition = {
      key: 'count', stateVersion: 1, stateSchema: z.number(), init: () => 0,
      apply: (count: number) => count + 1,
      wire: { viewSchema: z.number(), view: (count: number) => count },
    }
    const handle = await broker.projection(owner.ctx, {
      scope: { level: 'session', id: 'reader-A' }, accepts: id => id === 'reader-A', configKey: () => '',
    }, definition as any)
    assert.equal(handle.stateOf(a.session), a.session.snapshotEvents().length)
    assert.equal(handle.stateOf(b.session), b.session.snapshotEvents().length)
    const reader = handle.readerFor(b.session)
    b.session.append('test/scan' as any, {} as any)
    assert.equal(reader(), b.session.snapshotEvents().length, 'scan cache follows session sequence')
    const key = resourceName('scan', 'count')
    assert.equal((ctx.sessionProjections.snapshot(b.session).values as any)[key], null, 'no contribution leaks to the other session')
    assert.equal((ctx.sessionProjections.snapshot(a.session).values as any)[key], a.session.snapshotEvents().length)
    await owner.dispose()
  } finally { await ctx.fiber.dispose() }
})

test('isolated projection reads use original keys for live and persisted statistics', async () => {
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await mountAgentLoopTestHarness(ctx)
    const { agent } = await ctx.agents.create({ sessionId: SessionId('statistics') })
    const session = agent.session
    const native = ctx.sessionProjections
    let rows = native.checkpoint(session)
    // The cache reads through the host registry, just as the durable cache does.
    ctx.provide('sessionProjectionCache', {
      cachedSnapshot: (_header: unknown, keys: any) => ({ asOfSeq: session.seq, values: native.viewCheckpoint(rows, keys) }),
      coldSnapshot: (header: any, inherited: any, events: any) => native.restore({}, events, 0 as any, header, inherited).snapshot,
      write: async () => { rows = native.checkpoint(session) },
    })
    const views: Context[] = []
    for (const name of ['first', 'second']) {
      const broker = new ScopedServices(ctx, name)
      const fiber = await ctx.isolate('sessionProjections').isolate('sessionProjectionCache').plugin(() => {})
      await broker.mount(fiber.ctx, { scope: { level: 'client', id: '' }, accepts: () => true, configKey: () => name })
      const projected = fiber.ctx.inject(['sessionProjections'], async child => {
        await child.sessionProjections.register({
          key: 'statistics', stateVersion: 1, stateSchema: z.object({ label: z.string() }),
          init: () => ({ label: name }), apply: (state: unknown) => state,
          wire: { viewSchema: z.string(), view: (state: { label: string }) => state.label },
        } as any)
        views.push(child)
      })
      await projected.await()
    }
    for (const [index, view] of views.entries()) {
      const name = index ? 'second' : 'first'
      const projections = view.sessionProjections
      const key = ['statistics'] as any
      assert.equal((projections.snapshot(session, key).values as any).statistics, name, 'live reads translate requested keys and returned values')
      assert.equal((projections.snapshot(session, new Set(key)).values as any).statistics, name)
      assert.equal((projections.snapshot(session).values as any).statistics, name)
      assert.equal((projections.cachedSnapshot(session, key)?.values as any).statistics, name)
      assert.ok((projections.summaryKeys() as ReadonlySet<string>).has('statistics'))
      const checkpoint = projections.checkpoint(session)
      assert.equal((projections.viewCheckpoint(checkpoint, key) as any).statistics, name)
      const restored = projections.restore(checkpoint, session.snapshotEvents(), 0 as any, session.header, session.inheritedEventCount)
      assert.equal((restored.snapshot.values as any).statistics, name)
      assert.equal((projections.hydrate(session, restored.checkpoint, session.snapshotEvents(), 0 as any).values as any).statistics, name)
      const cache = view.get('sessionProjectionCache') as any
      await cache.write(session)
      assert.equal(cache.cachedSnapshot(session.header, key).values.statistics, name, 'persisted reads translate keys too')
      assert.equal(cache.coldSnapshot(session.header, session.inheritedEventCount, session.snapshotEvents()).values.statistics, name)
    }
    const values = native.snapshot(session).values as any
    assert.equal(values[resourceName('first', 'statistics')], 'first')
    assert.equal(values[resourceName('second', 'statistics')], 'second')
    assert.equal(values.statistics, undefined, 'host identifiers stay isolated')
  } finally { await ctx.fiber.dispose() }
})
