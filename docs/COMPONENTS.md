# 多界面组件架构

原包拆为四个 npm workspace，按组件分别版本化。

```text
packages/core     dsh-tiered-plugin-core       0.9.0
packages/web      dsh-tiered-plugin-menu       0.9.0
packages/tui      dsh-tiered-plugin-tui        0.2.0
packages/dsh-go   dsh-tiered-plugin-go         0.2.0
```

三个界面都依赖 `dsh-tiered-plugin-core: ^0.9.0`。后端从构建产物外部导入核心，未把它打成三份副本。浏览器只打包可在浏览器运行的类型/协议辅助代码；TUI 使用宿主 React，dsh-go 输出原生 JSON 组件。

## 同宿主共享

每个界面 bundle 声明两行：`dsh-tiered-plugin-core/component` 和自身界面。各端核心组件的行 ID 不同，可单独卸载或更新某个界面而不误删另一端的核心引用。

共享核心的独立 bundle 声明 `dsh-tiered-plugin-core/host`，提供 `tieredCore` 服务。界面中的核心组件向它取得使用引用；后端挂在核心宿主的 Context 下。多个引用共用一个管理器，最后一个引用释放时回收后台实例。核心更新时，依赖它的引用自动释放并在新宿主出现后重新连接。TUI 无需使用禁止的根节点挂载能力。

第一次启用界面组件时，通过官方 `pluginManager.installBundle` 自动将核心登记为 profile 的直接依赖并启用。仅有 npm 间接依赖不会出现在原生更新列表中。在客户端安装过程中，登记等到 `plugin-manager/operation` 的完成事件再执行，避免继承 HMR 的异步事务上下文而触发嵌套事务错误。

核心的宿主行不重复声明在界面 bundle 中：DSH 更新前会卸载目标包，如果同一行仍被另一个 bundle 持有，会拒绝更新并报 `bundle-in-use`。当前的宿主与引用组件分工避免了这个问题。

原有 `acquireCore()` 和直接挂载核心的入口继续保留。新界面使用声明的组件，不需要自行挂载后端。

依赖树中出现两份兼容核心时，也通过版本化的全局符号共享同一个管理器和路由归属标记。此约定用于兼容的 API，未来破坏性更改需要新协议标识和明确迁移。

分别启动两个 DSH 进程会创建两个宿主；共享目录不等于共享内存。此实现没有另造跨进程服务器。终端适配只针对 dsh-TUI 的 DSH 后端。

配置继续使用 `DSH_HOME/plugins/tiered-plugin-menu.json`，各实例数据继续使用已有隔离目录。不在关闭界面、释放实例或普通卸载时删除持久化数据；DSH 更新也会经过移除/重装。

## 原生界面注册

dsh-go 原生桥接按包名和组件 ID 注册。插件在不同会话启用时，其面板 ID 通常相同，原生注册会覆盖先前实例。

适配器调用核心的 `adaptService` 接缝，并包装公开 `dshGo` 注册方法。面板、动作和数据按核心已有的会话归属判断选择实例；已有实例在适配器加入后重新注册。数据源在配置范围变更时释放并切换。注册的生命周期跟随核心，关闭 Web 或手机中的一个界面不会拆掉其他界面正在使用的路由。

覆盖 `panel`、`on`、`strip`、`turnNote`、`media`、`micro`、`onCapability`。其他方法继续使用宿主原实现。没有修改 dsh-go 或第三方插件源码，没有插件名称适配表。原生贡献清单是包级接口，因此未启用范围可能仍显示入口，入口内容提示未启用。固定端口、插件自己启动的外部进程等不由此接口隔离。

## 构建与独立更新

```sh
npm ci --ignore-scripts
npm run check
npm run pack
npm run pack -- core
```

安装包输出到根目录 `dist/`。在开发测试中，未发布的核心需与界面一起安装，可用包管理器的本地 override 指向核心 tarball；不要把 `file:` 开发路径写进发布的组件依赖。

只发布核心修复的流程：

```sh
npm version patch --workspace dsh-tiered-plugin-core --no-git-tag-version
npm run check
npm run pack -- core
# 人工核对 tarball 后发布该核心包，并使用 core-v<version> 标签
```

主安装 Release 使用 `v<web-version>`，附件列出各端自身版本；核心独立 Release 使用 `core-v<version>` 并标为「组件更新」，不设为 Latest。主安装 Release 保持 Latest，避免把核心包误认为完整界面安装包。不批量提升未改动的界面版本。已有用户在 Harness 刷新检查更新，并按宿主提示重启。

