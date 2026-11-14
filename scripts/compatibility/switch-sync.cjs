// Use an unmodified desktop runtime with an isolated DSH_HOME. Run arm, then cold.
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
const checks = []
const output = process.stdout.write.bind(process.stdout)
process.stdout.write = function(chunk, ...args) {
  const url = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/)
  if (url) { fs.writeFileSync(path.join(home, 'url.txt'), url[0]); return true }
  return output(chunk, ...args)
}
const check = (name, actual, expected) => {
  checks.push({ name, actual, expected, pass: JSON.stringify(actual) === JSON.stringify(expected) })
}
const timeout = setTimeout(() => process.exit(2), 120000)
;(async () => {
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, folder] of [['dsh-tiered-plugin-core', 'core'], ['dsh-tiered-plugin-menu', 'web']]) {
    const dest = path.join(dir, 'node_modules', name)
    fs.mkdirSync(dest, { recursive: true })
    for (const file of ['package.json', 'cordis.patch.yml', 'dist']) fs.cpSync(path.join(repo, 'packages', folder, file), path.join(dest, file), { recursive: true })
  }
  const fixtures = {
    'switch-provider': [{ id: 'switch-provider', code: "export function apply(ctx) {ctx.provide('switchProbe', {});} export const provide = ['switchProbe'];" }],
    'switch-consumer': [{ id: 'switch-consumer', code: "export const inject = ['switchProbe']; export function apply() {}" }],
    'switch-multi': ['first', 'second'].map(id => ({ id, code: 'export function apply() {}' })),
  }
  for (const [name, components] of Object.entries(fixtures)) {
    const dest = path.join(dir, 'node_modules', name)
    fs.mkdirSync(dest, { recursive: true })
    fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module',
      exports: Object.fromEntries(components.map(c => [components.length === 1 ? '.' : `./${c.id}`, `./${c.id}.js`])),
      dsh: { bundle: { patch: './cordis.patch.yml' }, tieredPluginMenu: { Compatible: true } } }))
    fs.writeFileSync(path.join(dest, 'cordis.patch.yml'), JSON.stringify([{ insert: components.map(c => ({ id: c.id, name: components.length === 1 ? name : `${name}/${c.id}` })) }]))
    for (const c of components) fs.writeFileSync(path.join(dest, `${c.id}.js`), c.code)
  }
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'switch-sync-test', private: true,
      dependencies: Object.fromEntries(['dsh-tiered-plugin-core', 'dsh-tiered-plugin-menu', ...Object.keys(fixtures)].map(name => [name, '1.0.0'])),
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-tiered-plugin-core', 'dsh-tiered-plugin-menu'] } } }))
    fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), JSON.stringify([{ id: 'tiered-plugin-menu', config: { dataFile: path.join(home, 'menu.json') } }]))
  }
  const { loadProfileDirectory, loadLayeredEnv } = runtime('@deepseek-ai/dsh-app-boot')
  const { runProfile } = await import(pathToFileURL(runtime.resolve('@deepseek-ai/dsh/profile-boot')))
  const { ctx } = await runProfile({ environment: loadLayeredEnv('dsh'), profile: 'web',
    resolvedProfile: { profile: loadProfileDirectory('dsh', dir, anchor), installAnchor: anchor }, patchFiles: [], args: ['--no-open', '--port', '0'] })
  try {
    await ctx.loader.await()
    const menu = ctx.tieredPlugins
    const client = { level: 'client', id: '' }
    const row = async name => (await menu.rows(client)).find(row => row.package === name)
    const native = async name => (await ctx.pluginManager.listBundles()).find(row => row.name === name).enabled
    const change = async (name, mode) => {
      const plan = await menu.plan(client, name, mode)
      assert.deepEqual(plan.missing, [])
      await menu.change(client, name, mode, plan.signature)
    }
    if (mode === 'arm') {
      await change('switch-consumer', 'on')
      check('dependency enable native', await native('switch-provider'), true)
      await change('switch-provider', 'off')
      for (const name of ['switch-provider', 'switch-consumer']) {
        check(`${name} menu off`, (await row(name)).enabled, false)
        check(`${name} native off`, await native(name), false)
      }
      for (const name of ['switch-provider', 'switch-consumer']) {
        const result = await ctx.pluginManager.setBundleEnabled(name, true)
        check(`${name} native re-enable has no stale disabled override`, result.error?.code ?? null, null)
        check(`${name} native re-enable runs`, (await row(name)).active, true)
      }
      await change('switch-provider', 'off')
      await ctx.pluginManager.setBundleEnabled('switch-multi', true)
      const entry = [...ctx.loader.entries()].find(e => e.options.id === 'first')
      await ctx.pluginManager.setPluginEnabled(entry.id, false)
    }
    const multiple = await row('switch-multi')
    check('bundle selection matches native', multiple.bundleEnabled, await native('switch-multi'))
    check('component override retained', multiple.components.map(c => c.enabled), [false, true])
    for (const name of ['switch-provider', 'switch-consumer']) check(`${mode} native/menu agreement ${name}`, (await row(name)).enabled, await native(name))
    if (mode === 'serve') await new Promise(resolve => {
      const timer = setInterval(() => { if (fs.existsSync(path.join(home, 'stop'))) { clearInterval(timer); resolve() } }, 200)
    })
  } finally {
    await ctx.fiber.dispose()
    clearTimeout(timeout)
    fs.writeFileSync(path.join(home, `${mode}-report.json`), JSON.stringify({ version: runtime('@deepseek-ai/dsh/package.json').version, checks }, null, 2))
    console.log(JSON.stringify(checks))
  }
  assert.ok(checks.every(c => c.pass), 'switch state checks failed')
})().catch(error => { console.error(error); process.exitCode = 1; clearTimeout(timeout) })
