import { useEffect, useState } from 'react'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { PluginDetailProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { coreRegistrationRequestPrefix, type CoreRegistrationStatus } from 'dsh-tiered-plugin-core/remote-contract'
import { coalesce } from './refresh.ts'

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
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const result = await remote.pluginManager.listBundles()
        if (!result.ok) throw new Error(result.error.message)
        if (active) {
          setPackages(result.value.filter(pkg => pkg.installed && names[pkg.name]
            && (packageName === 'dsh-tiered-plugin-core' || pkg.name === packageName || pkg.name === 'dsh-tiered-plugin-core')))
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
      .tiered-components button { color: inherit; background: transparent; border: 1px solid #8885; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
      .tiered-components [role="alert"] { overflow-wrap: anywhere; }
    `}</style>
    <h3>组件版本</h3>
    {packages.map(pkg => <div className="tiered-component" key={pkg.name}>
      <span>{names[pkg.name]}</span><span>{pkg.version ?? '—'}</span>
      {pkg.name !== packageName && <button onClick={() => open(pkg.name)}>管理更新</button>}
    </div>)}
    {error && <p role="alert">{error}</p>}
    <Registration remote={remote} />
    <p>在插件页点击「刷新」检查更新，核心和界面分别更新。若 Harness 提示重启，请重启后使用新版本。</p>
  </section>
}

const phaseText: Record<Extract<CoreRegistrationStatus, { state: 'working' }>['phase'], string> = {
  waiting: '正在等待安装共享核心…',
  installing: '正在安装共享核心…',
  applying: '正在应用共享核心安装…',
  enabling: '正在启用共享核心…',
  cancelling: '正在取消共享核心安装…',
}

const failureText = {
  failed: '共享核心登记失败',
  cancelled: '共享核心安装已取消',
  overridden: '共享核心启用被当前配置覆盖',
}

function Registration({ remote }: { remote: TypertClientRemote }) {
  const [status, setStatus] = useState<CoreRegistrationStatus | null>(null)
  const [refreshAttempt, requestRefresh] = useState(0)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState('')
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = coalesce(async () => {
      clearTimeout(timer)
      if (!active) return
      try {
        const result = await remote.tieredCoreRegistration?.status()
        if (!active) return
        const value = result?.ok ? result.value : null
        setStatus(value)
        // The native result can settle without another progress notification.
        if (value?.state === 'working') timer = setTimeout(refresh, 500)
      } catch { if (active) setStatus(null) }
    })
    const stopChanged = remote.$on('plugin-manager/changed', refresh)
    const stopProgress = remote.$on('plugin-manager/install-state', progress => {
      if (progress.requestId.startsWith(coreRegistrationRequestPrefix)) void refresh()
    })
    void refresh()
    return () => { active = false; clearTimeout(timer); stopProgress(); stopChanged() }
  }, [remote, refreshAttempt])

  const retry = async () => {
    setRetrying(true)
    setRetryError('')
    try {
      const result = await remote.tieredCoreRegistration.retry()
      if (!result.ok) throw new Error(result.error.message)
      setStatus(result.value)
      requestRefresh(attempt => attempt + 1)
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : String(error))
    } finally { setRetrying(false) }
  }

  if (!status) return null
  if (status.state === 'working') return <p role="status">
    {phaseText[status.phase]}{status.attempt && status.attempt.total > 1 && `（安装源 ${status.attempt.index}/${status.attempt.total}）`}
  </p>
  if (status.application === 'applied') return <p role="status">共享核心登记完成。</p>
  if (status.application === 'restart-required') return <p role="status">核心已安装，请重启 Harness 完成组件加载。原有配置会保留。</p>
  return <>
    <p role="alert">{failureText[status.application]}{status.reason && `（${status.reason}）`}</p>
    <button type="button" disabled={retrying} onClick={() => void retry()}>重试登记</button>
    {retryError && <p role="alert">重试失败（{retryError}）</p>}
  </>
}
