# DSH 分级配置 · TUI

dsh-TUI 的终端菜单，使用 `dsh-tiered-plugin-core` 管理客户端、工作区、会话及下级默认配置。只适用于 TUI 的 DSH 后端。与 Web、dsh-go 挂在同一 DSH 宿主时，共用核心和插件实例。

安装 `dsh-tiered-plugin-tui` 后，在 TUI 的侧栏面板选择器中打开“分级配置”。使用宿主 React、公共面板接口和对话框，不附带另一套终端渲染器。

| 按键 | 操作 |
| --- | --- |
| `1 / 2 / 3` | 插件 / MCP / Skill |
| `l` | 选择客户端、工作区或当前会话 |
| `c` | 本级 / 下级默认 |
| `d` | 下级默认：继承 / 独立 |
| `↑ / ↓`、`Enter` | 选择项目、开关或查看包内组件 |
| `e` | 编辑一个配置字段，输入 JSON 值 |
| `a` | 添加 MCP（JSON） |
| `b / r` | 返回列表 / 刷新 |
| `g` | 工作区树继承、插件隔离总设置 |

配置字段通过宿主单行对话框编辑。较长字段会提示使用 Web 菜单，避免输入框截断数据。插件自己提供的 Web 设置组件不能直接在终端绘制，终端使用相同的配置数据。依赖和自兼容性确认仍由共享核心处理。

本次通过宿主 React 渲染与键盘交互测试；真实终端的视觉与按键组合仍需实机验证。

MIT License。

## English

A native dsh-TUI panel for the DSH backend, sharing the tiered core with Web and mobile adapters in the same host. Open **分级配置** in the sidebar panel picker. `1/2/3` switches resource type, `l` selects scope, `c` selects own/child defaults, `d` toggles independent defaults, Enter changes state, `e` edits a JSON field, and `g` opens manager options. Long fields must be edited through Web; third-party Web settings components are not rendered in a terminal. Headless interaction tests passed; live terminal verification remains pending.
