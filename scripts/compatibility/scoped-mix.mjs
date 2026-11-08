import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const local = createRequire(path.join(process.cwd(), 'package.json'))
const { LlmAdapter, createUserMessage } = local('@deepseek-ai/dsh-llm')
const { assembleContextFor } = local('@deepseek-ai/dsh-agent')

function configFor(name, marker) {
  if (name === 'dsh-temporary-messages') return { template: `TEMP_${marker}`, defaultTtlTokens: 0 }
  if (name === 'dsh-context') return { promptPrefix: `CONTEXT_${marker}`, maxRequestSteps: marker === 'A' ? 2 : 5 }
  if (name === 'dsh-tacit') return { autoAnalyze: false, maxKeptTurns: marker === 'A' ? 7 : 11 }
  if (name === 'dsh-notification') return { desktop: false, browser: false, minTurnDurationMs: 0, title: `NOTIFY_${marker}` }
  if (name === '@deepcodec/dsh-clock') return { mode: marker === 'A' ? 'date' : 'time', showSeconds: marker !== 'A' }
  if (name === '@cerbur/clutch-dsh-title') return { template: `TITLE_${marker}`, fields: {}, preset: 'default' }
  return {}
}

export async function scopedMix(ctx, report, names, home, save) {
  report.scoped = []
  const requests = []
  ctx.llm.registerAdapter(['compat-test'], new class extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream(request) {
      requests.push(request)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'test answer' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'test answer' } }
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }())
  const workspaces = []
  for (const name of ['one', 'two']) {
    const cwd = path.join(home, name)
    fs.mkdirSync(cwd)
    workspaces.push(await ctx.workspaceRegistry.create(cwd))
  }
  const handles = []
  for (const [name, index] of [['A', 0], ['B', 0], ['C', 1], ['D', 1]]) {
    const handle = await ctx.agents.create({ sessionId: `compat-${name}`, meta: { cwd: workspaces[index].path },
      agentOptions: { provider: 'compat-test', model: 'test' } })
    await workspaces[index].attachSession(handle.agent.id)
    handles.push(handle)
  }
  const manager = ctx.tieredPlugins
  const client = { level: 'client', id: '' }
  const w1 = { level: 'workspace', id: String(workspaces[0].id) }
  const w2 = { level: 'workspace', id: String(workspaces[1].id) }
  const sa = { level: 'session', id: 'compat-A' }
  const sb = { level: 'session', id: 'compat-B' }
  const scopes = [w1, w2, sa, sb]
  for (const name of names.filter(name => name !== 'dsh-tiered-plugin-menu')) {
    const row = (await manager.rows(client)).find(row => row.package === name)
    if (!row) { report.scoped.push({ name, error: 'not discovered' }); continue }
    const result = { name, cases: [] }
    report.scoped.push(result)
    const id = row.id
    const entry = [...ctx.loader.entries()].find(entry => entry.options.name === name)
    const originalConfig = entry?.options.config
    const act = async (label, action) => {
      const record = { label }
      try { await action(); await ctx.loader.await(); record.ok = true }
      catch (error) { record.ok = false; record.error = String(error?.stack ?? error).slice(0, 1800) }
      result.cases.push(record)
      save()
      return record
    }
    await act('client-off', () => manager.configure(client, id, false, {}))
    const single = await act('workspace-one-on/global-off', () => manager.configure(w1, id, true, configFor(name, 'A'), true))
    if (single.ok) {
      await act('inspect-outside-scope', async () => {
        result.clientModules = ctx.clientModules.graph().entries.map(entry => entry.id)
        result.instances = [...manager.instances].map(([scope, entries]) => ({ scope, plugins: [...entries.keys()] }))
        result.rows = await Promise.all(handles.map(async ({ agent }) => {
          const selected = (await manager.rows({ level: 'session', id: agent.id })).find(row => row.id === id)
          const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
          return { session: agent.id, source: selected.source, enabled: selected.enabled, active: selected.active,
            tools: ctx.tools.definitions(agent).map(tool => tool.name),
            prompt: assembly.sections.filter(section => /memory|tacit|context|custom/i.test(section.name)).map(section => ({ name: section.name, text: section.text.slice(0, 150) })) }
        }))
      })
    }
    await act('workspace-two-on', () => manager.configure(w2, id, true, configFor(name, 'B'), true))
    await act('session-A-on', () => manager.configure(sa, id, true, configFor(name, 'A'), true))
    await act('session-B-on', () => manager.configure(sb, id, true, configFor(name, 'B'), true))
    await act('session-A-off', () => manager.configure(sa, id, false, {}))
    await act('session-A-inherit', () => manager.inherit(sa, id))
    await act('client-on-with-lower', () => manager.configure(client, id, true, configFor(name, 'CLIENT')))
    await act('workspace-one-off', () => manager.configure(w1, id, false, {}))
    await act('session-A-on/parent-off', () => manager.configure(sa, id, true, configFor(name, 'A'), true))
    await act('cleanup-lower', async () => { for (const scope of scopes) await manager.inherit(scope, id) })
    await act('restore-global', async () => {
      await manager.configure(client, id, true, originalConfig ?? {})
      if (entry) await entry.update({ config: originalConfig ?? {} })
    })
    result.finalState = [...ctx.loader.entries()].find(entry => entry.options.name === name)?.fiber?.state
    save()
  }
  report.agentCount = handles.length
  for (const handle of handles) await handle.dispose()
}
