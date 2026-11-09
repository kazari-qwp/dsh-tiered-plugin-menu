import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { createRequire } from 'node:module'
const local = createRequire(path.join(process.cwd(), 'package.json'))
const { LlmAdapter, createUserMessage } = local('@deepseek-ai/dsh-llm')
const { assembleContextFor } = local('@deepseek-ai/dsh-agent')

export async function functionalMix(ctx, report, home, save) {
  const requests = [], notifications = []
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    notifications.push({ path: req.url, ...JSON.parse(body) }); res.end('ok')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  ctx.llm.registerAdapter(['compat-test'], new class extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream(request) {
      requests.push(request)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'sandbox answer' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'sandbox answer' } }
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }())
  // Avoid background paid requests and OS notification commands in the samples.
  report.setup = []
  for (const name of ['dsh-tacit', '@cerbur/clutch-dsh-title', 'dsh-notification']) {
    const entry = [...ctx.loader.entries()].find(entry => entry.options.name === name)
    if (!entry) continue
    const setup = { name, before: entry.fiber?.state }; report.setup.push(setup)
    try {
      if (entry.options.name === 'dsh-tacit') await ctx.configEditor.edit(entry, () => ({ autoAnalyze: false }))
      if (entry.options.name === '@cerbur/clutch-dsh-title') await ctx.configEditor.edit(entry, () => ({ template: 'SANDBOX', fields: {}, preset: 'default' }))
      if (entry.options.name === 'dsh-notification') await ctx.configEditor.edit(entry, () => ({ desktop: false, browser: false, minTurnDurationMs: 0, webhookUrl: url + '/CLIENT' }))
      setup.ok = true
    } catch (error) { setup.ok = false; setup.error = String(error) }
  }
  const workspaces = []
  for (const label of ['matrix-one', 'matrix-two']) {
    const cwd = path.join(home, label); fs.mkdirSync(cwd)
    workspaces.push(await ctx.workspaceRegistry.create(cwd))
  }
  const handles = []
  for (const [name, index] of [['FA', 0], ['FB', 0], ['FC', 1], ['FD', 1]]) {
    const handle = await ctx.agents.create({ sessionId: name, meta: { cwd: workspaces[index].path }, agentOptions: { provider: 'compat-test', model: 'test' } })
    await workspaces[index].attachSession(handle.agent.id); handles.push(handle)
  }
  const client = { level: 'client', id: '' }, workspace = { level: 'workspace', id: String(workspaces[0].id) }
  const session = { level: 'session', id: 'FA' }
  const manager = ctx.tieredPlugins
  report.turns = []
  const send = async agent => {
    const started = Date.now(), before = requests.length
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    report.turns.push({ sessionId: agent.id, elapsedMs: Date.now() - started, requests: requests.length - before })
    save()
  }
  report.functional = []
  report.persistence = []
  for (const name of ['dsh-temporary-messages', 'dsh-context', 'dsh-notification']) {
    const row = (await manager.rows(client)).find(row => row.package === name)
    if (!row) continue
    let entry = [...ctx.loader.entries()].find(entry => entry.options.name === name)
    const config = marker => name === 'dsh-temporary-messages' ? { template: `TMP_${marker}`, defaultTtlTokens: 0 }
      : name === 'dsh-context' ? { promptPrefix: `CTX_${marker}` }
      : { desktop: false, browser: false, minTurnDurationMs: 0, webhookUrl: url + '/' + marker }
    const item = { name, cases: [] }; report.functional.push(item)
    if (name !== 'dsh-notification') {
      const persistence = { name }; report.persistence.push(persistence)
      try {
        await manager.configure(client, row.id, false, {})
        await manager.configure(client, row.id, true, config('PERSISTED'))
        entry = [...ctx.loader.entries()].find(entry => entry.options.name === name)
        const key = name === 'dsh-context' ? 'promptPrefix' : 'template'
        assert.equal(entry.options.config?.[key], config('PERSISTED')[key], 'The first enable must apply the requested config')
        await ctx.pluginManager.setPluginEnabled(entry.id, false)
        await ctx.pluginManager.setPluginEnabled(entry.id, true)
        entry = [...ctx.loader.entries()].find(entry => entry.options.name === name)
        assert.equal(entry.options.config?.[key], config('PERSISTED')[key], 'A native toggle must retain the saved config')
        assert.ok(fs.readFileSync(ctx.configEditor.documentPath, 'utf8').includes('PERSISTED'), 'The profile must contain the saved config')
        persistence.ok = true
      } catch (error) { persistence.ok = false; persistence.error = String(error?.stack ?? error).slice(0, 1000) }
    }
    await manager.configure(client, row.id, true, config('CLIENT'))
    entry = [...ctx.loader.entries()].find(entry => entry.options.name === name)
    await ctx.configEditor.edit(entry, () => config('CLIENT'))
    for (const globalOn of process.argv.includes('--persistence-only') ? [] : [false, true]) for (const ws of ['inherit', 'on', 'off']) for (const ses of ['inherit', 'on', 'off']) {
      const result = { globalOn, workspace: ws, session: ses }
      try {
        await manager.configure(client, row.id, globalOn, config('CLIENT'))
        if (ws === 'inherit') await manager.inherit(workspace, row.id)
        else await manager.configure(workspace, row.id, ws === 'on', config('WORKSPACE'), true)
        if (ses === 'inherit') await manager.inherit(session, row.id)
        else await manager.configure(session, row.id, ses === 'on', config('SESSION'), true)
        const expected = [ses === 'on' ? 'SESSION' : ses === 'off' ? null : ws === 'on' ? 'WORKSPACE' : ws === 'off' ? null : globalOn ? 'CLIENT' : null,
          ws === 'on' ? 'WORKSPACE' : ws === 'off' ? null : globalOn ? 'CLIENT' : null,
          globalOn ? 'CLIENT' : null, globalOn ? 'CLIENT' : null]
        const observed = []
        for (const { agent } of handles) {
          if (name === 'dsh-context') {
            const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
            observed.push(assembly.sections.find(s => s.name === 'dsh-context:prompt-prefix')?.text?.replace('CTX_', '') || null)
          } else if (name === 'dsh-temporary-messages') {
            const before = requests.length
            await send(agent)
            assert.ok(requests.length > before, 'The real Agent must reach the mock model adapter')
            const request = requests.findLast(r => r.sessionId === agent.id)
            const text = request.messages.at(-1)?.content.at(-1)?.text ?? ''
            observed.push(text.startsWith('TMP_') ? text.slice(4) : null)
          } else {
            const before = notifications.length
            await ctx.emit('agent/status', { agent, status: 'running' })
            await ctx.emit('agent/status', { agent, status: 'idle' })
            await sleep(30)
            const received = notifications.slice(before)
            assert.ok(received.length <= 1, 'Each status transition must notify at most once')
            observed.push(received[0]?.path.slice(1) ?? null)
          }
        }
        result.expected = expected; result.observed = observed
        assert.deepEqual(observed, expected)
        result.ok = true
      } catch (error) { result.ok = false; result.error = String(error?.stack ?? error).slice(0, 1500) }
      item.cases.push(result); save()
    }
    await manager.inherit(session, row.id); await manager.inherit(workspace, row.id)
    await manager.configure(client, row.id, false, {})
  }
  report.requestCount = requests.length
  report.notificationCount = notifications.length
  for (const h of handles) await h.dispose()
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
}
