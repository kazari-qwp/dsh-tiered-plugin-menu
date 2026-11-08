// Run only inside a disposable VM/container with no host credentials or mounts.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const samples = JSON.parse(fs.readFileSync(new URL('./samples.json', import.meta.url)))
const names = Object.keys(samples)
const script = fileURLToPath(new URL('./native-profile.mjs', import.meta.url))
const output = path.resolve('work/compatibility')
fs.mkdirSync(output, { recursive: true })
const cases = [
  ...names.map(name => ({ name: `native-${name.replaceAll('/', '-')}`, args: [name] })),
  { name: 'native-mix', args: names },
  { name: 'client-mix', args: [...names, 'dsh-tiered-plugin-menu'] },
  { name: 'native-controls', args: ['--controls', ...names] },
  { name: 'scoped-mix', args: ['--scoped', ...names, 'dsh-tiered-plugin-menu'] },
  { name: 'functional-mix', args: ['--functional', ...names, 'dsh-tiered-plugin-menu'] },
]
let failed = false
for (const item of cases) {
  const reportName = item.name + '-last.json'
  const last = path.resolve('work', reportName)
  fs.rmSync(last, { force: true })
  const run = spawnSync(process.execPath, [script, ...item.args], { encoding: 'utf8', timeout: 150000,
    env: { ...process.env, COMPAT_REPORT_NAME: reportName } })
  const raw = fs.existsSync(last) ? JSON.parse(fs.readFileSync(last)) : { ok: false, error: String(run.error ?? 'No report') }
  const report = { samples, exit: run.status, ok: raw.ok, error: raw.error, graphError: raw.graphError,
    entries: raw.entries, controls: raw.controls, scoped: raw.scoped, setup: raw.setup,
    persistence: raw.persistence, functional: raw.functional, requestCount: raw.requestCount }
  const text = JSON.stringify(report, null, 2).replaceAll(process.cwd(), '<lab>').replace(/token=\S+/g, 'token=[redacted]')
  fs.writeFileSync(path.join(output, item.name + '.json'), text + '\n')
  const functionalFailures = raw.functional?.flatMap(plugin => plugin.cases.filter(test => !test.ok)) ?? []
  const persistenceFailures = raw.persistence?.filter(test => !test.ok) ?? []
  // Lower-scope incompatibilities are findings, not claims of universal support.
  failed ||= run.status !== 0 || !raw.ok || !!raw.graphError || functionalFailures.length > 0 || persistenceFailures.length > 0
  console.log(JSON.stringify({ case: item.name, ok: raw.ok, exit: run.status,
    functionalFailures: functionalFailures.length, persistenceFailures: persistenceFailures.length,
    scopedFailures: raw.scoped?.flatMap(plugin => plugin.cases?.filter(test => !test.ok) ?? []).length }))
}
process.exitCode = failed ? 1 : 0
