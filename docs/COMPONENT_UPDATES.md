# 0.9.0 双组件升级验证

目标：保留一个对应端的安装包，同时让共享核心和界面在 Harness 中分别显示版本、检查和安装更新。Web 包名不变；TUI 和 dsh-go 分别使用原来的后缀包名。

## 原生升级验收

使用 npm 已发布的 `dsh-tiered-plugin-menu@0.7.1` 原包，候选包通过仅监听 `127.0.0.1` 的临时 npm 源提供。DSH 使用实际自带 pnpm、包管理器、HMR 和 profile 存储；没有替换升级实现，也没有修改宿主或第三方插件源码。

在 Windows 上的实际 DSH **0.2.2-rc.1 和 rc.2** 中，各自使用独立临时 `DSH_HOME`，依次验证：

1. npm 来源安装 0.7.1，保存自定义 `dataFile`、工作区树开关和下级默认设置，退出进程。
2. 冷启动 0.7.1，通过原生 `listVersions` / `updateBundle`（客户端刷新、更新使用的接口）升级 Web 至 0.9.0。
3. 自动登记并启用 core 0.9.0；Web 组合包声明两个组件。无需第二次手动安装。
4. 完全重启，确认核心和界面激活，旧设置保留。
5. 安装 TUI / dsh-go 0.2.0，让三个界面共同持有同一个管理器。
6. 仅在测试源提供 core 0.9.1 测试包，使用原生更新器只更新核心。Web 仍为 0.9.0，两个其他界面仍为 0.2.0。
7. 再次冷启动，依次关闭 Web、TUI，余下界面保持同一个管理器；关闭最后一个界面释放管理器；重新打开 Web 恢复旧配置。

两版 DSH 均通过。步骤中的 **core 0.9.1 只是验证下一次独立更新的测试包，不是公开发行版本**。本次公开版本是 core / Web 0.9.0、TUI / dsh-go 0.2.0。

`npm run check` 通过：TypeScript 类型检查、构建及 **62 项回归测试**。

首次迁移和核心更新中，原生包解析器可能返回 `restart-required / package-moved`。这是正常的宿主更新结果；必须重启后使用新组件。界面详情页在核心尚未激活时也能显示组件版本和重启提示。本地 `.tgz` 来源的自动升级不在验收范围内。

## 测试中发现并修复的问题

- **`bundle-in-use`**：同一个核心宿主行重复出现在多个 bundle 中，DSH 更新前卸载时仍发现它被其他 bundle 持有。改为核心独立 bundle 持有宿主，各界面声明各自的核心引用组件。
- **嵌套 HMR 事务**：`setImmediate` 仍会继承调用方的异步事务上下文。安装期间等待原生管理操作完成事件，再调用自动核心登记。
- **TUI 根能力限制**：管理器在核心宿主的 Context 下创建，界面组件只持有引用；不要求 TUI 插件调用 `ctx.root.plugin`。

保留原有直接挂载核心及 `acquireCore()` API。组件版本界面不依赖分级管理器已启动，避免首次安装需要重启时版本和提示一起消失。

## 复现

先构建 tarball，并把 npm 原版 0.7.1 包放到 `work/dsh-tiered-plugin-menu-0.7.1.tgz`：

```powershell
npm run check
npm run pack
npm pack dsh-tiered-plugin-menu@0.7.1 --pack-destination work
node scripts/compatibility/component-upgrade.mjs E:/dsh/Harness
```

脚本在仓库 `work/` 下创建全新 profile、临时源和结果文件，不读取个人 DSH profile，不使用模型 API。

## English

Verified the unmodified npm 0.7.1 package upgrading through the native Harness update APIs to Web 0.9.0 on actual Windows DSH rc.1 and rc.2. The core is automatically registered, both components activate after a cold restart, and existing settings survive. All three interfaces then share one backend while only the core is updated using a local test-only 0.9.1 package. Closing individual interfaces preserves the others; closing the last releases runtime state, and reopening restores settings.

Tests use real pnpm, HMR and fresh profiles with a loopback registry. Core 0.9.1 in this test is not a public release. Native `package-moved` results require a restart; local-tarball automatic migration is outside the tested scope. The test report covers native update APIs and lifecycle, not a new full TUI/Android visual matrix.
