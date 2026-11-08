import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// 嵌入原客户端，注册和样式归本包管理，不要求第三方全局启用。
export function originalClient(specifier: string, imports: string[], owner: string) {
  const virtual = `\0original-client:${specifier}`
  const packageName = specifier.replace(/\/client$/, '')
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return {
    name: 'original-client',
    resolveId(id: string) { if (id === specifier) return virtual },
    load(id: string) {
      if (id !== virtual) return
      const source = readFileSync(createRequire(import.meta.url).resolve(specifier), 'utf8')
        // CSS 内容不变；独立的归属和去重键保证任一方卸载都不影响另一方。
        .replace(new RegExp('([`\'\"])' + escaped + '/([^`\'\"\\r\\n]+\\.css)\\1', 'g'),
          (_match, quote, path) => `${quote}${owner}/embedded/${packageName}/${path}${quote}`)
        .replace(new RegExp('\\.dataset\\.plugin\\s*=\\s*([`\'\"])' + escaped + '\\1', 'g'),
          `.dataset.plugin=${JSON.stringify(owner)}`)
      return `${imports.map((name, index) => `import * as dep${index} from ${JSON.stringify(name)};`).join('\n')}
const dependencies = { ${imports.map((name, index) => `${JSON.stringify(name)}: dep${index}`).join(',')} };
let client;
const register = ({ factory }) => { client = factory(name => dependencies[name]); };
${source.replace('window.__ModuleLoader__.load(', 'register(').replace(/\/\/# sourceMappingURL=.*$/m, '')}
export const apply = client.apply;
export const inject = client.inject;
`
    },
  }
}
