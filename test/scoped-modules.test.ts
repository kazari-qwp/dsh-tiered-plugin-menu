import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('native Node module interoperability keeps file interfaces, assets and SQLite scoped', () => {
  // tsx replaces Node's require(esm); exercise the same native loader used by the desktop host.
  const result = spawnSync(process.execPath, ['--expose-internals', '--experimental-transform-types',
    fileURLToPath(new URL('./fixtures/scoped-modules.ts', import.meta.url))], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
