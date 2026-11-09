import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type Input = string | Buffer | URL | number
const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}
const onePath = ['access', 'appendFile', 'chmod', 'chown', 'exists', 'lchmod', 'lchown', 'lstat', 'lutimes',
  'mkdir', 'mkdtemp', 'open', 'opendir', 'readFile', 'readdir', 'readlink', 'realpath', 'rm', 'rmdir',
  'stat', 'statfs', 'truncate', 'unlink', 'utimes', 'writeFile']
const twoPaths = ['copyFile', 'cp', 'link', 'rename']

/** A plugin-created directory is a private mount; paths outside it keep their original meaning. */
export class DirectoryView {
  readonly fs: typeof fs
  readonly promises: typeof fs.promises
  private roots: string[]
  private files: string
  private manifest: string

  constructor(readonly root: string, private originalPath: (file: string) => string = file => file) {
    this.files = path.join(root, 'files')
    this.manifest = path.join(root, 'directories.json')
    this.roots = fs.existsSync(this.manifest) ? JSON.parse(fs.readFileSync(this.manifest, 'utf8')) : []
    this.promises = this.facade(fs.promises, true)
    this.fs = this.facade(fs, false)
    Object.defineProperty(this.fs, 'promises', { value: this.promises, configurable: true })
  }

  private logical(input: Exclude<Input, number>): string {
    return path.resolve(this.originalPath(input instanceof URL ? fileURLToPath(input) : input.toString()))
  }

  private mirror(logical: string): string {
    const volume = path.parse(logical).root
    return path.join(this.files, encodeURIComponent(volume), logical.slice(volume.length))
  }

  /** Normalize relative paths and .. before deciding which mount owns the request. */
  resolve(input: Input): string | number {
    if (typeof input === 'number') return input
    const logical = this.logical(input)
    return this.roots.some(root => inside(root, logical)) ? this.mirror(logical) : logical
  }

  private unmap(input: string | Buffer): string | Buffer {
    const text = input.toString()
    const normal = process.platform === 'win32' && text.startsWith('\\\\?\\') ? text.slice(4) : text
    if (!inside(this.files, normal)) return input
    const [volume, ...parts] = path.relative(this.files, normal).split(path.sep)
    const logical = path.join(decodeURIComponent(volume!), ...parts)
    return Buffer.isBuffer(input) ? Buffer.from(logical) : logical
  }

  private claim(logical: string): void {
    if (this.roots.some(root => inside(root, logical))) return
    this.roots.push(logical)
    fs.mkdirSync(this.root, { recursive: true })
    fs.writeFileSync(this.manifest, JSON.stringify(this.roots) + '\n')
  }

  private mkdir(input: Input, recursive: boolean): string {
    const logical = this.logical(input as Exclude<Input, number>)
    let first = logical
    if (recursive) {
      while (path.dirname(first) !== first && !fs.existsSync(this.resolve(path.dirname(first)) as string)) first = path.dirname(first)
    } else {
      // Preserve ENOENT instead of silently creating a missing logical parent.
      fs.statSync(this.resolve(path.dirname(first)) as string)
    }
    this.claim(first)
    const target = this.resolve(logical) as string
    fs.mkdirSync(path.dirname(target), { recursive: true })
    return target
  }

  private result(name: string, value: any): any {
    if (name === 'mkdtemp' && value != null) this.claim(this.unmap(value).toString())
    if ((name === 'realpath' || name === 'readlink' || name === 'mkdtemp' || name === 'mkdir') && value != null) return this.unmap(value)
    if (name === 'readdir' && Array.isArray(value)) return value.map(item => this.dirent(item))
    if (name === 'opendir') {
      const view = this
      return new Proxy(value, { get(target, key) {
        if (key === 'path') return view.unmap(target.path)
        if (key === Symbol.asyncIterator) return async function* () { for await (const item of target) yield view.dirent(item) }
        if (key === 'readSync') return () => view.dirent(target.readSync())
        if (key === 'read') return (callback?: (error: unknown, item: any) => void) => callback
          ? target.read((error: unknown, item: any) => callback(error, view.dirent(item))) : target.read().then((item: any) => view.dirent(item))
        const field = Reflect.get(target, key)
        return typeof field === 'function' ? field.bind(target) : field
      } })
    }
    return value
  }

  private dirent(value: any) {
    if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
      for (const key of ['parentPath', 'path']) if (typeof value[key] === 'string') value[key] = this.unmap(value[key])
    }
    return value
  }

  private error(error: any, before: any[], after: any[]) {
    if (!(error instanceof Error)) return error
    for (let index = 0; index < before.length; index++) {
      if (typeof after[index] !== 'string' || after[index] === before[index]) continue
      for (const key of ['path', 'dest', 'message'] as const) {
        const record = error as unknown as Record<string, unknown>
        if (typeof record[key] === 'string') record[key] = record[key].replaceAll(after[index], String(before[index]))
      }
    }
    return error
  }

  private wrap(name: string, original: (...args: any[]) => any, promise: boolean, sync: boolean, count = 1) {
    const base = name.replace(/Sync$/, '')
    return (...input: any[]) => {
      const args = [...input]
      const callback = !promise && !sync && typeof args.at(-1) === 'function' ? args.pop() : undefined
      try {
        for (let index = 0; index < count; index++) args[index] = this.resolve(args[index])
        if (base === 'mkdir') args[0] = this.mkdir(input[0], !!input[1]?.recursive)
        if (base === 'mkdtemp') {
          args[0] = this.mirror(this.logical(input[0]))
          fs.mkdirSync(path.dirname(args[0]), { recursive: true })
        }
        if (callback) return original(...args, (error: unknown, value: any, ...rest: any[]) => {
          callback(this.error(error, input, args), this.result(base, value), ...rest)
        })
        const result = original(...args)
        return promise ? Promise.resolve(result).then(value => this.result(base, value), error => { throw this.error(error, input, args) })
          : this.result(base, result)
      } catch (error) {
        const mapped = this.error(error, input, args)
        if (callback) { queueMicrotask(() => callback(mapped)); return }
        if (promise) return Promise.reject(mapped)
        throw mapped
      }
    }
  }

  private facade<T extends object>(native: T, promise: boolean): T {
    const result = { ...native } as any
    for (const [names, count] of [[onePath, 1], [twoPaths, 2]] as const) for (const name of names) {
      for (const method of promise ? [name] : [name, `${name}Sync`]) {
        const original = (native as any)[method]
        if (typeof original !== 'function') continue
        result[method] = this.wrap(method, original, promise, method.endsWith('Sync'), count)
        if (original.native) result[method].native = this.wrap(method, original.native, promise, method.endsWith('Sync'), count)
      }
    }
    if (!promise) for (const name of ['createReadStream', 'createWriteStream', 'watch', 'watchFile', 'unwatchFile']) {
      result[name] = (file: Input, ...args: any[]) => (native as any)[name](this.resolve(file), ...args)
    }
    for (const method of promise ? ['symlink'] : ['symlink', 'symlinkSync']) {
      const original = (native as any)[method]
      result[method] = (target: Input, link: Input, ...args: any[]) => {
        const logicalLink = this.logical(link as Exclude<Input, number>)
        const logicalTarget = path.resolve(path.dirname(logicalLink), target.toString())
        return original(this.resolve(logicalTarget), this.resolve(logicalLink), ...args)
      }
    }
    return result
  }
}
