import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ScopedServices } from '../packages/core/src/scoped-services.ts'

test('scoped projections accept parse-only schemas and preserve checkpoint transforms', async () => {
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await mountAgentLoopTestHarness(ctx)
    const a = await ctx.agents.create({ sessionId: SessionId('parser-a') })
    const b = await ctx.agents.create({ sessionId: SessionId('parser-b') })
    const broker = new ScopedServices(ctx)
    await ctx.plugin(async child => {
      await broker.projection(child, { scope: { level: 'session', id: 'parser-a' }, accepts: id => id === 'parser-a', configKey: () => 'one' }, {
        key: 'parserProbe', stateVersion: 1,
        stateSchema: { parse(value: any) {
          assert.equal(typeof value.open, 'boolean')
          return { open: false } // A persisted in-flight state closes on restore.
        } },
        init: () => ({ open: true }), apply: (state: any) => state,
        wire: { view: (state: any) => state.open, viewSchema: { parse(value: any) {
          assert.equal(typeof value, 'boolean')
          return value
        } } },
      } as any)
    })
    assert.equal((ctx.sessionProjections.snapshot(a.agent.session).values as any).parserProbe, true)
    assert.equal((ctx.sessionProjections.snapshot(b.agent.session).values as any).parserProbe, null)
    const checkpoint = ctx.sessionProjections.checkpoint(a.agent.session)
    assert.equal((ctx.sessionProjections.viewCheckpoint(checkpoint) as any).parserProbe, false)
  } finally { await ctx.fiber.dispose() }
})
