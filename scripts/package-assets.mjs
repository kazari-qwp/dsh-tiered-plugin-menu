import { copyFileSync, cpSync } from 'node:fs'

for (const name of ['README.md', 'README.en.md', 'screenshots.json', 'THIRD_PARTY_NOTICES.txt']) {
  copyFileSync(name, `packages/web/${name}`)
}
cpSync('docs/images', 'packages/web/docs/images', { recursive: true })
copyFileSync('THIRD_PARTY_NOTICES.txt', 'packages/core/THIRD_PARTY_NOTICES.txt')
