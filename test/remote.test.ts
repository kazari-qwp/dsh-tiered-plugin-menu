import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import * as ClientGateway from '@deepseek-ai/dsh-api-gateway/client'
import { installConnection } from '@deepseek-ai/dsh-client-connection/client'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as temporary from 'dsh-temporary-messages'
import * as plugin from '../src/index.ts'
import { remoteContribution } from '../src/remote-contract.ts'
import { mountWorkspaces } from './workspaces.ts'
import { mountPluginManagement } from './plugins.ts'
import { childScope, type Scope } from '../src/shared.ts'
import { ConfigStore } from '../src/store.ts'

for (const pluginIsolation of [false, true]) test(`官方 Client Remote → Host Gateway：配置、继承、原插件预览（隔离 ${pluginIsolation}）`, { timeout: 15000 }, async () => {
  mkdirSync('work', { recursive: true })
  const host = new Context()
  const client = new Context()
  try {
    await mountAgentLoopTestDependencies(host)
    await mountWorkspaces(host)
    const workspace = await host.workspaceRegistry.create(resolve('work'))
    await host.plugin(Loader)
    host.loader.import = async () => temporary
    await host.loader.root.update([{ id: 'temporary-messages', name: 'dsh-temporary-messages', config: {} }])
    await host.loader.await()
    mountPluginManagement(host)
    await host.plugin(TypertRegistry)
    await host.plugin(RemoteAccess)
    await host.plugin(Gateway)
    await mountAgentLoopTestHarness(host)
    await host.agents.create({ sessionId: SessionId('rpc-session'), meta: { cwd: workspace.path } })
    await workspace.attachSession(SessionId('rpc-session'))
    const dataFile = resolve(mkdtempSync('work/remote-'), 'config.json')
    new ConfigStore(dataFile).setPluginIsolation(pluginIsolation)
    await host.plugin(plugin, { dataFile })
    const peer = new Peer(host, { principal: { kind: 'owner' }, interactions: 'none' })
    await client.plugin(TypertRegistry)
    installConnection(client, { interactions: 'none', transport: { rpc: {
      async call(_channel, endpoint, payload, signal) {
        const [namespace, method] = endpoint.split('/')
        return { ok: true, value: await host.typertGateway.invoke({
          namespace, method, args: (payload as { args: Record<string, unknown> }).args, peer, signal,
        }) }
      },
      async *open() {},
    } } })
    await client.plugin(ClientGateway)
    await client.remote.$mount(remoteContribution)
    const api = client.remote.tieredPluginMenu
    assert.deepEqual(await api.settings(), { ok: true, value: { inheritWorkspaceTree: true, pluginIsolation } })
    assert.ok((await api.setPluginIsolation(true)).ok)
    assert.equal(host.tieredPlugins.settings().pluginIsolation, true)
    assert.ok((await api.setWorkspaceTreeInheritance(false)).ok)
    assert.equal(host.tieredPlugins.settings().inheritWorkspaceTree, false)
    assert.equal(host.tieredPlugins.settings().pluginIsolation, true)
    assert.ok((await api.setPluginIsolation(false)).ok)
    assert.ok((await api.setWorkspaceTreeInheritance(true)).ok)
    const wsScope: Scope = { level: 'workspace', id: String(workspace.id) }
    const scope: Scope = { level: 'session', id: 'rpc-session' }
    const context = await api.context(scope.id)
    assert.ok(context.ok)
    assert.equal(context.value.workspaceId, workspace.id)
    const unconfirmed = await api.configure(scope, 'temporary-messages', true, { template: 'UNCONFIRMED' }, false)
    assert.equal(unconfirmed.ok, false)
    if (!unconfirmed.ok) assert.match(unconfirmed.error.message, /确认/)
    assert.ok((await api.configure(wsScope, 'temporary-messages', true, { template: 'WORKSPACE RPC' }, true)).ok)
    assert.ok((await api.configure(scope, 'temporary-messages', true, { template: 'RPC' }, true)).ok)
    const rows = await api.list(scope)
    assert.ok(rows.ok)
    assert.equal(rows.value[0]!.active, true)
    assert.equal(rows.value[0]!.verified, false)
    assert.equal(rows.value[0]!.config.template, 'RPC')
    assert.equal(rows.value[0]!.package, 'dsh-temporary-messages')
    assert.equal(rows.value[0]!.description, '给 DSH 提供会过期的上下文消息和可执行表达式模板')
    assert.deepEqual(await api.call(scope, 'temporary-messages', 'temporaryMessagesUi', 'preview', {
      sessionId: scope.id, template: '{{ session.id }} {{ 6 * 7 }}',
    }), { ok: true, value: 'rpc-session 42' })
    assert.ok((await api.inherit(scope, 'temporary-messages')).ok)
    const inherited = await api.list(scope)
    assert.ok(inherited.ok)
    assert.equal(inherited.value[0]!.own, false)
    assert.equal(inherited.value[0]!.config.template, 'WORKSPACE RPC')
    assert.deepEqual(await api.childSettings(wsScope), { ok: true, value: { independent: false, source: null } })
    assert.ok((await api.setChildSettings(wsScope, true)).ok)
    assert.ok((await api.configure(childScope(wsScope), 'temporary-messages', true, { template: 'CHILD RPC' }, true)).ok)
    const defaults = await api.list(childScope(wsScope))
    assert.ok(defaults.ok)
    assert.equal(defaults.value[0]!.config.template, 'CHILD RPC')
    assert.equal(defaults.value[0]!.active, false)
    assert.equal(host.tieredPlugins.instance(childScope(wsScope), 'temporary-messages'), undefined)
    const child = await host.agents.create({ sessionId: SessionId('rpc-new-session'), meta: { cwd: workspace.path } })
    const childRows = await api.list({ level: 'session', id: child.agent.id })
    assert.ok(childRows.ok)
    assert.equal(childRows.value[0]!.config.template, 'CHILD RPC')
  } finally { await client.fiber.dispose(); await host.fiber.dispose() }
})
