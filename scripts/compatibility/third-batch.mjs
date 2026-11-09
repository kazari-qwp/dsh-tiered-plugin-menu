// Run in the offline disposable VM. Each case has its own HOME, cwd and DSH profile.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url)))
const old = { ...read('./samples.json'), ...read('./samples-second.json') }
const fresh = read('./samples-third.json')
const samples = { ...old, ...fresh }
const names = Object.keys(samples), newNames = Object.keys(fresh)
const script = path.join(root, 'scripts/compatibility/native-profile.mjs')
const output = path.resolve(root, process.env.COMPAT_OUTPUT ?? 'work/third-batch')
fs.mkdirSync(output, { recursive: true })
const cases = newNames.flatMap(name => [
  { name: `native-${name.replaceAll('/', '-')}`, args: ['--controls', name] },
  { name: `scoped-${name.replaceAll('/', '-')}`, args: ['--scoped', '--start-disabled', name, 'dsh-tiered-plugin-menu'] },
])
cases.push(
  { name: 'native-all', args: names },
  { name: 'native-memory-pair', args: ['@fooxe/dsh-memory','meow-memory'] },
  { name: 'client-all', args: [...names, 'dsh-tiered-plugin-menu'] },
  { name: 'scoped-old', args: ['--scoped', '--start-disabled', ...Object.keys(old), 'dsh-tiered-plugin-menu'] },
  { name: 'scoped-new', args: ['--scoped', '--start-disabled', ...newNames, 'dsh-tiered-plugin-menu'] },
  { name: 'scoped-all', args: ['--scoped', '--start-disabled', ...names, 'dsh-tiered-plugin-menu'] },
  { name: 'functional-old', args: ['--functional', ...Object.keys(old), 'dsh-tiered-plugin-menu'] },
  { name: 'functional-all', args: ['--functional', ...names, 'dsh-tiered-plugin-menu'] },
  { name: 'concurrent-all', args: ['--concurrent', '--start-disabled', ...names, 'dsh-tiered-plugin-menu'] },
  ...['native', 'client', 'scoped', 'functional', 'concurrent'].map(kind=>({
    name: `${kind}-without-conflict`, args: [...(['scoped','functional','concurrent'].includes(kind)?[`--${kind}`]:[]),
      ...(['scoped','concurrent'].includes(kind)?['--start-disabled']:[]),
      ...names.filter(name=>name!=='meow-memory'), ...(kind==='native'?[]:['dsh-tiered-plugin-menu'])],
  })),
)
const summaryFile = path.join(output, process.env.COMPAT_SUMMARY ?? 'summary.json')
const summary = fs.existsSync(summaryFile) ? readFile(summaryFile).cases : []
function readFile(file) { return JSON.parse(fs.readFileSync(file)) }
const clean = value => JSON.stringify(value, null, 2).replaceAll(root, '<lab>').replace(/token=\S+/g, 'token=[redacted]')
for (const item of cases.filter(item => process.argv.length === 2 || process.argv.slice(2).includes(item.name))) {
  const directory = fs.mkdtempSync(path.join(output, `${item.name}-`))
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir')
  fs.mkdirSync(path.join(directory, 'home'))
  fs.writeFileSync(path.join(directory, 'package.json'), '{"private":true}')
  const started = Date.now()
  const run = spawnSync(process.execPath, [script, ...item.args], {
    cwd: directory, encoding: 'utf8', timeout: Number(process.env.COMPAT_TIMEOUT_MS) || (item.args.includes('--functional') ? 900000 : 180000), maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, HOME: path.join(directory, 'home'), XDG_CONFIG_HOME: path.join(directory, 'home/.config'),
      XDG_CACHE_HOME: path.join(directory, 'home/.cache'), COMPAT_REPORT_NAME: 'report.json',
      COMPAT_MENU_ENTRY: process.env.COMPAT_MENU_ENTRY ?? path.join(root, 'dist/index.js') },
  })
  const report = path.join(directory, 'work/report.json')
  const raw = fs.existsSync(report) ? readFile(report) : { ok: false, error: String(run.error ?? 'No report') }
  fs.writeFileSync(path.join(output, `${item.name}.json`), clean(raw))
  fs.writeFileSync(path.join(output, `${item.name}.log`), (run.stdout + run.stderr).replaceAll(root, '<lab>').replace(/token=\S+/g, 'token=[redacted]'))
  const failed = (raw.scoped ?? []).flatMap(plugin => plugin.cases?.filter(test => !test.ok).map(test => ({ name: plugin.name, ...test })) ?? [{ name: plugin.name, error: plugin.error }])
  const record = { name: item.name, exit: run.status, signal: run.signal, elapsedMs: Date.now() - started,
    processError: run.error?.message, ok: raw.ok, error: raw.error,
    graphError: raw.graphError, entries: raw.entries, childFailures: raw.childFailures, controls: raw.controls,
    scoped: raw.scoped?.map(plugin => ({ name: plugin.name, error: plugin.error, cases: plugin.cases,
      frontendInGraph: plugin.clientModules?.includes(plugin.name), separateConfigurations: plugin.separateConfigurations,
      packageComponents: plugin.packageComponents })), functional: raw.functional, persistence: raw.persistence,
    concurrent: raw.concurrent, requestCount: raw.requestCount }
  const index = summary.findIndex(previous => previous.name === item.name)
  if (index < 0) summary.push(record); else summary[index] = record
  fs.writeFileSync(summaryFile, clean({ samples, cases: summary }))
  console.log(JSON.stringify({ name: item.name, exit: run.status, elapsedMs: record.elapsedMs,
    processError: record.processError, ok: raw.ok, error: raw.error?.split('\n')[0],
    inactive: raw.entries?.filter(entry => !entry.disabled && entry.state !== 2), childFailures: raw.childFailures,
    nativeFailures: raw.controls?.flatMap(plugin => plugin.cycles.filter(test => !test.ok)).length,
    scopedFailures: failed.map(test => ({ name: test.name, label: test.label, error: test.error?.split('\n')[0] })),
    functionalFailures: raw.functional?.flatMap(plugin => plugin.cases.filter(test => !test.ok)).length,
    concurrentFailures: raw.concurrent?.filter(test => !test.ok) }))
}
