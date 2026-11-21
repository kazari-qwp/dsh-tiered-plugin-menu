import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { mountRootInclude } from '@deepseek-ai/dsh-app-boot'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { profileConfig, saveInactiveConfig } from '../packages/core/src/profile-config.ts'

test('saving a disabled plugin yields HMR to a native writer and preserves both edits', { timeout: 8000 }, async () => {
  await mkdir('work', { recursive: true })
  const home = resolve(await mkdtemp('work/profile-lock-'))
  const dir = join(home, 'profile')
  const manifest = join(dir, 'package.json')
  const base = join(dir, 'cordis.yml')
  const patchPath = join(dir, 'cordis.patch.yml')
  await mkdir(dir)
  await Promise.all([writeFile(manifest, '{}'), writeFile(base, '[]\n'), writeFile(patchPath, '[]\n')])

  const ctx = new Context()
  try {
    ctx.provide('profileContext', {
      name: 'profile', dir, patchPath, installAnchor: manifest, cwd: dir, home, startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
    })
    await ctx.plugin(Loader)
    await mountRootInclude(ctx, base)

    let notifyLocked!: () => void
    const locked = new Promise<void>(resolve => { notifyLocked = resolve })
    let notifySaveQueued!: () => void
    const saveQueued = new Promise<void>(resolve => { notifySaveQueued = resolve })
    let tail = Promise.resolve()
    function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
      const job = tail.then(operation)
      tail = job.then(() => undefined, () => undefined)
      notifySaveQueued()
      return job
    }
    ctx.provide('hmr', { runExclusive })
    const first = { id: 'other-plugin', name: 'other-plugin' }
    const second = { id: 'disabled-plugin', name: 'disabled-plugin' }
    const nativeWrite = withFileLock(manifest, async () => {
      notifyLocked()
      await saveQueued
      await runExclusive(() => writeFileAtomic(patchPath, '- id: other-plugin\n  config: { text: native }\n', { mode: 0o600 }))
    })
    await locked
    const outcomes = await Promise.allSettled([nativeWrite, saveInactiveConfig(ctx, second, { text: 'menu' })])
    for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason
    assert.deepEqual(profileConfig(ctx, first), { text: 'native' })
    assert.deepEqual(profileConfig(ctx, second), { text: 'menu' })
  } finally { await ctx.fiber.dispose() }
})
