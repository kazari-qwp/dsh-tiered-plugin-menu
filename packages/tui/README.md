# DSH 分级配置 · TUI

dsh-TUI 的终端菜单，使用 `dsh-tiered-plugin-core` 管理客户端、工作区、会话及下级默认配置。只适用于 TUI 的 DSH 后端。与 Web、dsh-go 挂在同一 DSH 宿主时，共用核心和插件实例。

## 安装

只需在 TUI 使用的 DSH profile 中安装一个包：

```sh
dsh plugin --profile <profile> add dsh-tiered-plugin-tui
```

把 `<profile>` 换成实际名称。共享核心组件随包声明，并自动登记到 Harness 的包管理器。按照提示重启后，在侧栏面板选择器打开「分级配置」。

核心和界面分别显示版本、分别检查更新。Web 同时连接同一宿主时，两个界面共用核心和后台实例。核心在自己的 Context 内挂载后端，遵守 TUI 的根能力限制。

| 按键 | 操作 |
| --- | --- |
| `1 / 2 / 3 / 4` | 插件 / 官方插件 / MCP / Skill |
| `l` | 选择客户端、工作区或当前会话 |
| `c` | 本级 / 下级默认 |
| `d` | 下级默认：全部重置为继承 |
| `↑ / ↓`、`Enter` | 选择项目、开关或查看包内组件 |
| `e` | 编辑一个配置字段，输入 JSON 值 |
| `a` | 添加 MCP（JSON） |
| `b / r` | 返回列表 / 刷新 |
| `g` | 工作区树继承、插件隔离总设置 |

配置字段通过宿主单行对话框编辑。较长字段会提示使用 Web 菜单，避免输入框截断数据。插件自己提供的 Web 设置组件不能直接在终端绘制，终端使用相同的配置数据。依赖和兼容性确认仍由共享核心处理。

MIT License。

## English

Install only `dsh-tiered-plugin-tui` in the DSH profile used by TUI. The bundle includes a core component and automatically registers the shared host through native package management. Restart if requested, then open **分级配置** in the sidebar panel picker.

Core and interface versions update independently. Interfaces on the same DSH host share one backend. The core mounts beneath its own Context, without using root capabilities from TUI plugin activation. Keys: `1/2/3/4` resource type (plugins, official plugins, MCP, Skills), `l` scope, `c` own/child defaults, `d` reset all child defaults to inherit, Enter state, `e` edit a JSON field, `g` manager settings. Long fields and third-party Web settings components should be edited in Web.

完整兼容机制与验证记录 / Compatibility details and reports: [详细文档](../../docs/COMPATIBILITY.md)。
