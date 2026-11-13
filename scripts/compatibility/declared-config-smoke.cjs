// Run in a disposable DSH_HOME with the published Web/core tarballs extracted
// into profiles/web/node_modules. Use "arm", quit, then "check" to test cold boot.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { pathToFileURL } = require('node:url')

const [anchor, home, phase = 'check'] = process.argv.slice(2)
assert.ok(anchor && home, 'Pass the DSH package.json path and a disposable DSH_HOME')
const installAnchor = path.resolve(anchor)
const root = path.resolve(home)
const directory = path.join(root, 'profiles/web')
const runtime = createRequire(installAnchor)
process.env.DSH_HOME = root
process.env.DSH_TELEMETRY_DISABLED = '1'
const { initProfile, loadProfileDirectory, loadLayeredEnv } = runtime('@deepseek-ai/dsh-app-boot')
const fixture = 'tiered-required-config-fixture'
const manifestFile = path.join(directory, 'package.json')
if (!fs.existsSync(manifestFile)) {
  initProfile(directory, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-tiered-plugin-menu'])
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  manifest.dependencies = Object.fromEntries(['dsh-tiered-plugin-core', 'dsh-tiered-plugin-menu'].map(name =>
    [name, JSON.parse(fs.readFileSync(path.join(directory, 'node_modules', name, 'package.json'), 'utf8')).version]))
  manifest.dependencies[fixture] = '1.0.0'
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2))
  fs.writeFileSync(path.join(directory, 'cordis.patch.yml'), '- id: tiered-plugin-menu\n  config:\n    dataFile: ' + JSON.stringify(path.join(root, 'menu.json')) + '\n')
  const fixtureDir = path.join(directory, 'node_modules', fixture)
  fs.mkdirSync(fixtureDir, { recursive: true })
  fs.writeFileSync(path.join(fixtureDir, 'package.json'), JSON.stringify({ name: fixture, version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  fs.writeFileSync(path.join(fixtureDir, 'cordis.patch.yml'), '- insert:\n    - id: issue-preset\n      name: "@deepseek-ai/dsh-agent-preset"\n      config:\n        id: issue-preset\n        plugins: []\n')
}

;(async () => {
  const { runProfile } = await import(pathToFileURL(runtime.resolve('@deepseek-ai/dsh/profile-boot')))
  const { ctx } = await runProfile({ environment: loadLayeredEnv('dsh'), profile: 'web',
    resolvedProfile: { profile: loadProfileDirectory('dsh', directory, installAnchor), installAnchor },
    patchFiles: [], args: ['--no-open', '--port', '0'] })
  const report = { runtime: runtime(installAnchor).version, phase, core: JSON.parse(fs.readFileSync(path.join(directory, 'node_modules/dsh-tiered-plugin-core/package.json'), 'utf8')).version }
  try {
    await ctx.loader.await()
    const menu = ctx.get('tieredPlugins')
    assert.ok(menu, 'core activates from the unchanged Web adapter')
    assert.ok(ctx.clientModules.graph().entries.some(entry => entry.id === 'dsh-tiered-plugin-menu'))
    if (phase === 'check') {
      const workspacePath = path.join(root, 'workspace')
      fs.mkdirSync(workspacePath, { recursive: true })
      const workspace = await ctx.workspaceRegistry.create(workspacePath)
      const { SessionId } = runtime('@deepseek-ai/dsh-session')
      const { agent } = await ctx.agents.create({ sessionId: SessionId(`declared-config-${Date.now()}`),
        meta: { cwd: workspacePath }, setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx) } })
      const sessionScope = { level: 'session', id: String(agent.id) }
      const scopes = [{ level: 'client', id: '' }, { level: 'workspace', id: String(workspace.id) }, sessionScope]
      for (const scope of scopes) for (const children of [false, true]) {
        const row = (await menu.rows({ ...scope, children })).find(row => row.id === 'issue-preset')
        assert.ok(row)
        assert.equal(row.config.id, 'issue-preset')
        assert.deepEqual(row.config.plugins, [])
        assert.equal(row.enabled, false)
      }
      assert.equal([...ctx.loader.entries()].some(entry => entry.options.id === 'issue-preset'), false, 'listing does not activate the fixture')
      await menu.configure(sessionScope, 'issue-preset', true, { id: 'session-preset', plugins: [] }, true)
      assert.equal(menu.instance(sessionScope, 'issue-preset').plugin.state, 2)
      assert.equal((await menu.rows(sessionScope)).find(row => row.id === 'issue-preset').config.id, 'session-preset')
      await menu.inherit(sessionScope, 'issue-preset')
      assert.equal(menu.instance(sessionScope, 'issue-preset'), undefined)
      assert.equal((await menu.rows(sessionScope)).find(row => row.id === 'issue-preset').config.id, 'issue-preset')
      report.scopes = 3
      report.children = true
      report.sessionEnableAndInherit = true
    }
    fs.writeFileSync(path.join(root, `result-${phase}.json`), JSON.stringify(report, null, 2))
    console.log('DECLARED_CONFIG_SMOKE', JSON.stringify(report))
  } finally { await ctx.fiber.dispose() }
  process.exit(0)
})().catch(error => { console.error(error); process.exit(1) })
