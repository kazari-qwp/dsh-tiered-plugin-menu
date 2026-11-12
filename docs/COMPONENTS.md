# 多界面组件架构

本开发分支把原包拆为四个 npm workspace，尚未发布这些新组件。

```text
packages/core     dsh-tiered-plugin-core       0.8.0
packages/web      dsh-tiered-plugin-menu       0.8.0
packages/tui      dsh-tiered-plugin-tui        0.1.0
packages/dsh-go   dsh-tiered-plugin-go         0.1.0
```

三个界面都依赖 `dsh-tiered-plugin-core: ^0.8.0`。后端从构建产物外部导入核心，未把它打成三份副本。浏览器只打包可在浏览器运行的类型/协议辅助代码；TUI 使用宿主 React，dsh-go 输出原生 JSON 组件。

## 同宿主共享

界面调用 `acquireCore(ctx, config)` 取得管理器。共享状态以 DSH 根 Context 为键，每个界面持有一个引用。关闭单个界面不影响其他界面和后台实例；最后一个引用释放后关闭核心。最后一次释放与新界面打开交错时，新界面等待旧核心完成释放。

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
# 人工核对 tarball 后发布该核心包，并使用 core/v0.8.x 标签
```

Web、TUI、Go 使用各自版本与标签：`web/v…`、`tui/v…`、`go/v…`。不批量提升未改动的界面版本。核心兼容更新无需重发界面，但已有安装仍须通过包管理器更新依赖并重启宿主；锁文件不会因发布自动变化。

## 已完成验证与待测项

本轮没有启动虚拟机，没有向个人 DSH profile 安装新组件，没有调用模型 API。

- 完整回归 58 项通过；原桌面功能：DSH rc.1 SDK、真实第三方插件、实例隔离、MCP、Skill、React/jsdom。
- 共享核心：三个界面、兼容核心副本、交错关闭/打开、最后释放、重开恢复。
- TUI：使用宿主 React 的键盘操作、二次确认取消/确认、字段配置、切换会话、下级默认。官方准入校验结果为 `compatible`。
- dsh-go：官方 NativeCore 对照先复现同名覆盖，再验证按会话读取/点击、关闭继承插件撤下数据订阅、重读静态视图，关闭 A 不会断开 B 的原生数据流；官方 SDK 校验菜单、JSON 保存、无手势的层级选择、本级/下级及资源标签。
- 实际 rc.2 runtime：在独立 profile 安装四个 tarball，加载三个适配入口，确认同一核心；MCP 分层、子/孙代理默认继承、Skill 覆盖和工作区预设目录通过。

尚未验证：实际 TUI 的终端视觉/键位表现、Android 真机或模拟器界面、大规模外部插件在三个前端同时打开时的混装矩阵。旧的混装矩阵不能代替这次新平台的完整实机验证。

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

Four independently versioned packages share one backend within a DSH root Context. Adapters hold leases; the last lease disposes the core. Compatible duplicate core installations share the same process-level registry. Separate DSH processes are not merged. Existing settings and data paths are preserved.

The mobile adapter routes public native contributions by session, including live data lifecycles. The TUI adapter uses host React and public panel/dialog services. Neither changes upstream code. Native package-level contribution visibility and bounded editor inputs remain host limitations.

Build with `npm run check`; package all components with `npm run pack`, or only one with `npm run pack -- core`. Publish changed components independently. Existing lockfiles require an explicit dependency update. Official bridge/SDK checks and an isolated real rc.2 runtime passed; live terminal/Android testing and the expanded multi-platform plugin matrix remain pending.
