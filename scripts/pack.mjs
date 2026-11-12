import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const packages = { core: 'dsh-tiered-plugin-core', web: 'dsh-tiered-plugin-menu', tui: 'dsh-tiered-plugin-tui', go: 'dsh-tiered-plugin-go' }
const selected = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(packages)
const destination = resolve('dist')
mkdirSync(destination, { recursive: true })
for (const key of selected) {
  if (!Object.hasOwn(packages, key)) throw new Error(`Unknown component: ${key}. Use core, web, tui or go.`)
  if (!process.env.npm_execpath) throw new Error('Run through npm: npm run pack -- core')
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'pack', '--workspace', packages[key], '--pack-destination', destination, '--json'], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  const [pack] = JSON.parse(result.stdout)
  console.log(`${pack.id}: ${resolve(destination, pack.filename)} (${pack.entryCount} files)`)
}
