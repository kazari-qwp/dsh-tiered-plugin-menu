# DSH 分级配置 · dsh-go

dsh-go 原生 JSON 界面的分级菜单。依赖 `dsh-tiered-plugin-core`，在“分级配置”会话标签页或功能页中管理插件、MCP、Skill，以及本级/下级默认。

其他插件通过公开 `dshGo` 服务注册的面板、数据、动作、状态条、回合注释及能力事件，按当前会话转发给对应实例。同一插件的多个实例不会用同名面板覆盖对方。插件的数据目录和后端注册继续使用共享核心的隔离机制；没有按第三方插件名称编写适配。

0.2.0 起只需安装 `dsh-tiered-plugin-go`；包内声明核心和界面两个组件，自动登记共享核心，可在 Harness 中分别更新。按照提示重启，并启用 dsh-go 的原生桥接。菜单在桥接服务出现时加载。与 Web、TUI 共用同一 DSH 宿主时，共用一份核心。

配置用 JSON 表单编辑；手机宿主对输入和事件大小有限制，超过限制的配置应在 Web 中修改。原生插件贡献清单目前是包级别的，没有会话级隐藏接口，因此未启用范围仍可能看到入口；其视图会提示未启用，操作不会送往别的会话。

使用官方 SDK 和桥接源码完成了同名原生面板、不同会话配置、数据订阅清理、表单和动作校验。官方 dsh-go 1.0.15 APK 已在 Android 15 模拟器中实测，通过 SSH 连接隔离虚拟机内的 DSH rc.2：分级 Skill 编辑、会话 MCP、原生插件面板和动作、下级默认及 App/后端完整冷启动恢复通过，截图见仓库的 `docs/LIVE_UI_TESTING.md`。未测试物理手机或手机本地 PRoot 引擎。固定端口、直接绕过服务注册的共享外部状态仍不保证隔离。

MIT License。

## English

Native dsh-go tiered settings for plugins, MCP and Skills. The adapter routes public `dshGo` registrations to the instance selected for the current session, including views, actions and data feeds. Same-package contributions no longer overwrite another instance. The shared core owns backend isolation and configuration; no third-party plugin names are special-cased.

From 0.2.0, install only this interface package; its core component automatically registers the shared host. Core and interface updates are independent in Harness. Restart when requested. Requires the native bridge. Official SDK and bridge tests pass. Live testing with the official dsh-go 1.0.15 APK on an Android 15 emulator, using SSH to an isolated DSH rc.2 host, covered scoped Skill edits, session MCP, native plugin views/actions, child defaults and full App/backend cold restoration. Physical phones and local PRoot remain untested. The host's contribution inventory is package-wide, so an inactive scope may still show an entry with an inactive message. JSON input limits apply; edit oversized configurations in Web. Fixed ports and external state bypassing host services are not isolated.
