// Run with ELECTRON_RUN_AS_NODE=1 using an unmodified desktop installation.
// Every profile, session and plugin data file stays under the supplied test home.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { pathToFileURL } = require('node:url')
const [app, homeArg, mode = 'list', packageName] = process.argv.slice(2)
const home = path.resolve(homeArg)
const repo = path.resolve(__dirname, '../..')
process.env.DSH_HOME = home
process.env.DSH_TELEMETRY_DISABLED = '1'
process.env.TEMP = process.env.TMP = path.join(home, 'tmp')
fs.mkdirSync(process.env.TEMP, { recursive: true })
const anchor = path.join(app, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/package.json')
const runtime = createRequire(anchor)
const dir = path.join(home, 'profiles/web')
const report = { mode, packageName, version: runtime('@deepseek-ai/dsh/package.json').version }
const save = () => fs.writeFileSync(path.join(home, `${mode}-report.json`), JSON.stringify(report, null, 2))
const output = process.stdout.write.bind(process.stdout)
process.stdout.write = function(chunk, ...args) {
  const url = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/)
  if (url) fs.writeFileSync(path.join(home, 'url.txt'), url[0])
  return output(chunk, ...args)
}
const stopTimer = setTimeout(() => { report.timeout = true; save(); process.exit(2) }, mode === 'serve' ? 600000 : 180000)
;(async () => {
  fs.mkdirSync(dir, { recursive: true })
  const withMenu = mode !== 'baseline'
  if (withMenu) for (const [name, folder] of [['dsh-tiered-plugin-core', 'core'], ['dsh-tiered-plugin-menu', 'web']]) {
    const dest = path.join(dir, 'node_modules', name)
    fs.mkdirSync(dest, { recursive: true })
    for (const file of ['package.json', 'cordis.patch.yml', 'dist']) fs.cpSync(path.join(repo, 'packages', folder, file), path.join(dest, file), { recursive: true })
  }
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'official-compat-test', private: true,
      dependencies: withMenu ? { 'dsh-tiered-plugin-core': '0.9.0', 'dsh-tiered-plugin-menu': '0.9.1' } : {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app',
        ...(withMenu ? ['dsh-tiered-plugin-core', 'dsh-tiered-plugin-menu'] : [packageName])] } } }))
    fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), JSON.stringify(withMenu ? [{ id: 'tiered-plugin-menu', config: { dataFile: path.join(home, 'menu.json') } }] : []))
  }
  if (mode.startsWith('config-')) {
    const fixture = path.join(dir, 'node_modules/config-fixture')
    fs.mkdirSync(fixture, { recursive: true })
    fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'config-fixture', version: '1.0.0', type: 'module', main: './index.js',
      dsh: { bundle: { patch: './cordis.patch.yml' }, tieredPluginMenu: { selfCompatible: true } } }))
    fs.writeFileSync(path.join(fixture, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'config-fixture', name: 'config-fixture', config: { count: 10 } }] }]))
    fs.writeFileSync(path.join(fixture, 'index.js'), `import z from '@deepseek-ai/schemastery'; export const Config = z.object({count:z.number().default(10)}); export function apply(ctx, config) {ctx.provide('fixtureConfig', config);}`)
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json')))
    manifest.dependencies['config-fixture'] = '1.0.0'
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest))
  }
  const { loadProfileDirectory, loadLayeredEnv } = runtime('@deepseek-ai/dsh-app-boot')
  const { runProfile } = await import(pathToFileURL(runtime.resolve('@deepseek-ai/dsh/profile-boot')))
  const { ctx } = await runProfile({ environment: loadLayeredEnv('dsh'), profile: 'web',
    resolvedProfile: { profile: loadProfileDirectory('dsh', dir, anchor), installAnchor: anchor },
    patchFiles: [], args: ['--no-open', '--port', '0'] })
  try {
    await ctx.loader.await()
    const bundles = await ctx.pluginManager.listBundles()
    report.bundles = bundles.filter(b => b.official).map(b => ({ name: b.name, availability: b.availability, installed: b.installed, enabled: b.enabled, listedByDefault: b.listedByDefault, error: b.error, title: b.meta?.title, rows: b.rows.map(r => ({ rowId: r.rowId, moduleName: r.moduleName })) }))
    save()
    if (withMenu) {
      const manager = ctx.tieredPlugins
      const configure = manager.configure.bind(manager)
      manager.configure = async (...args) => {
        try { return await configure(...args) } catch (error) {
          report.activationSnapshot = [...ctx.registry.values()].flatMap(r => [...r.fibers]).filter(f => f.ctx.fiber.entry?.parent.tree === manager.runtime).map(f => ({
            entry: f.ctx.fiber.entry.id, state: f.state, requires: Object.keys(f.inject),
            missing: Object.keys(f.inject).filter(name => f.ctx.get(name) === undefined), provides: [...f.provisions].map(p => p.name),
          }))
          save()
          throw error
        }
      }
      const client = { level: 'client', id: '' }
      const rows = await manager.rows(client)
      report.rows = rows.map(r => ({ id: r.id, package: r.package, official: r.official, enabled: r.enabled, config: r.config, components: r.components?.map(c => ({ id: c.id, config: c.config })) }))
      save()
      if (mode.startsWith('config-')) {
        const targets = [
          { package: '@deepseek-ai/dsh-experimental-cot-translation-bundle', component: 'translator', field: 'maxTextChars', service: 'translator' },
          { package: 'config-fixture', component: 'config-fixture', field: 'count', service: 'fixtureConfig' },
        ]
        const workspace = ctx.workspaceRegistry.list()[0] ?? await ctx.workspaceRegistry.create(home)
        const ws = { level: 'workspace', id: String(workspace.id) }
        const { SessionId } = runtime('@deepseek-ai/dsh-session')
        const session = { level: 'session', id: 'config-session' }
        if (mode === 'config-arm') {
          const handle = await ctx.agents.create({ sessionId: SessionId(session.id), meta: { cwd: home } })
          await workspace.attachSession(handle.agent.id)
        } else await ctx.agents.resume({ resumeSessionId: SessionId(session.id) })
        const row = async (scope, target) => (await manager.rows(scope)).flatMap(r => r.components ?? [r]).find(r => r.package === target.package && r.configNamespace === target.component)
        const change = async (scope, id, action) => {
          const plan = await manager.plan(scope, id, action)
          assert.deepEqual(plan.missing, [])
          await manager.change(scope, id, action, plan.signature)
        }
        report.configChecks = []
        for (const target of targets) for (const scope of [client, ws, session]) {
          const initial = await row(scope, target)
          if (mode === 'config-arm') {
            if (scope.level !== 'client') await change(scope, target.package, 'off')
          } else {
            assert.equal(initial.enabled, false, 'cold start preserves off')
            assert.equal(initial.config[target.field], 333, 'cold start preserves inactive config')
          }
          await manager.saveConfig(scope, initial.id, { ...initial.config, [target.field]: 111 })
          assert.equal((await row(scope, target)).enabled, false, 'saving must not enable')
          assert.equal((await row(scope, target)).config[target.field], 111)
          assert.equal((await row(scope, target)).active, false)
          await change(scope, target.package, 'on')
          const live = () => scope.level === 'client'
            ? [...ctx.loader.entries()].find(e => e.options.id === target.component).fiber.ctx.get(target.service)
            : manager.instance(scope, initial.id).plugin.ctx.get(target.service)
          assert.equal(live()[target.field], 111, 'enable applies saved config')
          await manager.saveConfig(scope, initial.id, { ...initial.config, [target.field]: 222 })
          assert.equal((await row(scope, target)).enabled, true, 'active save preserves on')
          assert.equal(live()[target.field], 222, 'active save applies immediately')
          await change(scope, target.package, 'off')
          await manager.saveConfig(scope, initial.id, { ...initial.config, [target.field]: 333 })
          assert.equal((await row(scope, target)).enabled, false, 'save from an old form cannot enable')
          report.configChecks.push({ package: target.package, scope, ok: true })
        }
      }
      if (mode === 'client') {
        const before = new Map([...ctx.loader.entries()].map(e => [e.id, !!e.disabled]))
        for (const action of ['on', 'off', 'on', 'off']) {
          const plan = await manager.plan(client, packageName, action)
          assert.deepEqual(plan.missing, [])
          await manager.change(client, packageName, action, plan.signature)
          const row = (await manager.rows(client)).find(r => r.package === packageName)
          assert.equal(row.enabled, action === 'on')
          if (action === 'on') assert.equal(row.active, true)
        }
        report.changedHostEntries = [...ctx.loader.entries()].filter(e => before.has(e.id) && before.get(e.id) !== !!e.disabled).map(e => e.id)
        assert.deepEqual(report.changedHostEntries, [])
      }
      if (mode === 'arm' || mode === 'check' || mode === 'unload') {
        if (mode === 'unload') {
          const plan = await manager.plan(client, packageName, 'off')
          await manager.change(client, packageName, 'off', plan.signature)
        }
        const { SessionId } = runtime('@deepseek-ai/dsh-session')
        const sessions = []
        for (const id of ['official-A', 'official-B', 'official-C']) {
          const cwd = path.join(home, id === 'official-C' ? 'workspace-b' : 'workspace-a')
          fs.mkdirSync(cwd, { recursive: true })
          if (!ctx.workspaceRegistry.list().some(w => w.path === cwd)) await ctx.workspaceRegistry.create(cwd)
          const handle = mode === 'arm' ? await ctx.agents.create({ sessionId: SessionId(id), meta: { cwd } }) : await ctx.agents.resume({ resumeSessionId: SessionId(id) })
          if (mode === 'arm') await ctx.workspaceRegistry.list().find(w => w.path === cwd).attachSession(handle.agent.id)
          sessions.push({ level: 'session', id })
        }
        const change = async (scope, target, action) => {
          const plan = await manager.plan(scope, target, action)
          report.lastPlan = plan.changes
          save()
          assert.deepEqual(plan.missing, [])
          await manager.change(scope, target, action, plan.signature)
        }
        if (mode === 'arm') {
          for (const scope of sessions.slice(0, 2)) await change(scope, packageName, 'on')
          // The same package stays disabled in the client and unrelated session.
          assert.equal((await manager.rows(client)).find(r => r.package === packageName).enabled, false)
          assert.equal((await manager.rows(sessions[2])).find(r => r.package === packageName).enabled, false)
          await change(sessions[0], packageName, 'off')
          assert.equal((await manager.rows(sessions[1])).find(r => r.package === packageName).active, true)
          await change(sessions[0], packageName, 'on')
          if (process.env.OFFICIAL_CONFIG_CASE) {
            const spec = JSON.parse(process.env.OFFICIAL_CONFIG_CASE)
            const row = (await manager.rows(sessions[0])).flatMap(r => r.components ?? [r]).find(r => r.configNamespace === spec.component)
            for (const [i, scope] of sessions.slice(0, 2).entries()) {
              await manager.configure(scope, row.id, true, { ...row.config, [spec.field]: spec.values[i] }, true)
              assert.equal(manager.instance(scope, row.id).plugin.ctx.get(spec.service)[spec.property], spec.values[i])
            }
            fs.writeFileSync(path.join(home, 'config-case.json'), JSON.stringify({ ...spec, id: row.id }))
            const workspace = ctx.workspaceRegistry.list().find(w => w.sessionIds.includes('official-A'))
            const ws = { level: 'workspace', id: String(workspace.id) }
            await change(ws, packageName, 'on')
            await change(sessions[0], packageName, 'inherit')
            assert.deepEqual((await manager.rows(sessions[0])).find(r => r.package === packageName).source, ws)
            await change(sessions[0], packageName, 'on')
            await manager.configure(sessions[0], row.id, true, { ...row.config, [spec.field]: spec.values[0] }, true)
            await change(ws, packageName, 'off')
          }
        }
        if (mode === 'check' && fs.existsSync(path.join(home, 'config-case.json'))) {
          const spec = JSON.parse(fs.readFileSync(path.join(home, 'config-case.json')))
          for (const [i, scope] of sessions.slice(0, 2).entries()) assert.equal(manager.instance(scope, spec.id).plugin.ctx.get(spec.service)[spec.property], spec.values[i])
          report.distinctConfigurationsRestored = true
        }
        report.scopes = []
        for (const scope of sessions) {
          const row = (await manager.rows(scope)).find(r => r.package === packageName)
          report.scopes.push({ scope, enabled: row.enabled, active: row.active, config: row.config, components: row.components?.map(c => ({ id: c.id, active: c.active })) })
          if (scope.id !== 'official-C') assert.equal(row.active, true)
          else assert.equal(row.enabled, false)
        }
        if (mode === 'unload') {
          await change(client, packageName, 'on')
          const title = ctx.sessionTitle.registration
          const nativePresets = ctx.permissionPresets[Symbol.for('cordis.original')]
          const admit = nativePresets.autoAdmit
          await ctx.pluginManager.setBundleEnabled('dsh-tiered-plugin-menu', false)
          assert.equal(ctx.tieredPlugins, undefined)
          assert.equal(ctx.sessionTitle.registration, title, 'menu unload keeps the client title provider')
          assert.equal(nativePresets.autoAdmit, admit, 'menu unload keeps the client permission provider')
          await ctx.pluginManager.setBundleEnabled('dsh-tiered-plugin-menu', true)
          assert.equal((await ctx.tieredPlugins.rows(sessions[0])).find(r => r.package === packageName).active, true)
          report.menuReloadRestored = true
        }
      }
    }
    report.failures = []
    for (const r of ctx.registry.values()) for (const fiber of r.fibers) if (fiber.state === 3) {
      try { await fiber.await() } catch (error) { report.failures.push(String(error?.stack ?? error)) }
    }
    report.entries = [...ctx.loader.entries()].filter(e => /experimental|tiered|translation|title-all|speech/.test(e.options.name)).map(e => ({ id: e.id, name: e.options.name, disabled: e.disabled, state: e.fiber?.state }))
    report.ok = report.failures.length === 0
    save()
    if (mode === 'serve') {
      fs.writeFileSync(path.join(home, 'ready'), 'ready')
      await new Promise(resolve => { const timer = setInterval(() => { if (fs.existsSync(path.join(home, 'stop'))) { clearInterval(timer); resolve() } }, 300) })
    }
  } catch (error) {
    report.waiting = []
    for (const r of ctx.registry.values()) for (const f of r.fibers) {
      if (f.state !== 2 && f.ctx.fiber.entry) report.waiting.push({ entry: f.ctx.fiber.entry.id, state: f.state,
        requires: Object.keys(f.inject), missing: Object.keys(f.inject).filter(name => f.ctx.get(name) === undefined), provides: [...f.provisions].map(p => p.name) })
    }
    throw error
  } finally { await ctx.fiber.dispose() }
  clearTimeout(stopTimer)
  process.exit(report.ok ? 0 : 1)
})().catch(error => { report.error = String(error?.stack ?? error); save(); console.error(report.error); process.exit(1) })
