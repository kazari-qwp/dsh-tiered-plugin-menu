import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'

/** 真正的工作区注册表，只有存储介质和持久化历史用内存替代。 */
export async function mountWorkspaces(ctx: Context): Promise<void> {
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', {
    kv: { async open(descriptor) {
      const tables: Record<string, Record<string, unknown>> = Object.fromEntries(descriptor.tables.map(name => [name, {}]))
      let global: unknown = null
      return {
        async loadAll() { return { tables, global } },
        async putRecord(table, key, value) { tables[table]![key] = value },
        async deleteRecord(table, key) { delete tables[table]![key] },
        async deleteRecords(table, keys) { for (const key of keys) delete tables[table]![key] },
        async setGlobal(value) { global = value },
        async close() {},
      }
    } },
    async close() {},
  })
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const workspaceCtx = ctx.isolate('sessionPersistence')
  workspaceCtx.provide('sessionPersistence', { list: async () => [] } as never)
  await workspaceCtx.plugin(WorkspaceRegistry)
}
