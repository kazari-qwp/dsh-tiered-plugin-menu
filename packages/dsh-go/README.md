# DSH 分级配置 · dsh-go

dsh-go 原生 JSON 界面的分级菜单。依赖 `dsh-tiered-plugin-core`，在“分级配置”会话标签页或功能页中管理插件、MCP、Skill，以及本级/下级默认。

其他插件通过公开 `dshGo` 服务注册的面板、数据、动作、状态条、回合注释及能力事件，按当前会话转发给对应实例。同一插件的多个实例不会用同名面板覆盖对方。插件的数据目录和后端注册继续使用共享核心的隔离机制；没有按第三方插件名称编写适配。

安装 `dsh-tiered-plugin-go`，并启用 dsh-go 的原生桥接。菜单在桥接服务出现时加载。与 Web、TUI 共用同一 DSH 宿主时，共用一份核心。

配置用 JSON 表单编辑；手机宿主对输入和事件大小有限制，超过限制的配置应在 Web 中修改。原生插件贡献清单目前是包级别的，没有会话级隐藏接口，因此未启用范围仍可能看到入口；其视图会提示未启用，操作不会送往别的会话。

使用官方 SDK 和桥接源码完成了同名原生面板、不同会话配置、数据订阅清理、表单和动作校验。Android 真机/模拟器视觉验证尚未进行。固定端口、直接绕过服务注册的共享外部状态仍不保证隔离。

MIT License。

## English

Native dsh-go tiered settings for plugins, MCP and Skills. The adapter routes public `dshGo` registrations to the instance selected for the current session, including views, actions and data feeds. Same-package contributions no longer overwrite another instance. The shared core owns backend isolation and configuration; no third-party plugin names are special-cased.

Requires the native bridge. Official SDK and bridge tests pass; Android visual testing remains pending. The host's contribution inventory is package-wide, so an inactive scope may still show an entry with an inactive message. JSON input limits apply; edit oversized configurations in Web. Fixed ports and external state bypassing host services are not isolated.
