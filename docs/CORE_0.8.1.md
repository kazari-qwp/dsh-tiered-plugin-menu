# Core 0.8.1：未加载插件的声明配置

修复与 [issue #1](https://github.com/kazari-qwp/dsh-tiered-plugin-menu/issues/1) 相同的菜单校验错误。已确认的触发条件是：插件包已经安装、客户端未启用、包内声明了必填配置。单独安装菜单后冷启动的空白环境未复现报告中的报错。

## 原因与修复

未保存分级配置时，菜单会沿继承链回退到客户端。插件尚未加载，没有运行中的 Loader entry；0.8.0 在这里使用 `{}`，遗漏了包内已有的声明配置，随后触发 `id missing required value` 等校验错误。一项校验失败会使整个列表请求失败。

0.8.1 只补上这处读取：运行配置优先，其次使用包内声明配置。显式保存的分级配置仍优先；真正缺少必填字段的配置仍会报错。没有增加跳过空值校验的分支，也没有按插件名称适配。

## 验证

- 新增回归测试先在旧实现上复现同样的 `$.id` 错误，再验证修复、三个层级、运行配置优先、分级覆盖和无效配置校验。
- 类型检查、构建和全部 **61 项测试**通过。
- Windows 上使用实际 **DSH 0.2.2-rc.1 / rc.2** 运行时、独立 `DSH_HOME`、Web **0.8.0** 与打包后的核心 **0.8.1**。
- 每个版本先启动并退出、不读取菜单，再用新进程检查；随后再次完整退出和冷启动复查。
- 客户端、工作区、会话的本级和下级默认菜单均可读取声明配置。读取不会启动被禁用的插件；会话独立启用及恢复继承成功。
- 测试插件调用官方 `dsh-agent-preset`，使用有效的 `id` 和 `plugins` 配置，没有修改官方插件代码或个人客户端数据。

可复用实际宿主检查脚本：`scripts/compatibility/declared-config-smoke.cjs`。在隔离目录的 `profiles/web/node_modules` 解压 Web 和 core 发布包，依次用独立进程运行：

```sh
node scripts/compatibility/declared-config-smoke.cjs <dsh-package.json> <isolated-DSH_HOME> arm
node scripts/compatibility/declared-config-smoke.cjs <dsh-package.json> <isolated-DSH_HOME> check
node scripts/compatibility/declared-config-smoke.cjs <dsh-package.json> <isolated-DSH_HOME> check
```

桌面安装若使用 `app.asar`，需以该安装的 Electron 程序在 `ELECTRON_RUN_AS_NODE=1` 下执行。不要把脚本指向个人 `DSH_HOME`，它会创建测试 profile 和会话。

## 更新范围

只发布 `dsh-tiered-plugin-core@0.8.1`。Web 0.8.0、TUI 0.1.0、dsh-go 0.1.0 都依赖 `^0.8.0`，无需修改界面包。新安装按依赖范围解析核心；已有安装请按主 README 的命令更新核心依赖并重启，锁文件不会因 npm 发布自动变化。

## English

Core 0.8.0 could reject the whole menu when an installed, inactive plugin declared required configuration. With no live Loader entry, the client fallback passed `{}` to validation instead of the bundle's declared config. An empty scoped store already falls back to client scope; the observed input was not `undefined`.

0.8.1 adds the missing declared-config fallback. Live configuration and explicit scoped overrides retain priority, and invalid configurations still fail validation. Only the core package changes; all existing 0.8.0/0.1.0 adapters accept it.

All 61 tests, type checking and builds pass. Packaged Web 0.8.0 plus core 0.8.1 also pass actual Windows DSH rc.1 and rc.2 cold starts in disposable homes: boot without opening the menu, exit, check in a new process, exit and repeat. Checks cover all three scopes, child defaults, inactive-plugin listing, session-only activation and restoring inheritance. This does not establish that installing only the menu in every fresh profile reproduces the original report.
