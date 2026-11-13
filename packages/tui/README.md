# DSH 分级配置 · TUI

dsh-TUI 的终端菜单，使用 `dsh-tiered-plugin-core` 管理客户端、工作区、会话及下级默认配置。只适用于 TUI 的 DSH 后端。与 Web、dsh-go 挂在同一 DSH 宿主时，共用核心和插件实例。

## 安装

0.2.0 起只需在 TUI 使用的 DSH profile 中安装一个包：

```sh
dsh plugin --profile <profile> add dsh-tiered-plugin-tui
```

把 `<profile>` 换成实际名称。共享核心组件随包声明，并自动登记到 Harness 的包管理器；不再需要 0.1.0 的第二条核心安装命令。按照提示重启后，在侧栏面板选择器打开「分级配置」。

核心和界面分别显示版本、分别检查更新。Web 同时连接同一宿主时，两个界面共用核心和后台实例。核心在自己的 Context 内挂载后端，遵守 TUI 的根能力限制。

| 按键 | 操作 |
| --- | --- |
| `1 / 2 / 3 / 4` | 插件 / 官方插件 / MCP / Skill |
| `l` | 选择客户端、工作区或当前会话 |
| `c` | 本级 / 下级默认 |
| `d` | 下级默认：继承 / 独立 |
| `↑ / ↓`、`Enter` | 选择项目、开关或查看包内组件 |
| `e` | 编辑一个配置字段，输入 JSON 值 |
| `a` | 添加 MCP（JSON） |
| `b / r` | 返回列表 / 刷新 |
| `g` | 工作区树继承、插件隔离总设置 |

配置字段通过宿主单行对话框编辑。较长字段会提示使用 Web 菜单，避免输入框截断数据。插件自己提供的 Web 设置组件不能直接在终端绘制，终端使用相同的配置数据。依赖和自兼容性确认仍由共享核心处理。

已在 Ubuntu 虚拟机加载实际 dsh-TUI 0.19.0 + DSH 0.2.2-rc.1，检查面板、对话框、配置保存、MCP/Skill、下级默认与窄终端显示，并验证 Web/TUI 双向共享配置。该 TUI 版本自身的声明尚不接受 rc.2；没有改动其版本声明。Android 测试不包含在此结果中。

MIT License。

## English

From 0.2.0, install only `dsh-tiered-plugin-tui` in the DSH profile used by TUI. The bundle includes a core component and automatically registers the shared host through native package management. The extra core installation required by 0.1.0 is no longer needed. Restart if requested, then open **分级配置** in the sidebar panel picker.

Core and interface versions update independently. Interfaces on the same DSH host share one backend. The core mounts beneath its own Context, without using root capabilities from TUI plugin activation. Keys: `1/2/3/4` resource type (plugins, official plugins, MCP, Skills), `l` scope, `c` own/child defaults, `d` independent defaults, Enter state, `e` edit a JSON field, `g` manager settings. Long fields and third-party Web settings components should be edited in Web.

The earlier live UI verification used dsh-TUI 0.19.0 with DSH rc.1; that upstream TUI release does not declare rc.2 support. See the repository's validation reports for the tested versions.
