# DSH 分级配置 · TUI

dsh-TUI 的终端菜单，使用 `dsh-tiered-plugin-core` 管理客户端、工作区、会话及下级默认配置。只适用于 TUI 的 DSH 后端。与 Web、dsh-go 挂在同一 DSH 宿主时，共用核心和插件实例。

在 TUI 的 DSH profile 中同时启用 `dsh-tiered-plugin-core` 和 `dsh-tiered-plugin-tui` 两个 bundle，核心放在 TUI 之前。npm 依赖会安装核心文件，但不等于启用其 DSH 入口。随后在侧栏面板选择器中打开“分级配置”。使用宿主 React、公共面板接口和对话框，不附带另一套终端渲染器。

TUI 禁止界面插件通过 `ctx.root.plugin` 挂载其他组件，因此由显式核心入口持有后端；TUI 面板等待 `tieredPlugins` 服务就绪。Web 同时打开时使用这同一份核心。

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

已在 Ubuntu 虚拟机加载实际 dsh-TUI 0.19.0 + DSH 0.2.2-rc.1，检查面板、对话框、配置保存、MCP/Skill、下级默认与窄终端显示，并验证 Web/TUI 双向共享配置。该 TUI 版本自身的声明尚不接受 rc.2；没有改动其版本声明。Android 测试不包含在此结果中。

MIT License。

## English

A native dsh-TUI panel for the DSH backend. Enable both the core and TUI adapter bundles in the DSH profile, with the core before TUI. The explicit core owns the backend without violating TUI's root-mutation restriction. Open **分级配置** in the sidebar panel picker. `1/2/3` switches resource type, `l` selects scope, `c` selects own/child defaults, `d` toggles independent defaults, Enter changes state, `e` edits a JSON field, and `g` opens manager options. Long fields must be edited through Web; third-party Web settings components are not rendered in a terminal. Live VM testing used dsh-TUI 0.19.0 with DSH rc.1, including bidirectional Web/TUI configuration sharing. This upstream TUI release does not declare rc.2 support.
