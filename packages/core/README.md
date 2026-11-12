# DSH 分级管理核心

供 Web、dsh-TUI 和 dsh-go 界面共用的后端组件，负责插件、MCP、Skill 的分级配置、继承、依赖检查与实例生命周期。

通常只需安装对应界面包，它会自动依赖此包。同一 DSH 宿主中，无论打开多少种界面，只运行一份管理核心。最后一个界面退出时才释放核心；由独立核心入口启动的服务也可保持后台运行。

```ts
import { acquireCore } from 'dsh-tiered-plugin-core'
const manager = await acquireCore(ctx)
```

配置继续保存在 `DSH_HOME/plugins/tiered-plugin-menu.json`。界面间共享数据，但不同 DSH 进程各有自己的运行实例。此包独立发布，兼容修复不要求所有界面包一起发版。

MIT License。完整说明见 [项目仓库](https://github.com/kazari-qwp/dsh-tiered-plugin-menu)。

## English

Shared backend for per-client, workspace and session plugin, MCP and Skill configuration. Web, TUI and mobile adapters acquire the same manager within one DSH host. The last lease releases it; background instances remain while another adapter or the standalone core is active. Versions are independent. Existing configuration paths are preserved. Separate DSH processes do not share an in-memory manager.
