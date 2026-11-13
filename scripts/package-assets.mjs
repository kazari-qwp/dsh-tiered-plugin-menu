import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'

for (const name of ['README.md', 'README.en.md']) {
  const readme = readFileSync(name, 'utf8').replaceAll('](docs/images/',
    '](https://raw.githubusercontent.com/kazari-qwp/dsh-tiered-plugin-menu/master/docs/images/')
  writeFileSync(`packages/web/${name}`, readme)
}
copyFileSync('THIRD_PARTY_NOTICES.txt', 'packages/web/THIRD_PARTY_NOTICES.txt')
copyFileSync('THIRD_PARTY_NOTICES.txt', 'packages/core/THIRD_PARTY_NOTICES.txt')
