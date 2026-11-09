import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire, findPackageJSON, isBuiltin, Module, registerHooks, type ModuleHooks } from 'node:module'
import { DirectoryView } from './directory-view.ts'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Entry, EntryTree } from '@deepseek-ai/cordis-plugin-loader'

const nativeRequire = createRequire(import.meta.url)
const bridgeKey = Symbol.for('dsh-tiered-plugin-menu.module-values')
const values: Map<string, unknown> = (globalThis as any)[bridgeKey] ??= new Map()
const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 24)
const packageName = (name: string) => name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]!
interface Namespace {
  prefix: string
  view: DirectoryView
  peers: Set<string>
  common: Record<string, NodeModule>
  builtins: Map<string, any>
}
interface Source { namespace: Namespace; original: string; builtin?: string }

/** Private module graphs give cached fs imports and dependency-local locks the same instance lifetime. */
export class ScopedModules {
  private virtual: string
  private sources = new Map<string, Source>()
  private namespaces = new Map<string, Namespace>()
  private hook: ModuleHooks
  private loading = new AsyncLocalStorage<{ entry: Entry; key: string; peers: string[] }>()
  private trees = new Map<EntryTree, { original: EntryTree['import']; entries: Set<Entry> }>()

  constructor(readonly root: string) {
    this.virtual = path.join(path.resolve(root), '.modules', randomUUID())
    this.hook = registerHooks({
      resolve: (specifier, context, next) => {
        const direct = path.isAbsolute(specifier) ? pathToFileURL(specifier).href : specifier
        if (this.sources.has(direct)) return { shortCircuit: true, url: direct }
        const parent = this.sources.get(context.parentURL ?? '')
        if (!parent) return next(specifier, context)
        const originalContext = { ...context, parentURL: parent.original }
        if (isBuiltin(specifier)) {
          const name = specifier.replace(/^node:/, '')
          if (!['fs', 'fs/promises', 'sqlite', 'module'].includes(name)) return next(specifier, originalContext)
          const url = pathToFileURL(path.join(parent.namespace.prefix, 'builtin', `${name.replaceAll('/', '-')}.mjs`)).href
          this.sources.set(url, { namespace: parent.namespace, original: `node:${name}`, builtin: name })
          return { shortCircuit: true, url }
        }
        const resolved = next(specifier, originalContext)
        if (!resolved.url.startsWith('file:') || resolved.url.endsWith('.node') || this.shared(parent.namespace, specifier)) return resolved
        return { ...resolved, shortCircuit: true, url: this.url(parent.namespace, resolved.url) }
      },
      load: (url, context, next) => {
        const source = this.sources.get(url)
        if (!source) return next(url, context)
        if (source.builtin) return this.bridge(url, this.builtin(source.namespace, source.builtin))
        const loaded = next(source.original, context)
        if (loaded.format === 'commonjs') return this.bridge(url, this.common(source.namespace, fileURLToPath(source.original)))
        if (loaded.format === 'module') {
          const filename = fileURLToPath(source.original)
          values.set(`${url}:meta`, { url: source.original, filename, dirname: path.dirname(filename),
            original: (resolved: string) => this.sources.get(resolved)?.original ?? resolved })
          // The cache identity is private, but plugin assets and paths handed to host services stay logical.
          const prefix = `{const m=globalThis[Symbol.for('dsh-tiered-plugin-menu.module-values')].get(${JSON.stringify(`${url}:meta`)});`
            + `const resolve=import.meta.resolve;Object.assign(import.meta,{url:m.url,filename:m.filename,dirname:m.dirname});`
            + `import.meta.resolve=(...args)=>m.original(resolve(...args));}\n`
          const text = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source as ArrayBuffer).toString()
          const boundary = text.startsWith('#!') ? text.indexOf('\n') + 1 : 0
          return { ...loaded, source: text.slice(0, boundary) + prefix + text.slice(boundary) }
        }
        return loaded
      },
    })
  }

  private shared(namespace: Namespace, specifier: string): boolean {
    // SDK/peer singletons belong to the host. Ordinary package dependencies belong to the instance.
    return specifier.startsWith('@deepseek-ai/') || namespace.peers.has(packageName(specifier))
  }

  private original(namespace: Namespace, file: string): string {
    const prefix = path.join(namespace.prefix, 'source') + path.sep
    if (!file.startsWith(prefix)) return file
    const [volume, ...parts] = file.slice(prefix.length).split(path.sep)
    return path.join(decodeURIComponent(volume!), ...parts)
  }

  private url(namespace: Namespace, original: string): string {
    const file = fileURLToPath(original), volume = path.parse(file).root
    const url = pathToFileURL(path.join(namespace.prefix, 'source', encodeURIComponent(volume), file.slice(volume.length))).href
    this.sources.set(url, { namespace, original })
    return url
  }

  private bridge(url: string, value: any) {
    values.set(url, value)
    const names = Object.keys(Object(value)).filter(name => name !== 'default' && /^[A-Za-z_$][\w$]*$/.test(name))
    return { shortCircuit: true, format: 'module' as const,
      source: `const value=globalThis[Symbol.for('dsh-tiered-plugin-menu.module-values')].get(${JSON.stringify(url)});export default value;`
        + names.map((name, index) => `const member${index}=value[${JSON.stringify(name)}];export {member${index} as ${name}};`).join('') }
  }

  private builtin(namespace: Namespace, name: string): any {
    if (namespace.builtins.has(name)) return namespace.builtins.get(name)
    const view = namespace.view
    let value: any
    if (name === 'fs') value = view.fs
    else if (name === 'fs/promises') value = view.promises
    else if (name === 'module') value = new Proxy(nativeRequire('node:module'), { get: (target, key) => key === 'createRequire'
      ? (filename: string | URL) => this.require(namespace, this.original(namespace, filename instanceof URL ? fileURLToPath(filename) : filename))
      : Reflect.get(target, key) })
    else {
      const sqlite = nativeRequire('node:sqlite')
      value = { ...sqlite, DatabaseSync: new Proxy(sqlite.DatabaseSync, { construct(target, args, constructor) {
        if (args[0] !== ':memory:') args[0] = path.toNamespacedPath(view.resolve(args[0]) as string)
        return Reflect.construct(target, args, constructor)
      } }) }
      if (sqlite.backup) value.backup = (db: unknown, file: string, ...args: unknown[]) => sqlite.backup(db, view.resolve(file), ...args)
    }
    namespace.builtins.set(name, value)
    return value
  }

  private require(namespace: Namespace, parent: string): NodeJS.Require {
    const native = createRequire(parent)
    const load = ((specifier: string) => {
      if (isBuiltin(specifier)) {
        const name = specifier.replace(/^node:/, '')
        return ['fs', 'fs/promises', 'sqlite', 'module'].includes(name) ? this.builtin(namespace, name) : native(specifier)
      }
      const filename = native.resolve(specifier)
      if (filename.endsWith('.node') || this.shared(namespace, specifier)) return native(specifier)
      return this.common(namespace, filename)
    }) as NodeJS.Require
    return Object.assign(load, { resolve: native.resolve, cache: namespace.common, extensions: native.extensions, main: native.main })
  }

  private common(namespace: Namespace, filename: string): any {
    if (namespace.common[filename]) return namespace.common[filename]!.exports
    const manifest = filename.endsWith('.js') ? findPackageJSON(pathToFileURL(filename)) : undefined
    if (filename.endsWith('.mjs') || manifest && JSON.parse(fs.readFileSync(manifest, 'utf8')).type === 'module') {
      return nativeRequire(fileURLToPath(this.url(namespace, pathToFileURL(filename).href)))
    }
    const mod = new Module(filename) as NodeModule & { paths: string[]; _compile(source: string, filename: string): void }
    mod.filename = filename
    mod.paths = (Module as any)._nodeModulePaths(path.dirname(filename))
    mod.require = this.require(namespace, filename)
    namespace.common[filename] = mod
    try {
      const source = fs.readFileSync(filename, 'utf8')
      if (filename.endsWith('.json')) mod.exports = JSON.parse(source)
      else mod._compile(source, filename)
      mod.loaded = true
      return mod.exports
    } catch (error) { delete namespace.common[filename]; throw error }
  }

  async import(key: string, original: string, peers: string[] = []): Promise<any> {
    let namespace = this.namespaces.get(key)
    if (!namespace) {
      const prefix = path.join(this.virtual, hash(key))
      namespace = { prefix, peers: new Set(peers), common: Object.create(null), builtins: new Map(), view: undefined! }
      namespace.view = new DirectoryView(path.join(this.root, hash(key)), file => this.original(namespace!, file))
      this.namespaces.set(key, namespace)
    }
    return import(this.url(namespace, original))
  }

  /** Client entries and lower instances load through the same private module graph. */
  async load(tree: EntryTree, name: string, key: string, peers: string[], importModule = tree.import.bind(tree)) {
    const namespace = await importModule(name)
    // In-memory factories and Cordis builtins have no file module graph.
    if (namespace?.[Symbol.toStringTag] !== 'Module') return namespace
    const parent = tree.ctx.baseUrl ?? pathToFileURL(tree.ctx.profileContext.installAnchor).href
    const loader = tree.ctx.loader.internal
    const url = loader?.version === 'v2' ? loader.resolveSync(parent, { specifier: name }).url
      : loader?.version === 'v1' ? loader.resolveSync(name, parent, {}).url
        : pathToFileURL(createRequire(parent).resolve(name)).href
    return url.startsWith('file:') ? this.import(key, url, peers) : namespace
  }

  bind(entry: Entry, key: string, peers: string[]): () => void {
    const tree = entry.parent.tree
    let bound = this.trees.get(tree)
    if (!bound) {
      const original = tree.import
      bound = { original, entries: new Set() }; this.trees.set(tree, bound)
      tree.import = async (name, ...args) => {
        const request = this.loading.getStore()
        if (!request || request.entry.parent.tree !== tree || request.entry.options.name !== name) return original.call(tree, name, ...args)
        return this.load(tree, name, request.key, request.peers, original.bind(tree))
      }
    }
    bound.entries.add(entry)
    const init = entry.init
    entry.init = () => this.loading.run({ entry, key, peers }, () => init.call(entry))
    return () => {
      entry.init = init
      bound.entries.delete(entry)
      if (!bound.entries.size) { tree.import = bound.original; this.trees.delete(tree) }
    }
  }

  view(key: string): DirectoryView | undefined { return this.namespaces.get(key)?.view }

  dispose(): void {
    this.hook.deregister()
    for (const url of this.sources.keys()) { values.delete(url); values.delete(`${url}:meta`) }
  }
}
