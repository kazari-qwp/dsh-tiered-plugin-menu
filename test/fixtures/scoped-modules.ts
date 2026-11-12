import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { PluginPackages } from '@deepseek-ai/dsh-app-boot'
import { ScopedModules } from '../../packages/core/src/scoped-modules.ts'

test('private ESM/CommonJS dependencies bind fs, promises, createRequire and SQLite to their instance', async () => {
  const lab = fs.mkdtempSync(path.resolve('work/scoped-modules-'))
  const logical = path.join(lab, 'logical')
  fs.writeFileSync(path.join(lab, 'asset.txt'), 'ASSET')
  fs.writeFileSync(path.join(lab, 'required.mjs'), `import fs from 'node:fs';export const read=file=>fs.readFileSync(file,'utf8');`)
  fs.writeFileSync(path.join(lab, 'dep.cjs'), `
    const fs=require('fs'),esm=require('./required.mjs');let count=0;
    module.exports={read(file){return [fs.readFileSync(file,'utf8'),++count]},delete(){return 'keyword export'},esm:file=>esm.read(file)};
  `)
  fs.writeFileSync(path.join(lab, 'plugin.mjs'), `
    import {mkdirSync,writeFileSync,realpathSync} from 'node:fs';
    import {readFile} from 'node:fs/promises';
    import {DatabaseSync} from 'node:sqlite';
    import {createRequire} from 'node:module';
    import dep,{delete as remove} from './dep.cjs';
    const require=createRequire(import.meta.url);
    export const asset=new URL('./asset.txt',import.meta.url);
    export const resolved=import.meta.resolve('./dep.cjs');
    export async function run(dir,marker){
      mkdirSync(dir,{recursive:true});writeFileSync(dir+'/value.txt',marker);
      const db=new DatabaseSync(dir+'/db.sqlite');
      db.exec('CREATE TABLE IF NOT EXISTS test(value TEXT)');
      db.prepare('INSERT INTO test VALUES (?)').run(marker);
      const value=db.prepare('SELECT value FROM test').all();db.close();
      return {text:await readFile(dir+'/value.txt','utf8'),dep:dep.read(dir+'/value.txt'),
        required:require('fs').readFileSync(dir+'/value.txt','utf8'),esm:dep.esm(dir+'/value.txt'),canonical:realpathSync(dir),keyword:remove(),value};
    }
  `)
  const modules = new ScopedModules(path.join(lab, 'instances'))
  try {
    const url = pathToFileURL(path.join(lab, 'plugin.mjs')).href
    const a = await modules.import('A', url), b = await modules.import('B', url)
    assert.equal(fs.readFileSync(a.asset,'utf8'),'ASSET','paths passed to a host SDK must still refer to original package assets')
    assert.equal(a.resolved,pathToFileURL(path.join(lab,'dep.cjs')).href)
    for (const [name, plugin] of [['A', a], ['B', b]] as const) {
      const result = await plugin.run(logical, name)
      assert.equal(result.text, name)
      assert.deepEqual(result.dep, [name, 1])
      assert.equal(result.required, name)
      assert.equal(result.esm, name)
      assert.equal(result.canonical, logical)
      assert.equal(result.keyword, 'keyword export')
      assert.deepEqual(result.value.map((row: any) => row.value), [name])
    }
    assert.equal(fs.existsSync(logical), false)
  } finally { modules.dispose() }
})

test('private imports outside the repository use DSH runtime package resolution', async () => {
  // No ancestor node_modules may accidentally supply the host's SDK here.
  const lab = fs.mkdtempSync(path.join(tmpdir(), 'dsh-module-resolution-'))
  const profile = path.join(lab, 'profiles/desktop')
  const pkg = path.join(profile, 'node_modules/scoped-plugin')
  const installation = path.join(lab, 'installation')
  const sdk = path.join(installation, 'node_modules/@deepseek-ai/resolution-fixture')
  for (const dir of [pkg, sdk]) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ name: 'profile', type: 'module' }))
  fs.writeFileSync(path.join(installation, 'package.json'), JSON.stringify({ name: 'installation' }))
  fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: '@deepseek-ai/resolution-fixture', type: 'module', exports: './index.js' }))
  fs.writeFileSync(path.join(sdk, 'index.js'), 'export const singleton = {}')
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'scoped-plugin', type: 'module', main: 'index.js' }))
  fs.writeFileSync(path.join(pkg, 'index.js'), `
    import {singleton} from '@deepseek-ai/resolution-fixture';
    import {createRequire} from 'node:module';
    const require=createRequire(import.meta.url);
    let count=0;
    export {singleton};
    export const increment=()=>++count;
    export const dynamic=()=>import('@deepseek-ai/resolution-fixture');
    export const required=()=>require('@deepseek-ai/resolution-fixture');
    export const resolved=()=>import.meta.resolve('@deepseek-ai/resolution-fixture');
  `)
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(path.join(profile, 'cordis.yml')).href
  const modules = new ScopedModules(path.join(lab, 'instances'))
  try {
    await ctx.plugin(PluginPackages, { resolution: {
      profilesDir: path.join(lab, 'profiles'), profileDir: profile,
      localPackageNames: ['scoped-plugin'], linkedRoots: [],
      entries: [{ name: '@deepseek-ai/resolution-fixture', packageDir: sdk, version: '1.0.0',
        declarer: path.join(installation, 'package.json'), scope: 'installation' }],
    } })
    await ctx.plugin(Loader)
    const original = await ctx.loader.import('scoped-plugin')
    const a = await modules.load(ctx.loader, 'scoped-plugin', 'A', [])
    const b = await modules.load(ctx.loader, 'scoped-plugin', 'B', [])
    for (const instance of [a, b]) {
      assert.equal(instance.singleton, original.singleton)
      assert.equal((await instance.dynamic()).singleton, original.singleton)
      assert.equal(instance.required().singleton, original.singleton)
      assert.equal(instance.resolved(), pathToFileURL(path.join(sdk, 'index.js')).href)
      assert.equal(instance.increment(), 1)
    }
    assert.equal(a.increment(), 2)
    assert.equal(b.increment(), 2)
  } finally { modules.dispose(); await ctx.fiber.dispose() }
})
