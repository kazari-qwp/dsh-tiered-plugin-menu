import { Context } from '@deepseek-ai/cordis'
import { EntryTree, EntryGroup, Entry, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'

/** Real, ephemeral Loader entries: DSH can discover their client modules and dependencies. */
export class RuntimeTree extends EntryTree {
  commit() {} // Scope configuration is persisted by ConfigStore, not the global profile.

  async mount(ctx: Context, id: string, options: EntryOptions, importModule: (name: string) => any) {
    const parent = new EntryGroup(ctx.extend({ [Entry.key]: undefined }), this)
    const row = { ...options, id, disabled: false }
    const entry = new Entry(this.ctx.loader)
    entry.parent = parent
    this.store[id] = entry
    parent.data.push(row)
    ctx.effect(() => async () => {
      await entry.fiber?.dispose()
      parent.remove(id)
    })
    // Import from the original profile, including its package resolution rules.
    const namespace = await importModule(options.name)
    // Entry.init asks this tree to import; modules are cached by the native loader.
    this.modules.set(options.name, namespace)
    await entry.update(row, true, true)
    if (!entry.fiber) throw new Error(`入口无法加载：${options.name}`)
    await entry.fiber.await()
    if (entry.fiber.state !== 2) throw new Error(`组件未启动，依赖未就绪：${options.name} (${Object.keys(entry.fiber.inject).filter(name => !entry.ctx.get(name)).join(', ')})`)
    return entry
  }

  private modules = new Map<string, unknown>()
  override import(name: string) { return this.modules.has(name) ? this.modules.get(name) : super.import(name) }
}
