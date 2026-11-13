import test from 'node:test'
import assert from 'node:assert/strict'
import { collectDownloads } from './build.mjs'

const release = (names, extra = {}) => ({ published_at: '2026-11-13T03:39:23Z', html_url: 'https://github.com/example/releases/tag/test',
  assets: names.map(name => ({ name, size: 100, browser_download_url: `https://github.com/example/releases/download/test/${name}` })), ...extra })

test('a core-only release never replaces the latest download for an interface', () => {
  const results = collectDownloads([
    release(['dsh-tiered-plugin-core-0.9.1.tgz']),
    release(['dsh-tiered-plugin-menu-0.9.0.tgz', 'dsh-tiered-plugin-tui-0.2.0.tgz', 'dsh-tiered-plugin-go-0.2.0.tgz']),
    release(['dsh-tiered-plugin-core-0.9.0.tgz']),
  ])
  assert.deepEqual(results.map(item => item.downloads[0].version), ['0.9.0', '0.2.0', '0.2.0', '0.9.1'])
})

test('historical re-publications, duplicate attachments and previews do not displace the newest stable version', () => {
  const results = collectDownloads([
    release(['dsh-tiered-plugin-menu-0.9.0.tgz']),
    release(['dsh-tiered-plugin-menu-1.0.0.tgz'], { draft: true }),
    release(['dsh-tiered-plugin-menu-0.11.0.tgz'], { prerelease: true }),
    release(['dsh-tiered-plugin-menu-0.10.0.tgz', 'dsh-tiered-plugin-menu-0.11.0-rc.1.tgz', 'SHA256SUMS']),
    release(['dsh-tiered-plugin-menu-0.9.0.tgz']),
  ])
  assert.deepEqual(results[0].downloads.map(item => item.version), ['0.10.0', '0.9.0'])
})
