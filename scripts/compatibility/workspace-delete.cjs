// Audit workspace deletion in an unmodified DSH process, then run cold on the same test home.
// No model requests; a fixture tool reports which plugin instance serves each session.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { pathToFileURL } = require('node:url')
const [app, homeArg, mode = 'arm'] = process.argv.slice(2)
const home = path.resolve(homeArg)
const repo = path.resolve(__dirname, '../..')
process.env.DSH_HOME = home
process.env.DSH_TELEMETRY_DISABLED = '1'
process.env.TEMP = process.env.TMP = path.join(home, 'tmp')
fs.mkdirSync(process.env.TEMP, { recursive: true })
const anchor = path.join(app, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/package.json')
const runtime = createRequire(anchor)
const dir = path.join(home, 'profiles/web')
const plugin = 'workspace-probe'
const report = { mode, version: runtime('@deepseek-ai/dsh/package.json').version, snapshots: [] }
const save = () => fs.writeFileSync(path.join(home, `${mode}-report.json`), JSON.stringify(report, null, 2))
const output = process.stdout.write.bind(process.stdout)
process.stdout.write = function(chunk, ...args) {
  const url = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/)
  if (url) { fs.writeFileSync(path.join(home, 'url.txt'), url[0]); return true }
  return output(chunk, ...args)
}
const timeout = setTimeout(() => { report.timeout = true; save(); process.exit(2) }, 120000)
;(async () => {
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, folder] of [['dsh-tiered-plugin-core', 'core'], ['dsh-tiered-plugin-menu', 'web']]) {
    const dest = path.join(dir, 'node_modules', name)
    fs.mkdirSync(dest, { recursive: true })
    for (const file of ['package.json', 'cordis.patch.yml', 'dist']) fs.cpSync(path.join(repo, 'packages', folder, file), path.join(dest, file), { recursive: true })
  }
  const fixture = path.join(dir, 'node_modules', plugin)
  fs.mkdirSync(fixture, { recursive: true })
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: plugin, version: '1.0.0', type: 'module', main: './index.js',
    dsh: { bundle: { patch: './cordis.patch.yml' }, tieredPluginMenu: { Compatible: true } } }))
  fs.writeFileSync(path.join(fixture, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: plugin, name: plugin, config: { label: 'CLIENT' } }] }]))
  fs.writeFileSync(path.join(fixture, 'index.js'), `export const inject = ['tools']; export function apply(ctx, config) {
    ctx.tools.register({name:'workspace_probe',description:config.label,parameters:{type:'object',properties:{}},
      output:{schema:{type:'string'},render:(_,v)=>[{type:'text',text:v}]},execute:async()=>config.label});
  }`)
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'workspace-delete-audit', private: true,
      dependencies: Object.fromEntries(['dsh-tiered-plugin-core', 'dsh-tiered-plugin-menu', plugin].map(name => [name, '1.0.0'])),
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', plugin, 'dsh-tiered-plugin-core', 'dsh-tiered-plugin-menu'] } } }))
    fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), JSON.stringify([{ id: 'tiered-plugin-menu', config: { dataFile: path.join(home, 'menu.json') } }]))
  }
  const { loadProfileDirectory, loadLayeredEnv } = runtime('@deepseek-ai/dsh-app-boot')
  const { runProfile } = await import(pathToFileURL(runtime.resolve('@deepseek-ai/dsh/profile-boot')))
  const { ctx } = await runProfile({ environment: loadLayeredEnv('dsh'), profile: 'web',
    resolvedProfile: { profile: loadProfileDirectory('dsh', dir, anchor), installAnchor: anchor }, patchFiles: [], args: ['--no-open', '--port', '0'] })
  try {
    await ctx.loader.await()
    const manager = ctx.tieredPlugins
    const ws = id => ({ level: 'workspace', id })
    const ss = id => ({ level: 'session', id })
    const idsFile = path.join(home, 'ids.json')
    const ids = mode === 'arm' ? { workspaces: {}, sessions: {} } : JSON.parse(fs.readFileSync(idsFile, 'utf8'))
    const configure = (scope, label, enabled = true) => manager.configure(scope, plugin, enabled, { label }, true)
    const change = async (scope, state) => {
      const plan = await manager.plan(scope, plugin, state)
      await manager.change(scope, plugin, state, plan.signature)
    }
    const snapshot = async name => {
      const state = { name, workspaces: ctx.workspaceRegistry.list().map(w => ({ id: w.id, title: w.title, sessions: w.sessionIds })), sessions: {}, deletedScopes: {} }
      for (const [name, id] of Object.entries(ids.sessions)) {
        const row = (await manager.rows(ss(id))).find(row => row.id === plugin)
        const agent = ctx.agents.get(id)
        const resolved = agent && await ctx.tools.resolve({ agent, modelSelection: { provider: 'test', model: 'test' }, signal: new AbortController().signal })
        const tool = resolved?.view(agent).get('workspace_probe')
        state.sessions[name] = { workspace: manager.context(id).workspaceId, source: row.source,
          own: row.own, enabled: row.enabled, active: row.active, label: row.config.label,
          tool: tool ? await tool.execute({}, { agent }) : null, cwd: agent?.session.header.cwd }
        resolved?.dispose()
      }
      for (const name of ['child', 'orphan']) {
        const scope = ws(ids.workspaces[name])
        state.deletedScopes[name] = { exists: !!ctx.workspaceRegistry.get(scope.id),
          instance: !!manager.instance(scope, plugin), saved: manager.store.get(scope, plugin) }
      }
      report.snapshots.push(state); save()
      return state
    }
    const expectTools = (state, expected) => {
      assert.deepEqual(Object.fromEntries(Object.entries(state.sessions).map(([name, row]) => [name, row.tool])), expected)
    }
    const after = (inherited, leaf = 'ROOT EDITED') => ({ inherited, explicit: 'SESSION', leaf, ungrouped: 'CLIENT', defaultCopy: 'COPIED DEFAULT' })
    if (mode === 'arm') {
      const workspace = async (name, relative) => {
        const cwd = path.join(home, relative); fs.mkdirSync(cwd, { recursive: true })
        const workspace = await ctx.workspaceRegistry.create(cwd, name)
        ids.workspaces[name] = workspace.id
        return workspace
      }
      const root = await workspace('root', 'root')
      const child = await workspace('child', 'root/child')
      const leaf = await workspace('leaf', 'root/child/leaf')
      const orphan = await workspace('orphan', 'orphan')
      await configure(ws(root.id), 'ROOT'); await configure(ws(child.id), 'CHILD'); await configure(ws(orphan.id), 'ORPHAN')
      const create = async (name, workspace) => {
        const id = `workspace-audit-${name}`; ids.sessions[name] = id
        const handle = await ctx.agents.create({ sessionId: id, meta: { cwd: workspace.path, title: name } })
        await workspace.attachSession(handle.agent.id)
      }
      await create('inherited', child); await create('explicit', child); await create('leaf', leaf); await create('ungrouped', orphan)
      await configure(ss(ids.sessions.explicit), 'SESSION')
      await configure({ ...ws(child.id), children: true }, 'COPIED DEFAULT')
      await create('defaultCopy', child)
      manager.resetChildSettings(ws(child.id))
      fs.writeFileSync(idsFile, JSON.stringify(ids, null, 2))
      await snapshot('before-delete')
      await ctx.workspaceRegistry.delete(child.id); await ctx.workspaceRegistry.delete(orphan.id)
      expectTools(await snapshot('after-delete'), after('ROOT', 'ROOT'))
      await change(ws(root.id), 'off'); expectTools(await snapshot('parent-off'), after(null, null))
      await change(ws(root.id), 'on'); await configure(ws(root.id), 'ROOT EDITED'); expectTools(await snapshot('parent-on-edited'), after('ROOT EDITED'))
      await change(ss(ids.sessions.inherited), 'off'); expectTools(await snapshot('session-off'), after(null))
      await change(ss(ids.sessions.inherited), 'on'); await configure(ss(ids.sessions.inherited), 'SESSION EDITED'); expectTools(await snapshot('session-on-edited'), after('SESSION EDITED'))
      await change(ss(ids.sessions.inherited), 'inherit'); expectTools(await snapshot('session-inherit'), after('ROOT EDITED'))
      await assert.rejects(configure(ws(child.id), 'STALE WORKSPACE EDIT'), /工作区已删除/)
      const stale = await snapshot('stale-workspace-dialog-rejected')
      expectTools(stale, after('ROOT EDITED'))
      for (const scope of [ws(child.id), ws(orphan.id)]) {
        assert.deepEqual(manager.store.keys(scope), [])
        assert.deepEqual(manager.store.keys({ ...scope, children: true }), [])
        assert.equal(manager.store.parent(scope), undefined)
        assert.equal(manager.instance(scope, plugin), undefined)
      }
      if (process.env.AUDIT_SERVE === '1') await new Promise(resolve => {
        const poll = setInterval(() => { if (fs.existsSync(path.join(home, 'stop'))) { clearInterval(poll); resolve() } }, 200)
      })
    } else {
      report.workspacesBeforeResume = ctx.workspaceRegistry.list().map(w => ({ id: w.id, title: w.title }))
      for (const id of Object.values(ids.sessions)) await ctx.agents.resume({ resumeSessionId: id })
      const cold = await snapshot('cold-resumed')
      expectTools(cold, after('ROOT EDITED'))
      for (const name of ['child', 'orphan']) {
        assert.equal(cold.deletedScopes[name].saved, undefined)
        assert.equal(cold.deletedScopes[name].instance, false)
      }
      await change(ws(ids.workspaces.root), 'off'); expectTools(await snapshot('cold-parent-off'), after(null, null))
      await change(ws(ids.workspaces.root), 'on')
    }
    console.log(JSON.stringify(report.snapshots.map(s => ({ name: s.name, tools: Object.fromEntries(Object.entries(s.sessions).map(([name, row]) => [name, row.tool])) }))))
  } finally { await ctx.fiber.dispose() }
})().catch(error => { report.error = String(error.stack ?? error); console.error(error); process.exitCode = 1 }).finally(() => { save(); clearTimeout(timeout) })
