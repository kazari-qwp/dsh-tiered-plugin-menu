import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { DirectoryView } from '../src/directory-view.ts'

test('directory mounts preserve relative paths, .. and realpath for two independent instances', async () => {
  const lab = fs.mkdtempSync(path.resolve('work/directory-view-'))
  const data = path.join(lab, 'data'), logical = path.join(data, 'plugin')
  fs.mkdirSync(logical, { recursive: true })
  fs.writeFileSync(path.join(data, 'shared.txt'), 'SHARED')
  fs.writeFileSync(path.join(logical, 'client.txt'), 'CLIENT')
  const a = new DirectoryView(path.join(lab, 'instances', 'A'))
  const b = new DirectoryView(path.join(lab, 'instances', 'B'))
  const relative = path.relative(process.cwd(), logical)
  await Promise.all([a, b].map(async (view, index) => {
    await view.promises.mkdir(relative, { recursive: true })
    await view.promises.writeFile(path.join(relative, 'value.txt'), String(index))
    assert.equal(view.fs.readFileSync(path.join(logical, 'sub', '..', 'value.txt'), 'utf8'), String(index))
    assert.equal(await view.promises.readFile(path.join(relative, '..', 'shared.txt'), 'utf8'), 'SHARED')
    assert.equal(view.fs.existsSync(path.join(logical, 'client.txt')), false)
    for (const input of [relative, logical, pathToFileURL(logical)]) {
      assert.equal(view.fs.realpathSync(input), logical)
      assert.equal(view.fs.realpathSync.native(input), logical)
      assert.equal(await view.promises.realpath(input), logical)
      assert.equal(await promisify(view.fs.realpath)(input), logical)
    }
    const canonical = view.fs.realpathSync(relative)
    assert.equal(view.fs.readFileSync(path.join(canonical, 'value.txt'), 'utf8'), String(index))
    assert.equal(view.fs.readFileSync(path.join(canonical, '..', 'shared.txt'), 'utf8'), 'SHARED')
    assert.equal((await view.promises.realpath(relative, { encoding: 'buffer' })).toString(), logical)
    for (const item of view.fs.readdirSync(relative, { withFileTypes: true })) assert.equal(item.parentPath, logical)
    const dir = await view.promises.opendir(relative)
    assert.equal(dir.path, logical)
    for await (const item of dir) assert.equal(item.parentPath, logical)
    assert.throws(() => view.fs.readFileSync(path.join(logical, 'absent')), error => {
      assert.ok(error instanceof Error)
      assert.ok(!error.message.includes('instances'))
      return true
    })
  }))
  assert.equal(fs.readFileSync(path.join(logical, 'client.txt'), 'utf8'), 'CLIENT')
  assert.equal(fs.existsSync(path.join(logical, 'value.txt')), false)
  assert.equal(new DirectoryView(a.root).fs.readFileSync(path.join(logical, 'value.txt'), 'utf8'), '0')
  const temporary = await a.promises.mkdtemp(path.join(data, 'scratch-'))
  a.fs.writeFileSync(path.join(temporary, 'value'), 'TEMP')
  assert.equal(a.fs.readFileSync(path.join(temporary, 'value'), 'utf8'), 'TEMP')
  assert.equal(a.fs.realpathSync(temporary), temporary)
  assert.equal(fs.existsSync(temporary), false, 'mkdtemp must also create its directory in the private view')
  const sibling = path.join(data, 'plugin-other')
  fs.mkdirSync(sibling); fs.writeFileSync(path.join(sibling, 'shared.txt'), 'SIBLING')
  assert.equal(a.fs.readFileSync(path.join(sibling, 'shared.txt'), 'utf8'), 'SIBLING')
  a.fs.mkdirSync(path.join(logical, 'nested'), { recursive: true })
  a.fs.symlinkSync(path.join(logical, 'nested'), path.join(logical, 'alias'), 'junction')
  assert.equal(a.fs.realpathSync(path.join(logical, 'alias')), path.join(logical, 'nested'))
  a.fs.writeFileSync(path.join(a.fs.realpathSync(path.join(logical, 'alias')), 'test'), 'LINK')
  assert.equal(a.fs.readFileSync(path.join(logical, 'nested', 'test'), 'utf8'), 'LINK')
})
