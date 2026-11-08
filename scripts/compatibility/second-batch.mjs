// Run only in the same disposable, offline VM as the first matrix.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const samples = JSON.parse(fs.readFileSync(new URL('./samples-second.json', import.meta.url)))
const names = Object.keys(samples)
const output = path.resolve('work/second-batch')
fs.mkdirSync(output, { recursive: true })
const cases = names.flatMap(name => [
  { name: `native-${name.replaceAll('/', '-')}`, args: ['--controls', name] },
  { name: `scoped-${name.replaceAll('/', '-')}`, args: ['--scoped', '--start-disabled', name, 'dsh-tiered-plugin-menu'] },
])
cases.push(
  { name: 'native-mix', args: names },
  { name: 'client-mix', args: [...names, 'dsh-tiered-plugin-menu'] },
  { name: 'scoped-mix', args: ['--scoped', '--start-disabled', ...names, 'dsh-tiered-plugin-menu'] },
)
const summary = []
for (const item of cases.filter(item => process.argv.length === 2 || process.argv.slice(2).includes(item.name))) {
  const reportName = `second-${item.name}.json`
  const target = path.resolve('work', reportName)
  fs.rmSync(target, { force: true })
  const run = spawnSync(process.execPath, ['scripts/compatibility/native-profile.mjs', ...item.args], {
    encoding: 'utf8', timeout: 90000, env: { ...process.env, COMPAT_REPORT_NAME: reportName },
  })
  const raw = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target)) : { ok: false, error: String(run.error ?? `Exited ${run.status} without a report`) }
  const clean = value => JSON.stringify(value, null, 2).replaceAll(process.cwd(), '<lab>').replace(/token=\S+/g, 'token=[redacted]')
  fs.writeFileSync(path.join(output, `${item.name}.json`), clean(raw))
  fs.writeFileSync(path.join(output, `${item.name}.log`), (run.stdout + run.stderr).replaceAll(process.cwd(), '<lab>').replace(/token=\S+/g, 'token=[redacted]'))
  const record = { name: item.name, exit: run.status, ok: raw.ok, error: raw.error, graphError: raw.graphError,
    entries: raw.entries, controls: raw.controls,
    scoped: raw.scoped?.map(plugin => ({ name: plugin.name, error: plugin.error, cases: plugin.cases,
      frontendInGraph: plugin.clientModules?.includes(plugin.name), packageComponents: plugin.packageComponents })),
  }
  summary.push(record)
  fs.writeFileSync(path.join(output, 'summary.json'), clean({ samples, cases: summary }))
  console.log(JSON.stringify({ name: item.name, exit: run.status, ok: raw.ok, error: raw.error?.split('\n')[0],
    nativeFailures: raw.controls?.flatMap(plugin => plugin.cycles.filter(test => !test.ok)).length,
    scopedFailures: raw.scoped?.flatMap(plugin => plugin.cases?.filter(test => !test.ok) ?? []).map(test => ({ label: test.label, error: test.error?.split('\n')[0] })),
  }))
}
