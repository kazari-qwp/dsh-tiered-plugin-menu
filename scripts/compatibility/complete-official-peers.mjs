import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
const root = process.cwd()
for (let pass = 0; pass < 4; pass++) {
  const missing = new Map()
  for (const directory of fs.readdirSync(path.join(root, 'node_modules/@deepseek-ai'))) {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@deepseek-ai', directory, 'package.json'), 'utf8'))
    for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
      if (!name.startsWith('@deepseek-ai/') || pkg.peerDependenciesMeta?.[name]?.optional) continue
      if (!fs.existsSync(path.join(root, 'node_modules', name, 'package.json'))) {
        missing.set(name, name.startsWith('@deepseek-ai/dsh-') ? '0.2.2-rc.1' : range)
      }
    }
  }
  console.log('OFFICIAL_PEERS', Object.fromEntries(missing))
  if (!missing.size) break
  const result = spawnSync('npm', ['install', '--save-dev', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund',
    ...[...missing].map(([name, version]) => `${name}@${version}`)], { cwd: root, stdio: 'inherit' })
  if (result.status) process.exit(result.status)
}
