# Additional eight-plugin matrix / 第二批八插件测试

2026-11-09 · menu 0.2.0 · DSH 0.2.2-rc.1 · Node 24.22.2. Same offline, unprivileged disposable VM as the [first batch](COMPATIBILITY.md). [Compact evidence](compatibility-second-batch.json).

本轮新增八个样本，累计十八个。依然只在隔离虚拟机运行，不向日常客户端安装第三方测试插件。

| Package / 包 | Version | Mixed lower-scope cases / 下级混装 | Coverage / 范围 |
| --- | --- | --- | --- |
| [Better Sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 0.30.1 | 14/14 | Two list limits and view modes; original frontend module. 两种列表上限和视图设置。 |
| [Agent Teams](https://github.com/NanmiCoder/dsh-agent-teams) | 0.1.29 | 14/14 | Different member limits/state directories; service and tool registration. 不同成员上限和状态目录。 |
| [Memory](https://github.com/FuRongJun-1999/dsh-memory) | 0.9.23 | 14/14 | Different identity/recall limits; frontend and tool registration. 不同身份及召回条数。 |
| [Force Compact](https://github.com/falling-ts/dsh-force-compact) | 0.9.1 | 14/14 | Different token thresholds/retained lengths and hook lifecycle. 不同压缩阈值与保留长度。 |
| [Bill](https://github.com/Jannchie/dsh-bill) | 0.23.1 | 14/14 | Different retention limits; projection registration after the fix below. 不同保留条数及统计注册。 |
| [Auto Mode](https://github.com/log-li/dsh-automode) | 0.18.0 | 14/14 | Different timeouts; host hooks. This package has no frontend. 不同超时配置，仅后端。 |
| [Workbench](https://github.com/lee259/dsh-workbench) | 0.16.1 | 13/13 | Host/HTTP lifecycle and frontend module; no host Config schema. |
| [Simplify](https://github.com/MichengAI/dsh-simplify) | 1.0.7 | 13/13 | Command registration/lifecycle and frontend module; no host Config schema. |

**110/110 mixed lower-scope checks pass.** All eight also start in the native mixed profile and the menu client-level mixed profile. Single-plugin native controls pass three off/on cycles for seven packages; Workbench fails all three without the menu, as detailed below.

**下级混装 110/110 通过。** 八个包原生混装、菜单客户端级混装均能启动。逐个进行原生开关对照时，七个包通过三次开关，Workbench 三次都失败；失败不需要菜单参与。

The scoped run starts with native instances disabled, creates two workspaces and four Agents, then exercises client off/on, two workspace instances, two session instances, inheritance, parent-off/child-on, lower-instance cleanup and native restoration. Six configurable samples add checks that A/B have different configurations and distinct runtime instances. The other two expose no host configuration schema, so they are not counted as different-config tests.

下级测试从客户端原生实例未启动的干净进程开始，覆盖两个工作区、四个 Agent、客户端开关、独立工作区和会话实例、继承、父关子开、释放与恢复。六个有配置项的包额外检查 A/B 配置不同、实例不同。其余两个没有宿主配置表，没有用随便塞字段的方式冒充配置测试。

## Reproduced menu fix / 菜单实测修复

Bill works natively but its lower instances failed with `example.wire.viewSchema.nullable is not a function`. It supplies a custom object with `parse`, which the native projection service accepts. The menu incorrectly required Zod's extra `nullable` and `safeParse` methods.

Bill 原生能工作，下级却报校验器没有 `nullable`。原因是菜单把原生接受的自定义 `parse` 校验器当成了 Zod。这是菜单引入的问题。

The wrapper now uses `parse` for state and wire values and preserves the parsed return value, including checkpoint transformations. No package-name branch was added. Bill alone and all eight together pass after the fix. A focused regression uses the real DSH projection registry with parse-only schemas and verifies that disabled scopes return null and checkpoint restore preserves the schema's transformation. The core suite is now **21 tests**.

修复只使用 `parse`，同时保留解析后的返回值，避免丢掉恢复检查点时的转换。没有为 Bill 按名字写分支。修复后 Bill 单独及八个包一起测试均通过；新增真实 DSH 统计注册器回归，核心测试增至 **21 项**。

## Native Workbench failure / Workbench 原生失败

Without the menu, all three off/on cycles fail with `webserver: duplicate exact route "/api/dsh-workbench/editor.js"`. The original host registers that route without owning its disposer. From a fresh process with its native instance disabled, menu-managed lower instances pass 13/13 because the shared HTTP wrapper owns those registrations. Existing native leftovers are not removed.

不装菜单时，原生反复开关会留下 `/api/dsh-workbench/editor.js`，三次都报重复注册。原实现没有释放该注册。从原生禁用的干净进程启动，菜单的通用 HTTP 包装负责注册生命周期，下级 13/13 通过。按照测试约定，不为原插件残留写专门清理代码。

## Limits and reproduction / 范围与复现

These are lifecycle, configuration and module-loading checks. We did not run a real team task, the memory plugin's external Python backend, paid model compaction/classification, every UI view or actual Git simplification. The first batch's 54 functional combinations and core regressions remain separate evidence. The VM has no external network during execution.

本轮没有调用真实团队任务、记忆插件的外部 Python 后端、付费压缩/分类模型、所有界面或真实 Git 简化任务。这里报告的是实际测过的生命周期、配置和模块加载；不据此宣称全部业务功能兼容。

After the first batch's dependency preparation, install the versions in `scripts/compatibility/samples-second.json` with `--ignore-scripts --legacy-peer-deps`, then run in the same offline sandbox:

```sh
node scripts/compatibility/second-batch.mjs
```

Reports are written to `work/second-batch/`. The runner accepts case names for targeted repeats, for example `node scripts/compatibility/second-batch.mjs scoped-dsh-bill scoped-mix`. A completed investigation can contain failed cases; inspect `controls` and `scoped` results as well as process exit status.
