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
const dir = path.join(home, 'profiles', 'test')
fs.mkdirSync(dir, { recursive: true })
fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir')
const extra = names.filter(name => name !== 'dsh-tiered-plugin-menu')
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'compat-test', private: true,
  dependencies: Object.fromEntries(extra.map(name => [name, '*'])),
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...extra] } },
}))
fs.writeFileSync(path.join(dir, 'cordis.yml'), '[]\n')
fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), '[]\n')
process.env.DSH_HOME = home
process.env.DSH_TELEMETRY_DISABLED = '1'
const report = { names, home }
const lastReport = path.join(root, 'work', process.env.COMPAT_REPORT_NAME ?? 'native-mix-last.json')
try {
  const { loadProfileDirectory, loadLayeredEnv } = runtime('@deepseek-ai/dsh-app-boot')
  const { runProfile } = await import(pathToFileURL(runtime.resolve('@deepseek-ai/dsh/profile-boot')))
  const app = await runProfile({ environment: loadLayeredEnv('dsh'), profile: 'test',
    resolvedProfile: { profile: loadProfileDirectory('dsh', dir, installAnchor), installAnchor },
    patchFiles: [], args: ['--no-open', '--port', '0'],
  })
  const { ctx } = app
  if (names.includes('dsh-tiered-plugin-menu')) await ctx.plugin(await import(pathToFileURL(path.resolve(process.env.COMPAT_MENU_ENTRY ?? path.join(root, 'dist/index.js')))), { dataFile: path.join(home, 'menu.json') })
  await ctx.loader.await()
  report.entries = [...ctx.loader.entries()].filter(entry => extra.includes(entry.options.name)).map(entry => ({
    id: entry.id, name: entry.options.name, state: entry.fiber?.state, disabled: entry.disabled,
  }))
  report.bundles = await ctx.pluginManager.listBundles()
  try { report.graph = ctx.clientModules.graph().entries.map(entry => entry.id) }
  catch (error) { report.graphError = String(error?.stack ?? error) }
  report.ok = true
  if (controls) {
    report.controls = []
    for (const name of extra) {
      const entry = [...ctx.loader.entries()].find(entry => entry.options.name === name)
      const item = { name, cycles: [] }; report.controls.push(item)
      for (let cycle = 0; cycle < 3; cycle++) {
        const record = { cycle }
        try {
          record.offChange = await ctx.pluginManager.setPluginEnabled(entry.id, false); await ctx.loader.await()
          record.off = entry.fiber?.state
          record.onChange = await ctx.pluginManager.setPluginEnabled(entry.id, true); await ctx.loader.await()
          await entry.fiber?.await()
          record.on = entry.fiber?.state; record.ok = record.on === 2
        } catch (error) { record.ok = false; record.error = String(error?.stack ?? error).slice(0, 1000) }
        item.cycles.push(record)
      }
    }
  }
  if (scoped) {
    const { scopedMix } = await import('./scoped-mix.mjs')
    await scopedMix(ctx, report, names, home, () => fs.writeFileSync(path.join(root, 'work/scoped-mix-last.json'), JSON.stringify(report, null, 2)))
  }
  if (functional) {
    const { functionalMix } = await import('./functional-mix.mjs')
    await functionalMix(ctx, report, home, () => fs.writeFileSync(path.join(root, 'work/functional-mix-last.json'), JSON.stringify(report, null, 2)))
  }
  await ctx.fiber.dispose()
} catch (error) { report.ok = false; report.error = String(error?.stack ?? error) }
fs.writeFileSync(lastReport, JSON.stringify(report, null, 2))
if (scoped) fs.writeFileSync(path.join(root, 'work/scoped-mix-last.json'), JSON.stringify(report, null, 2))
if (controls) fs.writeFileSync(path.join(root, 'work/controls-mix-last.json'), JSON.stringify(report, null, 2))
if (functional) fs.writeFileSync(path.join(root, 'work/functional-mix-last.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ok: report.ok, error: report.error, entries: report.entries }))
process.exit(report.ok ? 0 : 1)
