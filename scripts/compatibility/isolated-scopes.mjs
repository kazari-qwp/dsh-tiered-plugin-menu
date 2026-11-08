import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
const root = process.cwd()
const names = ['@fooxe/dsh-memory', 'dsh-tacit', 'dsh-prompt-setting', 'dsh-prompt-history', '@cerbur/clutch-dsh-title', '@deepcodec/dsh-clock', 'billion-context']
const output = path.join(root, 'work/isolated-scopes')
fs.mkdirSync(output, { recursive: true })
const results = []
for (const name of names) {
  const item = { name }; results.push(item)
  for (const mode of ['controls', 'scoped', 'scopedCold']) {
    const reportName = `isolated-${name.replaceAll('/', '-')}-${mode}.json`
    const args = ['scripts/compatibility/native-profile.mjs', mode === 'controls' ? '--controls' : '--scoped', name]
    if (mode !== 'controls') args.push('dsh-tiered-plugin-menu')
    if (mode === 'scopedCold') args.push('--start-disabled')
    const run = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 45000,
      env: { ...process.env, COMPAT_REPORT_NAME: reportName } })
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'work', reportName), 'utf8'))
    const record = { ok: raw.ok, exit: run.status, error: raw.error, entries: raw.entries,
      controls: raw.controls, scoped: raw.scoped,
      logErrors: (run.stdout + run.stderr).split('\n').filter(line => /duplicate|has been registered|挂载失败/.test(line)) }
    fs.writeFileSync(path.join(output, reportName), JSON.stringify(record, null, 2))
    item[mode] = mode === 'controls' ? raw.controls?.[0]?.cycles : raw.scoped?.[0]
    item[`${mode}LogErrors`] = record.logErrors
    console.log(JSON.stringify({ name, mode, ok: raw.ok, exit: run.status,
      controlFailures: raw.controls?.[0]?.cycles.filter(c => !c.ok).length,
      failures: raw.scoped?.[0]?.cases.filter(c => !c.ok).map(c => ({ label: c.label, error: c.error.split('\n')[0] })),
      logErrors: record.logErrors.slice(0, 2) }))
  }
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(results, null, 2))
}
