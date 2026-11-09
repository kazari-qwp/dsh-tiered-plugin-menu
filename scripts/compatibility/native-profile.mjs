import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
fs.mkdirSync(path.join(root, 'work'), { recursive: true })
const local = createRequire(path.join(root, 'package.json'))
const installAnchor = local.resolve('@deepseek-ai/dsh/package.json')
const runtime = createRequire(installAnchor)
const scoped = process.argv.includes('--scoped')
const controls = process.argv.includes('--controls')
const functional = process.argv.includes('--functional')
const names = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
const home = fs.mkdtempSync(path.join(root, 'work/native-mix-'))
if (process.argv.includes('--plugin-isolation')) fs.writeFileSync(path.join(home, 'menu.json'), JSON.stringify({
  version: 2, configs: {}, children: {}, parents: {}, settings: { inheritWorkspaceTree: true, pluginIsolation: true },
}))
const dir = path.join(home, 'profiles', 'test')
fs.mkdirSync(dir, { recursive: true })
const extra = names.filter(name => name !== 'dsh-tiered-plugin-menu')
const withMenu = names.includes('dsh-tiered-plugin-menu')
fs.mkdirSync(path.join(dir, 'node_modules'))
for (const name of extra) {
  const target = path.join(dir, 'node_modules', name)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.symlinkSync(path.join(root, 'node_modules', name), target, 'dir')
}
if (withMenu) {
  const entry = path.resolve(process.env.COMPAT_MENU_ENTRY ?? path.join(root, 'dist/index.js'))
  const source = path.dirname(path.dirname(entry))
  const installed = path.join(dir, 'node_modules/dsh-tiered-plugin-menu')
  fs.mkdirSync(installed)
  for (const file of ['package.json', 'cordis.patch.yml', 'dist']) {
    fs.cpSync(path.join(source, file), path.join(installed, file), { recursive: true })
  }
}
const fromPackage = (moduleName, packageName) => moduleName === packageName || moduleName.startsWith(packageName + '/')
const fromSample = moduleName => extra.some(name => fromPackage(moduleName, name))
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'compat-test', private: true,
  dependencies: Object.fromEntries(names.map(name => [name, '*'])),
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...(withMenu ? ['dsh-tiered-plugin-menu'] : []), ...extra] } },
}))
fs.writeFileSync(path.join(dir, 'cordis.yml'), '[]\n')
const startupPatches = withMenu ? [{
  id: 'tiered-plugin-menu',
  config: { dataFile: path.join(home, 'menu.json') },
}] : []
fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), JSON.stringify(startupPatches))
process.env.DSH_HOME = home
process.env.DSH_TELEMETRY_DISABLED = '1'
const report = { names, home }
const lastReport = path.join(root, 'work', process.env.COMPAT_REPORT_NAME ?? 'native-mix-last.json')
const save = () => fs.writeFileSync(lastReport, JSON.stringify(report, null, 2))
try {
  const { loadProfileDirectory, loadLayeredEnv, composeEntries } = runtime('@deepseek-ai/dsh-app-boot')
  if (process.argv.includes('--start-disabled')) {
    const profile = loadProfileDirectory('dsh', dir, installAnchor)
    const rows = composeEntries(profile.layers.map(layer => layer.patches))
    startupPatches.push(...rows.filter(row => fromSample(row.name)).map(row => ({ id: row.id, disabled: true })))
    fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), JSON.stringify(startupPatches))
  }
  const { runProfile } = await import(pathToFileURL(runtime.resolve('@deepseek-ai/dsh/profile-boot')))
  const app = await runProfile({ environment: loadLayeredEnv('dsh'), profile: 'test',
    resolvedProfile: { profile: loadProfileDirectory('dsh', dir, installAnchor), installAnchor },
    patchFiles: [], args: ['--no-open', '--port', '0'],
  })
  const { ctx } = app
  await ctx.loader.await()
  report.entries = [...ctx.loader.entries()].filter(entry => fromSample(entry.options.name)).map(entry => ({
    id: entry.id, name: entry.options.name, state: entry.fiber?.state, disabled: entry.disabled,
  }))
  report.hostInactive = [...ctx.loader.entries()].filter(entry => !entry.disabled && !fromSample(entry.options.name) && entry.fiber?.state !== 2)
    .map(entry => ({ id: entry.id, name: entry.options.name, state: entry.fiber?.state,
      waiting: Object.keys(entry.fiber?.inject ?? {}).filter(name => entry.fiber.ctx.get(name) === undefined) }))
  report.bundles = await ctx.pluginManager.listBundles()
  report.childFailures = []
  for (const runtime of ctx.registry.values()) for (const fiber of runtime.fibers) {
    const entry = fiber.ctx.fiber.entry
    if (fiber.state !== 3 || !entry || !fromSample(entry.options.name)) continue
    try { await fiber.await() } catch (error) { report.childFailures.push({ name: entry.options.name, error: String(error) }) }
  }
  try { report.graph = ctx.clientModules.graph().entries.map(entry => entry.id) }
  catch (error) { report.graphError = String(error?.stack ?? error) }
  report.ok = true
  save()
  if (controls) {
    report.controls = []
    for (const name of extra) {
      const entry = [...ctx.loader.entries()].find(entry => fromPackage(entry.options.name, name))
      const item = { name, cycles: [] }; report.controls.push(item)
      for (let cycle = 0; cycle < 3; cycle++) {
        const record = { cycle }
        try {
          record.offChange = await ctx.pluginManager.setPluginEnabled(entry.id, false); await ctx.loader.await()
          record.off = entry.fiber?.state
          record.onChange = await ctx.pluginManager.setPluginEnabled(entry.id, true); await ctx.loader.await()
          await entry.fiber?.await()
          record.childErrors = []
          for (const runtime of ctx.registry.values()) for (const fiber of runtime.fibers) {
            if (fiber.ctx.fiber.entry === entry && fiber.state === 3) {
              try { await fiber.await() } catch (error) { record.childErrors.push(String(error)) }
            }
          }
          record.on = entry.fiber?.state; record.ok = record.on === 2 && !record.childErrors.length
        } catch (error) { record.ok = false; record.error = String(error?.stack ?? error).slice(0, 1000) }
        item.cycles.push(record)
      }
    }
  }
  if (scoped) {
    const { scopedMix } = await import('./scoped-mix.mjs')
    await scopedMix(ctx, report, names, home, save)
  }
  if (functional) {
    const { functionalMix } = await import('./functional-mix.mjs')
    await functionalMix(ctx, report, home, save)
  }
  if (process.argv.includes('--concurrent')) {
    const { concurrentMix } = await import('./concurrent-mix.mjs')
    await concurrentMix(ctx, report, names, home, save)
  }
  if (process.argv.includes('--tool-scopes')) {
    const { toolScopes } = await import('./tool-scopes.mjs')
    await toolScopes(ctx, report, home, save)
  }
  if (process.argv.includes('--client-isolation')) {
    const { clientIsolation } = await import('./client-isolation.mjs')
    await clientIsolation(ctx, report, home, save)
  }
  await ctx.fiber.dispose()
} catch (error) { report.ok = false; report.error = String(error?.stack ?? error) }
fs.writeFileSync(lastReport, JSON.stringify(report, null, 2))
if (scoped) fs.writeFileSync(path.join(root, 'work/scoped-mix-last.json'), JSON.stringify(report, null, 2))
if (controls) fs.writeFileSync(path.join(root, 'work/controls-mix-last.json'), JSON.stringify(report, null, 2))
if (functional) fs.writeFileSync(path.join(root, 'work/functional-mix-last.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ok: report.ok, error: report.error, entries: report.entries }))
process.exit(report.ok ? 0 : 1)
