import { useEffect, useState } from 'react'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { PluginDetailProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'

const names: Record<string, string> = {
  'dsh-tiered-plugin-core': '共享核心',
  'dsh-tiered-plugin-menu': '桌面 / Web 界面',
  'dsh-tiered-plugin-tui': 'TUI 界面',
  'dsh-tiered-plugin-go': 'dsh-go 界面',
}

export function ComponentVersions({ subject, remote, open }: PluginDetailProps & {
  remote: TypertClientRemote; open: (name: string) => void
}) {
  const packageName = subject.kind === 'bundle' ? subject.pkg.name : ''
  return names[packageName] ? <Versions packageName={packageName} remote={remote} open={open} /> : null
}

function Versions({ packageName, remote, open }: { packageName: string; remote: TypertClientRemote; open: (name: string) => void }) {
  const [packages, setPackages] = useState<{ name: string; version?: string }[]>([])
  const [error, setError] = useState('')
  const [restart, setRestart] = useState(false)
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const result = await remote.pluginManager.listBundles()
        if (!result.ok) throw new Error(result.error.message)
        if (active) {
          setPackages(result.value.filter(pkg => pkg.installed && names[pkg.name]
            && (packageName === 'dsh-tiered-plugin-core' || pkg.name === packageName || pkg.name === 'dsh-tiered-plugin-core')))
          const core = result.value.find(pkg => pkg.name === 'dsh-tiered-plugin-core')
          setRestart(!!core?.enabled && core.rows.every(row => !row.entryId))
          setError('')
        }
      } catch (error) { if (active) setError(String(error)) }
    }
    void refresh()
    const stop = remote.$on('plugin-manager/changed', refresh)
    return () => { active = false; void stop() }
  }, [packageName, remote])
  return <section className="tiered-components">
    <style>{`
      .tiered-components { border-top: 1px solid var(--dsw-alias-border-l3, #8883); margin-top: 24px; padding-top: 20px; }
      .tiered-components h3 { font: inherit; font-weight: 600; margin: 0 0 12px; }
      .tiered-components p { font-size: 13px; opacity: .7; margin: 12px 0; }
      .tiered-component { display: flex; align-items: center; gap: 16px; padding: 10px 0; }
      .tiered-component span:first-child { flex: 1; }
      .tiered-component button { color: inherit; background: transparent; border: 1px solid #8885; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
    `}</style>
    <h3>组件版本</h3>
    {packages.map(pkg => <div className="tiered-component" key={pkg.name}>
      <span>{names[pkg.name]}</span><span>{pkg.version ?? '—'}</span>
      {pkg.name !== packageName && <button onClick={() => open(pkg.name)}>管理更新</button>}
    </div>)}
    {error && <p role="alert">{error}</p>}
    {restart && <p role="status">核心已安装，请重启 Harness 完成组件加载。原有配置会保留。</p>}
    <p>在插件页点击「刷新」检查更新，核心和界面分别更新。若 Harness 提示重启，请重启后使用新版本。</p>
  </section>
}
