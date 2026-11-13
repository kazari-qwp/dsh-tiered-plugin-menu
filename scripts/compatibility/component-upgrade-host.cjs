// Called by component-upgrade.mjs in a fresh Electron/DSH process for each phase.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { pathToFileURL } = require('node:url')
const [configFile, phase] = process.argv.slice(2)
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
const runtime = createRequire(config.anchor)
const directory = path.join(config.home, 'profiles/web')
process.env.DSH_HOME = config.home
process.env.DSH_TELEMETRY_DISABLED = '1'
const webName = 'dsh-tiered-plugin-menu', coreName = 'dsh-tiered-plugin-core'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
;(async () => {
  const { loadProfileDirectory, loadLayeredEnv } = runtime('@deepseek-ai/dsh-app-boot')
  const { runProfile } = await import(pathToFileURL(runtime.resolve('@deepseek-ai/dsh/profile-boot')))
  const { ctx } = await runProfile({ environment: loadLayeredEnv('dsh'), profile: 'web',
    resolvedProfile: { profile: loadProfileDirectory('dsh', directory, config.anchor), installAnchor: config.anchor },
    packageManager: config.packageManager, patchFiles: [], args: ['--no-open', '--port', '0'] })
  const report = { phase, hmr: !!ctx.get('hmr') }
  let coreInstall
  try {
    await ctx.loader.await()
    const api = ctx.pluginManager
    const install = api.installBundle
    api.installBundle = async function(...args) {
      const result = await install.apply(this, args)
      if (String(args[0]).startsWith(coreName)) {
        coreInstall = result
        fs.writeFileSync(path.join(config.home, `auto-core-${phase}.json`), JSON.stringify(result, null, 2))
      }
      return result
    }
    const bundles = () => api.listBundles()
    const web = async () => (await bundles()).find(b => b.name === webName)
    if (phase === 'seed') {
      assert.equal((await web()).version, '0.7.1')
      assert.equal((await web()).rows.length, 1)
      await ctx.tieredPlugins.setWorkspaceTreeInheritance(false)
      await ctx.tieredPlugins.setChildSettings({ level: 'client', id: '' }, true)
    } else if (phase === 'interfaces') {
      for (const name of ['dsh-tiered-plugin-tui', 'dsh-tiered-plugin-go']) {
        const result = await api.installBundle(`${name}@${config.interfaceVersion}`, { enabled: true, registry: config.registry })
        assert.notEqual(result.application, 'failed', JSON.stringify(result))
      }
      await ctx.loader.await()
    } else if (phase === 'upgrade' || phase === 'core-update') {
      const name = phase === 'upgrade' ? webName : coreName
      const target = phase === 'upgrade' ? config.webVersion : config.futureCoreVersion
      if (phase === 'upgrade') assert.equal((await web()).version, '0.7.1')
      const versions = await api.listVersions(name, { registry: config.registry })
      report.versions = versions
      const result = await api.updateBundle(name, target, { registry: config.registry })
      report.update = result
      fs.writeFileSync(path.join(config.home, `result-${phase}.json`), JSON.stringify(report, null, 2))
      assert.notEqual(result.result.application, 'failed', JSON.stringify(result))
      assert.notEqual(result.result.application, 'cancelled')
      if (phase === 'upgrade') {
        const until = Date.now() + 45000
        while (Date.now() < until && !coreInstall) await sleep(100)
        assert.ok(coreInstall, 'automatic core registration completed')
        assert.notEqual(coreInstall.application, 'failed', JSON.stringify(coreInstall))
        report.coreInstall = coreInstall
      }
      await ctx.loader.await()
    }
    if (phase !== 'seed') {
      const installed = await bundles()
      const core = installed.find(b => b.name === coreName)
      report.packages = installed.filter(b => b.name === webName || b.name === coreName)
      fs.writeFileSync(path.join(config.home, `result-${phase}.json`), JSON.stringify(report, null, 2))
      assert.equal((await web()).version, config.webVersion)
      assert.equal((await web()).rows.length, 2)
      assert.equal(core?.installed, true, 'core is a direct profile dependency visible to the native updater')
      assert.equal((await api.listVersions(coreName, { registry: config.registry })).status, 'listed', 'native core update check is available')
      assert.equal(core.version, phase === 'core-update' || phase === 'final' ? config.futureCoreVersion : config.coreVersion)
      const restartRequired = report.update?.result.application === 'restart-required' || coreInstall?.application === 'restart-required'
      if (restartRequired) {
        report.restartRequired = true
        fs.writeFileSync(path.join(config.home, `result-${phase}.json`), JSON.stringify(report, null, 2))
        console.log('UPGRADE_PHASE', phase, 'PASS (restart required by Harness)')
        return
      }
      assert.equal([...ctx.loader.entries()].filter(e => e.options.name === coreName + '/host').length, 1)
      assert.equal(ctx.tieredPlugins.settings().inheritWorkspaceTree, false, 'custom dataFile preserved')
      assert.equal(ctx.tieredPlugins.childSettings({ level: 'client', id: '' }).independent, true)
      for (const name of [coreName + '/host', webName]) {
        const entry = [...ctx.loader.entries()].find(e => e.options.name === name)
        assert.equal(entry?.fiber?.state, 2, name + ' activates')
      }
      report.configPreserved = true
      if (phase === 'final') {
        const manager = ctx.tieredPlugins
        assert.equal([...ctx.loader.entries()].filter(e => e.options.name === coreName + '/component').length, 3)
        for (const name of [webName, 'dsh-tiered-plugin-tui']) {
          assert.equal((await api.setBundleEnabled(name, false)).application, 'applied')
          assert.equal(ctx.tieredPlugins, manager, 'another interface keeps the same manager alive')
        }
        assert.equal((await api.setBundleEnabled('dsh-tiered-plugin-go', false)).application, 'applied')
        assert.equal(ctx.get('tieredPlugins'), undefined, 'last interface releases its instances')
        assert.equal((await api.setBundleEnabled(webName, true)).application, 'applied')
        assert.equal(ctx.tieredPlugins.settings().inheritWorkspaceTree, false)
        report.sharedLifecycle = true
      }
    }
    fs.writeFileSync(path.join(config.home, `result-${phase}.json`), JSON.stringify(report, null, 2))
    console.log('UPGRADE_PHASE', phase, 'PASS')
  } finally { await ctx.fiber.dispose() }
})().then(() => process.exit(0), error => { console.error(error); process.exit(1) })
