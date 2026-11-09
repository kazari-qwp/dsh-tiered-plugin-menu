import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ScopedModules } from '../../src/scoped-modules.ts'

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
