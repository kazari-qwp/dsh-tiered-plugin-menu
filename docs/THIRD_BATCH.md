# Third mixed-plugin regression / 第三批混装回归

2026-11-09 · menu **0.5.0 → 0.5.1** · DSH **0.2.2-rc.1** · Node **24.22.2** · Ubuntu 24.04.

Eight new packages were mixed with the previous eighteen, for **26 samples**. Tests ran in the disposable VMware VM as an unprivileged user, with only loopback networking and `no_new_privs`. Host shared folders, clipboard and credentials were unavailable. Installation scripts were disabled. Third-party source files and DSH core were unchanged; no test samples were installed in the personal desktop profile.

本轮新增八个包，与原十八个混装，共 **26 个样本**。第三方代码只在非管理员、断外网的虚拟机中运行，没有宿主共享目录、剪贴板或凭据，安装时禁用脚本。没有改第三方插件或 DSH 源码，也没有向日常客户端安装这批样本。

[Compact evidence / 结构化结果](compatibility-third-batch.json)

## New samples / 新增样本

| Package / 包 | Version | Individual scoped checks / 单独下级检查 |
| --- | --- | --- |
| [dsh-rewind-plugin](https://github.com/SiriLee/dsh-rewind) | 0.21.2 | 14/14 |
| [dsh-taskboard](https://github.com/cloader/dsh-taskboard) | 0.9.11 | 13/13 |
| [@changfenhuang/dsh-genui](https://github.com/omdsh-dev/dsh-genui) | 0.15.0 | 13/13 after the menu fix / 菜单修复后通过 |
| [meow-memory](https://github.com/Phant0Meow/dsh-meow-memory) | 0.32.6 | 13/14; native configuration parsing issue below / 原生配置解析问题见下文 |
| [@ayanehana/dsh-reasoning-effort](https://github.com/HanaAyane/dsh-reasoning-effort) | 0.9.1 | 14/14 |
| [@dsh-external/dsh-normify](https://github.com/yan-mc/dsh-normify) | 0.7.1 | 14/14 |
| [dsh-npm](https://github.com/zhengjy01/dsh-npm) | 0.1.4 | 13/13 |
| [@caozeal/dsh-next-git](https://github.com/caozeal/dsh-plugins) | 0.1.10 | 13/13 |

All eight pass three native off/on cycles individually: **24/24**. Packages without a host configuration schema receive lifecycle checks only; arbitrary unknown fields are not counted as configuration isolation.

八个新样本单独运行时均通过三次原生开关，共 **24/24**。没有宿主配置表的样本只统计生命周期检查，不靠传入未知字段冒充独立配置验证。

## Mixed results / 混装结果

- The original eighteen pass **247/247** lower-scope checks on 0.5.0.
- The new eight pass **107/108** together after the fix; the remaining case is Meow's native configuration issue.
- All twenty-six produce the same `memory_search` collision both natively and with the menu. The full scoped run records **346/354**, with all eight failures belonging to that memory plugin's collision/configuration cases.
- Removing Meow leaves twenty-five packages that start together both natively and at menu client scope, and pass **341/341** lower-scope lifecycle/configuration checks.
- With those twenty-five loaded, temporary messages, context prefixes and notifications pass **54/54 functional combinations**, with **72 real Agent turns** through a local model adapter and two native configuration-persistence checks.
- Core tests pass **35/35** on both Windows and the Linux VM.

旧十八个样本在 0.5.0 下的分层回归 **247/247** 通过。新八个修复后混装 **107/108**，唯一剩余项是 Meow 原生配置解析。全部二十六个混装会出现原生也存在的工具重名冲突；下级总计 **346/354**，八项失败都集中在该记忆插件的冲突与配置。移除 Meow 后，二十五个包原生、菜单客户端级混装均正常启动，下级检查 **341/341**；Windows 和 Linux 核心测试均为 **35/35**。

The scope matrix covers client on/off, independent workspace and session instances, different configurations where supported, inheritance, parent-off/child-on, cleanup and restoration. Lower-scope runs begin with the original client instances disabled, avoiding already-documented native route leaks.

分层矩阵覆盖客户端开关、两个工作区和独立会话、可用配置项的不同取值、继承、父关子开、释放与恢复。下级用例从原生实例未启用的干净进程开始，避免此前报告过的原生路由残留。

二十五个包混装下，临时消息请求尾部、上下文前缀和通知投递的 **54/54 组功能开关组合**通过，包含本地模拟模型上的 **72 次真实 Agent 调用**及两项原生配置持久化检查。没有使用付费 API。

The initial 180-second runner limit interrupted the long functional matrix. A separate 40-second timeout control reproduces `ETIMEDOUT` followed by the same inactive-context error during shutdown. Increasing only the functional runner limit to 900 seconds lets the unchanged product complete in **645 seconds**, with no failed assertions. Initial interrupted runs and the timeout control are retained in the evidence JSON.

初次功能测试受脚本的 180 秒时限中断。另设 40 秒超时对照，复现了 `ETIMEDOUT` 以及退出过程中的同一「上下文失效」报错。仅将功能测试时限增至 900 秒，产品代码不变，整组在 **645 秒**内完成，全部断言通过。证据 JSON 保留了初次中断与超时对照记录。

### Concurrent instances and real file operations / 并发实例与真实文件操作

All twenty-five packages were enabled together in **two independent workspaces**, with three inheriting sessions and one disabled control session. **32/32** checks pass, including deep workspace inheritance, original frontend module availability, actual bundled/runtime skill content and hiding skills from disabled sessions.

二十五个包同时在**两个独立工作区**启用，并连接三个继承会话和一个关闭状态的对照会话，**32/32** 通过。检查包含深层工作区继承、原前端模块可用性、读取实际技能内容，以及关闭会话不显示这些技能。

The unchanged `dsh-npm` tools write different registry settings through `npm_config` at the same logical file path. `npm_status` then returns the correct workspace or independent session value. Sibling inheritance, parent-off/child-on, fresh child-default instances and menu disable/re-enable all preserve the expected data. Registry URLs use `.invalid`; no actual npm network operation is involved.

直接调用原版 `dsh-npm` 的 `npm_config`，在相同逻辑文件路径保存不同 registry，再用 `npm_status` 读取，得到各自工作区或独立会话的值。同级继承、父关子开、下级默认配置创建新实例、菜单关闭再开启后的数据均符合预期。URL 使用 `.invalid`，没有联网操作 npm。

## Reproduced menu fix / 菜单实测修复

GenUI registers a skill provider with a fixed name. The menu previously forwarded that registration globally, so its second lower instance failed with `a skill provider named "dsh-genui" is already registered`. This reproduces with GenUI alone and on menu **0.4.0**, before directory isolation. It is an existing compatibility gap, not evidence of a new directory-redirection regression.

GenUI 使用固定名称注册技能提供器。菜单此前没有隔离这项注册，第二个下级实例会报重名。单独加载 GenUI 也复现，目录隔离之前的 **0.4.0** 同样复现，因此这是原有兼容缺口。

A focused test with the real DSH skill registry also showed that two runtime skill registrations could return A's content to B and remain visible in a disabled scope. Both forms now route through a generic scoped skill registry: one host registration, separate instance callbacks/content, catalog invalidation when selection changes, and per-instance disposal signals. No package name appears in the implementation.

真实 DSH 技能注册器的补充测试还复现了运行时技能串用：B 读到 A 的内容，关闭的会话仍可见。现在统一按作用域选择技能实例，切换时刷新目录缓存，释放时仅终止对应实例；实现中没有插件名称判断。

## Native failures retained / 保留的原生问题

**Tool collision.** Meow and `@fooxe/dsh-memory` both register `memory_search`. A clean profile containing only those two, without the menu, reproduces the same failed child fiber. The twenty-six-package native and menu-client profiles also reproduce it. This was not repaired or hidden by the menu.

**工具重名：** Meow 与 `@fooxe/dsh-memory` 都注册 `memory_search`。只装这两个、不装菜单也会失败；二十六包原生和菜单客户端级混装的报错一致。按约定不为这种原生冲突做适配。

**Configuration parsing.** On the pinned DSH version, native `resolveConfig` maps both `{ "hitTopK": 2 }` and `{ "hitTopK": 5 }` for Meow to `{}`. The direct control loads no menu, starts no plugin and has no other samples active. Its different-session-configuration assertion therefore remains failed; it is not counted as a successful isolation check.

**配置解析：** 当前 DSH 的原生 `resolveConfig` 会把 Meow 的两组参数 `hitTopK: 2` 与 `hitTopK: 5` 都解析为 `{}`。直接对照没有加载菜单，也没有启动其他样本，所以保留这一失败，不计为配置隔离通过。

## Reproduce and limits / 复现与范围

Use the offline VM setup from the [first batch](COMPATIBILITY.md#reproduce), retain the versions in the first two sample manifests, then add `scripts/compatibility/samples-third.json`. Normify is distributed as the upstream [v0.7.1 release tarball](https://github.com/yan-mc/dsh-normify/releases/download/v0.7.1/dsh-external-dsh-normify-0.7.1.tgz), SHA-256 `7f2d27e14a489638da7ebb1b20c94b18a27f96ec8fb21bed73064ce838abda60`. Prepare dependencies with scripts disabled, then run inside the offline, unprivileged namespace:

```sh
node scripts/compatibility/third-batch.mjs
```

Select named cases for focused repeats, for example `scoped-without-conflict` or `concurrent-without-conflict`. The runner keeps a separate home directory and DSH profile for each case. Inspect assertions, failed child fibers and process errors, not just the top-level startup flag. Expected native failures remain in the report.

每组测试使用独立 home、工作目录和 DSH profile。可传入用例名定向复测。应同时查看断言、失败的子实例及进程错误，不能只看启动标志；原生对照失败会保留在报告中。

These results cover the tested registrations, lifecycle, configuration, file operations and local functional fixtures. They do not certify every UI action, actual Git pushes, package-manager network operations, external memory services or paid model workflows. Fixed-port plugins remain outside the requested scope. No directory-isolation regression was observed in these cases.

结论限于实测的注册、生命周期、配置、文件操作与本地功能流程；没有穷尽所有界面、真实 Git 推送、联网包管理、外部记忆服务或付费模型流程。写死端口仍按此前约定排除。在这些用例中没有观察到目录隔离回归。