本次从 0.7.1 的原生升级、核心独立更新和多端关闭/重开验证见 [双组件升级验证](COMPONENT_UPDATES.md)。下列 UI 测试是 0.8.0 阶段的历史基线，不能等同于本次重新测试整个终端和 Android 界面。

## 已完成验证与待测项

已在隔离虚拟机加载实际 TUI/Web，并用 Android 模拟器运行官方 dsh-go APK 连接测试后端；没有调用付费模型 API。Web 与核心修复也已装入本机 DSH。详细过程、问题与截图见 [实际界面验证](LIVE_UI_TESTING.md)。

- 原桌面回归覆盖 DSH rc.1 SDK、真实第三方插件、实例隔离、MCP、Skill、React/jsdom；新增显式核心生命周期、禁用缺失组件和 Loader 表达式用例。
- 共享核心：三个界面、兼容核心副本、交错关闭/打开、最后释放、重开恢复。
- TUI：使用宿主 React 的键盘操作、二次确认取消/确认、字段配置、切换会话、下级默认。官方准入校验结果为 `compatible`。
- dsh-go：官方 NativeCore 对照先复现同名覆盖，再验证按会话读取/点击、关闭继承插件撤下数据订阅、重读静态视图，关闭 A 不会断开 B 的原生数据流；官方 SDK 校验菜单、JSON 保存、无手势的层级选择、本级/下级及资源标签。
- 实际 rc.2 runtime：在独立 profile 安装四个 tarball，加载三个适配入口，确认同一核心；MCP 分层、子/孙代理默认继承、Skill 覆盖和工作区预设目录通过。

实际界面验证：Ubuntu 虚拟机中加载 dsh-TUI 0.19.0 + DSH rc.1，Web 同进程运行；模板双向编辑、MCP 发现、Skill 工作区覆盖与会话关闭、下级默认、关闭 Web 后继续使用 TUI、重启读回和宽窄布局已检查。修复了显式核心挂载、禁用缺失组件、Loader 表达式读取，以及终端中“部分启用”的状态显示。官方 TUI 0.19.0 的版本声明不接受 rc.2，因此这次 TUI 实测使用 rc.1。

Android 实测：官方 1.0.15 APK / Android 15 模拟器，经 SSH 连接实际 DSH rc.2。分级 Skill、会话 MCP、原生 Toolbox 的独立启用与动作、下级默认、完整 App/后端冷启动恢复通过。修复了即时层级切换提前刷新导致的“未保存”误报。

尚未验证：物理 Android 手机、手机本地 PRoot 引擎、大规模外部插件在三个前端同时打开时的混装矩阵。旧的混装矩阵不能代替这次新平台的完整实机验证。

官方源码检验版本：

- [dsh-Go](https://github.com/ccch1mneyyy/dsh-Go)：`5d55732780925f05dacdee58ef102999f8ddf9bd`。
- [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI)：`66418b7bf4e0691a200a6f2e19e046ad18b68e10`，固定 dsh-std `614dfa1ac168db79fcf4577cf0ebb34e2e3b944b`。

复现官方 SDK 校验：

```sh
npm run test:go -- /path/to/dsh-Go
# 在已构建其固定 dsh-std 的 dsh-TUI/tui-profile 目录运行：
node scripts/conformance.mjs --manifest /path/to/this-repo/packages/tui/dsh-plugin.json --no-build
```

## English

Four independently versioned packages share one backend per DSH process. Each interface bundle declares a core lease component and its interface. The separately managed core bundle provides a host. It owns the backend under its own Context, including in TUI; the last interface lease releases runtime instances. Existing direct-core APIs remain available.

The core registers with native package management after the interface install transaction finishes. This avoids nested HMR transactions and lets the host update the core without removing a row still owned by another bundle. Existing settings and custom paths are preserved. Separate DSH processes are not merged.

The mobile adapter routes public native contributions by session, including live data lifecycles. The TUI adapter uses host React and public panel/dialog services. Neither changes upstream code. Native package-level contribution visibility and bounded editor inputs remain host limitations.

Build with `npm run check`; package all components with `npm run pack`, or only one with `npm run pack -- core`. Publish changed components independently. The core is automatically registered as a direct profile dependency so Harness can update it separately. Native updates may require a restart after package mappings move. Official bridge/SDK checks and an isolated real rc.2 runtime passed. Live VM testing additionally covered TUI 0.19.0 on rc.1 and Web sharing that host, with screenshots. The interface component enables the core host automatically; no extra TUI core installation is required. Live Android 15 emulator checks with the official 1.0.15 APK and a VM SSH backend covered scoped edits, MCP, native Toolbox actions and full cold restoration. Physical phones, local PRoot and the expanded multi-platform plugin matrix remain pending.
