// Native config parsing only: no menu, no plugin apply, and no other sample imports.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const local = createRequire(path.join(process.cwd(),'package.json'))
const { resolveConfig } = local('@deepseek-ai/cordis')
const [name,file] = process.argv.slice(2)
const namespace = await import(pathToFileURL(local.resolve(name)))
const plugin = namespace.default ?? namespace
const results = JSON.parse(fs.readFileSync(file)).map(config=>{
  return { input: config, output: resolveConfig(plugin,config) }
})
const report = { name, menuLoaded:false, results }
fs.mkdirSync('work',{recursive:true})
fs.writeFileSync(`work/config-control-${name.replaceAll('/','-')}.json`,JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report))
