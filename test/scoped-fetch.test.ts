import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../packages/web/dist/index.js'
import { scopePluginFetch } from '../packages/web/src/client/scoped-fetch.ts'
import type { PluginRow } from '../packages/core/src/shared.ts'

test('fetch captured during client module load follows the selected route after takeover and reload', async () => {
  const original = globalThis.fetch
  const key = Symbol.for('dsh-tiered-plugin-menu.fetch-bridge.v1')
  const location = Object.getOwnPropertyDescriptor(globalThis, 'location')
  const host = new Context()
  const route = '/fixture/sync'
  const prefix = '/api/__tiered/fixture'
  const request = () => new Request('http://localhost' + route, { method: 'POST', body: 'payload' })
  const nativeFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input, 'http://localhost/')
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    const body = input instanceof Request ? await input.text() : init?.body
    return Response.json([url.pathname, headers.get('x-dsh-tiered-scope'), body])
  }
  const row = { enabled: true, source: { level: 'session', id: 'a' }, routes: [route], routePrefix: prefix } as PluginRow
  let scoped: ReturnType<typeof scopePluginFetch> | undefined
  try {
    globalThis.fetch = nativeFetch
    Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL('http://localhost/') })
    apply(host)
    const rows: { kind: string; placement: string; text: string }[] = []
    host.emit('webserver/index-inject' as never, rows)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.placement, 'head')
    new Function(rows[0]!.text)()
    const captured = globalThis.fetch.bind(globalThis)
    assert.deepEqual(await (await captured(request())).json(), [route, null, 'payload'])

    scoped = scopePluginFetch()
    scoped.select(row)
    assert.deepEqual(await (await captured(request())).json(), [prefix + route, 'session:a', 'payload'])
    assert.deepEqual(await (await captured('http://example.test' + route, { body: 'foreign' })).json(), [route, null, 'foreign'])
    scoped.dispose()
    assert.deepEqual(await (await captured(request())).json(), [route, null, 'payload'])

    scoped = scopePluginFetch()
    scoped.select({ ...row, source: { level: 'session', id: 'b' } })
    assert.deepEqual(await (await captured(request())).json(), [prefix + route, 'session:b', 'payload'])
  } finally {
    scoped?.dispose()
    Reflect.deleteProperty(globalThis, key)
    globalThis.fetch = original
    if (location) Object.defineProperty(globalThis, 'location', location)
    else Reflect.deleteProperty(globalThis, 'location')
    await host.fiber.dispose()
  }
})
