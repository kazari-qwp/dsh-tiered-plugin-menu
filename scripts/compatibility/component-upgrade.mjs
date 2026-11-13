// A local registry serves unmodified published 0.7.1 and the candidate tarballs.
// Harness still runs its real pnpm installer, native updater and HMR. Each phase
// gets a new process and a disposable DSH_HOME; no user profile is read.
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const app = path.resolve(process.argv[2] ?? 'E:/dsh/Harness')
const home = path.resolve(repo, 'work', `component-upgrade-${Date.now()}`)
fs.mkdirSync(home, { recursive: true })
const node = path.join(app, 'resources/runtime/primary-runtime/dependencies/node/bin/node.exe')
const pnpm = path.join(app, 'resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs')
const versions = Object.fromEntries(['core', 'web', 'tui', 'dsh-go'].map(folder => [folder, JSON.parse(fs.readFileSync(path.join(repo, 'packages', folder, 'package.json')))]))
const futureVersion = versions.core.version.replace(/\d+$/, n => String(Number(n) + 1))
const futureDir = path.join(home, 'future')
fs.mkdirSync(futureDir)
execFileSync('tar', ['-xzf', path.join(repo, 'dist', `${versions.core.name}-${versions.core.version}.tgz`), '-C', futureDir])
fs.writeFileSync(path.join(futureDir, 'package/package.json'), JSON.stringify({ ...versions.core, version: futureVersion }))
const futureTar = path.join(home, 'future-core.tgz')
execFileSync('tar', ['-czf', futureTar, '-C', futureDir, 'package'])
const packages = new Map()
for (const file of [path.join(repo, 'work/dsh-tiered-plugin-menu-0.7.1.tgz'),
  ...Object.values(versions).map(pkg => path.join(repo, 'dist', `${pkg.name}-${pkg.version}.tgz`)), futureTar]) {
  const data = fs.readFileSync(file)
  const meta = JSON.parse(execFileSync('tar', ['-xOf', file, 'package/package.json'], { encoding: 'utf8' }))
  const group = packages.get(meta.name) ?? []
  group.push({ meta, data }); packages.set(meta.name, group)
}
let future = false
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const [name, segment, version] = decodeURIComponent(url.pathname.slice(1)).split('/')
  const group = packages.get(name)?.filter(p => future || p.meta.version !== futureVersion || name !== versions.core.name)
  if (!group) { res.writeHead(404); res.end('{}'); return }
  if (segment === '-') {
    const tar = group.find(p => `${p.meta.version}.tgz` === version)
    if (!tar) { res.writeHead(404); res.end(); return }
    res.setHeader('Content-Type', 'application/octet-stream'); res.end(tar.data); return
  }
  const metadata = Object.fromEntries(group.map(p => [p.meta.version, { ...p.meta, dist: {
    tarball: `${registry}${name}/-/${p.meta.version}.tgz`,
    integrity: 'sha512-' + createHash('sha512').update(p.data).digest('base64'),
    shasum: createHash('sha1').update(p.data).digest('hex'),
  } }]))
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(segment ? metadata[segment] : { name, 'dist-tags': { latest: group.at(-1).meta.version }, versions: metadata }))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const registry = `http://127.0.0.1:${server.address().port}/`
const packageEnv = { TEMP: home, TMP: home, XDG_CACHE_HOME: path.join(home, 'cache'),
  npm_config_cache: path.join(home, 'cache'), npm_config_store_dir: path.join(home, 'store'), npm_config_registry: registry,
  PNPM_HOME: path.join(home, 'pnpm'), DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }
const env = { ...process.env, ...packageEnv }
delete env.ELECTRON_RUN_AS_NODE
const run = (command, args, label, cwd = repo, extraEnv = {}) => new Promise((resolve, reject) => {
  const log = fs.createWriteStream(path.join(home, `${label}.log`))
  const child = spawn(command, args, { cwd, env: { ...env, ...extraEnv }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.pipe(log); child.stderr.pipe(log)
  child.on('error', reject)
  child.on('exit', code => { log.end(); code === 0 ? resolve() : reject(new Error(`${label} exited ${code}; ${home}/${label}.log`)) })
})
try {
  const directory = path.join(home, 'profiles/web')
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'dsh-upgrade-test', private: true,
    dependencies: { 'dsh-tiered-plugin-menu': '0.7.1' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-tiered-plugin-menu'] } } }, null, 2))
  fs.writeFileSync(path.join(directory, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  fs.writeFileSync(path.join(directory, '.npmrc'), `registry=${registry}\nstore-dir=${home.replaceAll('\\', '/')}/store\n`)
  fs.writeFileSync(path.join(directory, 'cordis.patch.yml'), '- id: tiered-plugin-menu\n  config:\n    dataFile: ' + JSON.stringify(path.join(home, 'custom-menu.json')) + '\n')
  console.log('UPGRADE_HOME', home)
  await run(node, [pnpm, 'install', '--ignore-scripts', '--no-frozen-lockfile'], 'install-old', directory)
  const config = { home, registry, coreVersion: versions.core.version, webVersion: versions.web.version, futureCoreVersion: futureVersion, interfaceVersion: versions.tui.version,
    anchor: path.join(app, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/package.json'),
    packageManager: { command: node, args: [pnpm], env: packageEnv } }
  const configFile = path.join(home, 'test.json')
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2))
  for (const phase of ['seed', 'upgrade', 'cold', 'interfaces', 'core-update', 'final']) {
    if (phase === 'core-update') future = true
    await run(path.join(app, 'DeepSeek Harness.exe'), [path.join(repo, 'scripts/compatibility/component-upgrade-host.cjs'), configFile, phase], phase, repo, { ELECTRON_RUN_AS_NODE: '1' })
    console.log('PASS', phase)
  }
} finally { server.closeAllConnections(); server.close() }
