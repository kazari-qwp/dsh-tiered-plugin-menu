import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import { isolateProvidedServices } from '../src/isolation.ts'

test('services provided dynamically belong to a scope and can be consumed by another component', async () => {
  const root = new Context()
  try {
    root.provide('hostDependency', 42)
    const contexts = [0, 1].map(() => isolateProvidedServices(root, Object.create(root[Context.isolate])))
    class Counter extends Service {
      value = 0
      constructor(ctx: Context) { super(ctx, 'sampleCounter') }
    }
    for (const ctx of contexts) {
      await ctx.plugin(Counter)
      await ctx.plugin({ inject: ['sampleCounter'], apply(child: Context) { (child.get('sampleCounter') as Counter).value++ } })
      assert.equal((ctx.get('sampleCounter') as Counter).value, 1)
      assert.equal(ctx.get('hostDependency'), 42)
      ctx.isolate('hostDependency').provide('hostDependency', 7)
      assert.equal(ctx.get('hostDependency'), 42, 'a component-private service must not shadow the shared realm')
    }
    assert.equal(root.get('sampleCounter'), undefined)
    assert.notEqual(contexts[0]!.get('sampleCounter'), contexts[1]!.get('sampleCounter'))
  } finally { await root.fiber.dispose() }
})
