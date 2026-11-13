# DSH 分级配置共享核心

负责插件、MCP、Skill 的分级配置、继承、依赖检查与实例生命周期，供桌面/Web、TUI 和 dsh-go 共用。

通常只需安装对应端的菜单包。Web 0.9.0、TUI / dsh-go 0.2.0 会自动把这个核心包登记到 Harness 原生更新器。在「插件」页刷新即可分别检查核心和界面更新；若 Harness 提示重启，请重启后使用新核心。

核心包的 bundle 负责提供宿主入口，界面包中的核心组件持有使用引用。同一 DSH 进程只有一个运行中的管理器；关闭一个界面不影响其他界面，最后一个界面组件关闭后释放后台实例。再次启用会读取保存的配置。TUI 无需从插件调用 `ctx.root.plugin`。

配置继续保存在 `DSH_HOME/plugins/tiered-plugin-menu.json`。旧界面的自定义 `dataFile` 同样保留。不同 DSH 进程不共享内存中的管理器。

核心版本与界面独立发布。1.0.0 加入官方组合包发现、通用服务注册隔离和独立的配置保存接口：关闭时保存待用，启用时应用，运行中保存立即更新；保存不会改变启用状态。保留此前未启用插件的配置读取修复。

MIT License。完整说明见 [项目仓库](https://github.com/kazari-qwp/dsh-tiered-plugin-menu)。

## English

Shared backend for per-client, workspace and session plugin, MCP and Skill configuration. Install one interface package; Web 0.9.0 and TUI / dsh-go 0.2.0 register the core automatically with Harness's native package manager. Refresh the Plugins page to check core and interface updates independently. Restart when requested by Harness.

The core bundle provides the host. Interface components acquire leases on it, sharing one manager per DSH process. The last component releases runtime instances while retaining saved settings. Reopening restores configuration. Core activation owns its backend under its own Context, including in TUI's restricted host. Existing configuration paths and custom `dataFile` values are preserved.
