import type { Context } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { loadOptionalPatches, readProfilePatches, reconcileProfilePatches } from '@deepseek-ai/dsh-app-boot'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Scalar, isMap, isSeq, parseDocument, visit } from 'yaml'
import type { PluginConfig } from './shared.ts'

/** Disabled bundles have no Loader entry; their saved profile override still exists. */
export function profileConfig(ctx: Context, options: EntryOptions): PluginConfig {
  const path = ctx.profileContext.patchPath
  const patches = path ? loadOptionalPatches('dsh', path) ?? [] : []
  return patches.findLast(patch => patch.id === options.id && !patch.insert && patch.config !== undefined
    && (!patch.name || patch.name === options.name))?.config as PluginConfig ?? options.config ?? {}
}

/** ConfigEditor only edits running plugins. Persist an inactive entry without activating it. */
export async function saveInactiveConfig(ctx: Context, options: EntryOptions, config: PluginConfig): Promise<void> {
  const profile = ctx.profileContext
  const run = () => withFileLock(join(profile.dir, 'package.json'), async () => {
    let before: string
    try { before = await readFile(profile.patchPath, 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      before = '[]\n'
    }
    const document = parseDocument(before, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }] })
    if (document.errors[0]) throw document.errors[0]
    if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence')
    document.contents.flow = false
    const index = document.contents.items.findLastIndex((item, index) => isMap(item) && !item.has('insert')
      && document.getIn([index, 'id']) === options.id && (!item.has('name') || document.getIn([index, 'name']) === options.name))
    if (index < 0) document.add({ id: options.id, name: options.name, config })
    else document.setIn([index, 'config'], document.createNode(config))
    visit(document, { Map(_key, node) {
      if (node.items.length !== 1 || typeof node.get('__jsExpr') !== 'string') return
      const expression = new Scalar(node.get('__jsExpr'))
      expression.tag = 'tag:yaml.org,2002:js'
      return expression
    } })
    await writeFileAtomic(profile.patchPath, String(document), { mode: 0o600 })
    try {
      await reconcileProfilePatches(ctx.root, readProfilePatches('dsh', profile), 'dsh')
    } catch (error) {
      await writeFileAtomic(profile.patchPath, before, { mode: 0o600 })
      await reconcileProfilePatches(ctx.root, readProfilePatches('dsh', profile), 'dsh')
      throw error
    }
  })
  const hmr = ctx.get('hmr')
  await (hmr ? hmr.runExclusive(run) : run())
}
