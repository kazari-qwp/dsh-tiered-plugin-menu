import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, connect } from 'node:net'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as menu from '../src/index.ts'
import { mountWorkspaces } from './workspaces.ts'
import { mountPluginManagement } from './plugins.ts'

test('真实 TCP 端口：第二实例绑定冲突撤销配置，原实例仍可连接，释放后可重试', async () => {
  const root = resolve(mkdtempSync('work/port-test-'))
  const name = 'fixed-port-test-plugin'
  const directory = join(root, 'node_modules', name)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'test-profile', dependencies: { [name]: '*' } }))
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js' }))
  writeFileSync(join(directory, 'index.js'), '')
  const servers: ReturnType<typeof createServer>[] = []
  const plugin = { async apply(ctx: Context, config: { port: number }) {
    const server = createServer(socket => { socket.end('OK') })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(config.port, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
    })
    servers.push(server)
    ctx.effect(() => () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  } }
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await mountWorkspaces(ctx)
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(Loader)
    ctx.loader.import = async () => plugin
    await ctx.loader.root.update([{ id: name, name, disabled: true }])
    mountPluginManagement(ctx, root)
    await mountAgentLoopTestHarness(ctx)
    for (const id of ['A', 'B']) await ctx.agents.create({ sessionId: SessionId(id) })
    await ctx.plugin(menu, { dataFile: join(root, 'settings.json') })
    const manager = ctx.tieredPlugins
    const a = { level: 'session' as const, id: 'A' }
    const b = { level: 'session' as const, id: 'B' }
    await manager.configure(a, name, true, { port: 0 }, true)
    const port = (servers[0]!.address() as { port: number }).port
    await assert.rejects(manager.configure(b, name, true, { port }, true), /EADDRINUSE/)
    assert.equal(manager.store.get(b, name), undefined)
    assert.equal(manager.instance(b, name), undefined)
    assert.equal(servers[0]!.listening, true)
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1')
      let text = ''
      socket.on('data', chunk => { text += chunk.toString() })
      socket.on('end', () => resolve(text))
      socket.on('error', reject)
    })
    assert.equal(reply, 'OK')
    await manager.configure(a, name, false, { port })
    assert.equal(servers[0]!.listening, false)
    await manager.configure(b, name, true, { port }, true)
    assert.equal(servers[1]!.listening, true)
    await manager.configure(a, name, true, { port: 0 }, true)
    await assert.rejects(manager.configure(a, name, true, { port }, true), /EADDRINUSE/)
    assert.deepEqual(manager.store.get(a, name)?.config, { port: 0 })
    assert.equal(manager.instance(a, name)?.plugin.state, 2, '改端口失败后恢复原实例配置并重新启动')
  } finally { await ctx.fiber.dispose() }
})
