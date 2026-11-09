import { createHash } from 'node:crypto'

const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 8)
const label = (value: string, length: number) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, length).replace(/^-+|-+$/g, '') || 'item'

/** Stable model-facing identifiers; private plugin code can keep its original names. */
export function resourceName(plugin: string, name: string): string {
  return `p${hash(plugin)}-${label(plugin, 16)}-${label(name, 25)}-${hash(name)}`
}
