// Run in the offline VM after the official CLI installs the release tarball.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const [home, profileName = 'smoke'] = process.argv.slice(2)
assert.ok(home, 'Pass the disposable DSH_HOME used for the CLI installation')
process.env.DSH_HOME = path.resolve(home)
process.env.DSH_TELEMETRY_DISABLED = '1'
const local = createRequire(path.resolve('package.json'))
const installAnchor = local.resolve('@deepseek-ai/dsh/package.json')
const runtime = createRequire(installAnchor)
const directory = path.join(process.env.DSH_HOME, 'profiles', profileName)
const manifestPath = path.join(directory, 'package.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
assert.ok(manifest.dependencies['dsh-tiered-plugin-menu'])
// A test profile also needs the native web bundle to check frontend discovery.
const bundles = manifest.dsh.profile.bundles
if (!bundles.includes('@deepseek-ai/dsh-web-app')) bundles.push('@deepseek-ai/dsh-web-app')
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
const installed = createRequire(manifestPath)('dsh-tiered-plugin-menu/package.json')
const expected = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version
assert.equal(installed.version, expected)
const { loadProfileDirectory, loadLayeredEnv } = runtime('@deepseek-ai/dsh-app-boot')
const { runProfile } = await import(pathToFileURL(runtime.resolve('@deepseek-ai/dsh/profile-boot')))
const { ctx } = await runProfile({ environment: loadLayeredEnv('dsh'), profile: profileName,
  resolvedProfile: { profile: loadProfileDirectory('dsh', directory, installAnchor), installAnchor },
  patchFiles: [], args: ['--no-open', '--port', '0'],
})
try {
  await ctx.loader.await()
  const entry = [...ctx.loader.entries()].find(entry => entry.options.name === 'dsh-tiered-plugin-menu')
  assert.equal(entry?.fiber?.state, 2)
  const frontend = ctx.clientModules.graph().entries.some(entry => entry.id === 'dsh-tiered-plugin-menu')
  assert.equal(frontend, true)
  console.log(JSON.stringify({ releaseSmoke: true, version: installed.version, host: 'ACTIVE', frontend }))
} finally {
  await ctx.fiber.dispose()
}
