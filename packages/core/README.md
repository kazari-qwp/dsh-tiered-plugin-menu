# DSH 分级管理核心

供 Web、dsh-TUI 和 dsh-go 界面共用的后端组件，负责插件、MCP、Skill 的分级配置、继承、依赖检查与实例生命周期。

Web 和 dsh-go 界面包会依赖并取得此核心。TUI 宿主限制界面插件挂载根组件，需在 profile 中显式启用核心 bundle，再启用 TUI 适配器。同一 DSH 宿主中只运行一份管理核心。最后一个持有者退出时才释放核心；显式核心入口也是持有者，可保持后台运行。

```ts
import { acquireCore } from 'dsh-tiered-plugin-core'
const manager = await acquireCore(ctx)
```

配置继续保存在 `DSH_HOME/plugins/tiered-plugin-menu.json`。界面间共享数据，但不同 DSH 进程各有自己的运行实例。此包独立发布，兼容修复不要求所有界面包一起发版。

0.8.1 修复未加载插件的声明配置被漏读，导致整个菜单报必填字段缺失的问题。已有安装请完全退出 DSH，执行 `dsh plugin --profile desktop update dsh-tiered-plugin-core --depth 1` 后重启；将 `desktop` 换成实际 profile，并使用相同的 `DSH_HOME`。Web 0.8.0、TUI 0.1.0 和 dsh-go 0.1.0 无须升级界面包。

MIT License。完整说明见 [项目仓库](https://github.com/kazari-qwp/dsh-tiered-plugin-menu)。

## English

Shared backend for per-client, workspace and session plugin, MCP and Skill configuration. Web, TUI and mobile adapters acquire the same manager within one DSH host. The last lease releases it; background instances remain while another adapter or the standalone core is active. Versions are independent. Existing configuration paths are preserved. Separate DSH processes do not share an in-memory manager.

0.8.1 reads declared configuration for installed but inactive plugins, preventing missing-required-field errors from blocking the menu. Quit DSH, update the core with the command above using your actual profile and `DSH_HOME`, then restart. Existing Web 0.8.0, TUI 0.1.0 and dsh-go 0.1.0 adapters remain compatible.
