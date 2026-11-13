import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const repository = 'kazari-qwp/dsh-tiered-plugin-menu'
const repoUrl = `https://github.com/${repository}`
export const components = [
  { id: 'web', name: '桌面 / Web', package: 'dsh-tiered-plugin-menu', mark: '01',
    description: '在 DeepSeek Harness 桌面端或浏览器中使用。',
    instruction: '在「插件 → 添加插件」中输入包名', command: 'dsh-tiered-plugin-menu' },
  { id: 'tui', name: 'TUI', package: 'dsh-tiered-plugin-tui', mark: '02',
    description: '在 dsh-TUI 终端界面中使用。',
    instruction: '将 <profile> 替换成 TUI 实际使用的 profile',
    command: 'dsh plugin --profile <profile> add dsh-tiered-plugin-tui' },
  { id: 'go', name: 'dsh-go', package: 'dsh-tiered-plugin-go', mark: '03',
    description: '在 dsh-go 原生界面中使用，包括 Android 客户端。',
    instruction: '在客户端的插件管理中安装', command: 'dsh-tiered-plugin-go' },
  { id: 'core', name: '共享核心', package: 'dsh-tiered-plugin-core', mark: '04',
    description: '由界面包自动安装。通常无需手动下载，可在 Harness 中独立更新。' },
]

const compareVersions = (a, b) => {
  const left = a.version.split('.').map(Number), right = b.version.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return right[i] - left[i]
  return 0
}

// Group by the asset's package/version, not the release tag, date or GitHub's Latest flag.
export function collectDownloads(releases) {
  return components.map(component => {
    const versions = new Map()
    const pattern = new RegExp(`^${component.package}-(\\d+\\.\\d+\\.\\d+)\\.tgz$`)
    for (const release of releases) {
      if (release.draft || release.prerelease) continue
      for (const asset of release.assets) {
        const match = asset.name.match(pattern)
        if (!match || versions.has(match[1])) continue
        versions.set(match[1], { version: match[1], name: asset.name, size: asset.size,
          url: asset.browser_download_url, notes: release.html_url,
          date: release.published_at, digest: asset.digest })
      }
    }
    return { ...component, downloads: [...versions.values()].sort(compareVersions) }
  })
}

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const size = bytes => bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(2)} MB` : `${(bytes / 1_000).toFixed(1)} KB`
const date = value => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
const link = (url, text, className = '') => `<a class="${className}" href="${escape(url)}">${text}</a>`

function card(component) {
  const latest = component.downloads[0]
  const history = component.downloads.slice(1)
  return `<article class="component" id="${component.id}" aria-labelledby="${component.id}-title">
    <div class="component-heading"><span class="number">${component.mark}</span>
      <h2 id="${component.id}-title">${component.name}</h2>${latest ? `<span class="version">v${latest.version}</span>` : ''}</div>
    <p class="description">${component.description}</p>
    ${latest ? `<div class="download-row">${link(latest.url, '下载安装包 <span aria-hidden="true">↓</span>', 'button primary')}
      ${link(latest.notes, '更新记录 ↗', 'text-link')}
      <span class="meta">${size(latest.size)} · ${date(latest.date)}</span></div>
      <p class="filename">${escape(latest.name)}</p>` : '<p>暂无正式安装包，请查看 GitHub 发布记录。</p>'}
    ${component.command ? `<div class="install"><p>${escape(component.instruction)}</p>
      <div class="command"><code id="${component.id}-command">${escape(component.command)}</code><button type="button" class="copy" data-copy="${component.id}-command" hidden>复制</button></div></div>` : ''}
    ${latest?.digest ? `<details class="checksum"><summary>SHA-256 校验值</summary><code>${escape(latest.digest.replace(/^sha256:/, ''))}</code></details>` : ''}
    ${history.length ? `<details class="history"><summary>历史版本 <span>${history.length}</span></summary>
      <ul>${history.map(item => `<li><div><strong>v${item.version}</strong><span class="meta">${date(item.date)} · ${size(item.size)}</span></div>
        <div class="history-links">${link(item.notes, '更新记录')}${link(item.url, '下载 ↓', 'history-download')}</div></li>`).join('')}</ul></details>` : ''}
  </article>`
}

export async function fetchReleases() {
  const releases = []
  for (let page = 1; ; page++) {
    const headers = { Accept: 'application/vnd.github+json' }
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`, { headers })
    if (!response.ok) throw new Error(`GitHub Releases: HTTP ${response.status}`)
    const batch = await response.json()
    releases.push(...batch)
    if (batch.length < 100) return releases
  }
}

async function build() {
  const input = process.argv[2]
  const releases = input ? JSON.parse(await readFile(input, 'utf8')) : await fetchReleases()
  const catalog = collectDownloads(releases)
  if (catalog.some(component => !component.downloads.length)) throw new Error('A component has no published downloads; keeping the previous site.')
  const template = await readFile(new URL('./index.html', import.meta.url), 'utf8')
  const html = template.replace('<!-- INTERFACES -->', catalog.slice(0, 3).map(card).join('\n'))
    .replace('<!-- CORE -->', card(catalog[3]))
    .replaceAll('%%REPO%%', repoUrl)
  await mkdir('_site', { recursive: true })
  await writeFile('_site/index.html', html)
  await writeFile('_site/downloads.json', JSON.stringify(catalog, null, 2) + '\n')
  for (const file of ['style.css', 'copy.js', 'favicon.svg']) await copyFile(new URL(file, import.meta.url), `_site/${file}`)
  console.log(catalog.map(item => `${item.package}: ${item.downloads[0].version} (${item.downloads.length} versions)`).join('\n'))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build()
