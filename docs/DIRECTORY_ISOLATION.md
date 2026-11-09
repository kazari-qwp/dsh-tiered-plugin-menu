# Directory isolation / 目录隔离

Tested **2026-11-09**: menu **0.5.0**, DSH **0.2.2-rc.1**, Node **24.21.0**, Windows. [Recorded results / 测试记录](directory-isolation-0.5.0.json).

## Behavior / 行为

The lower instance's Node file interface treats directories created through `mkdir` or `mkdtemp` as private mounts. It does not inspect configuration field names. Private ESM/CommonJS module graphs bind file imports, cached dependency imports and dependency-local locks to the same scope/package. Host SDK and declared peer dependencies retain their shared identity. No third-party files are patched on disk.

下级实例通过 `mkdir` 或 `mkdtemp` 创建的目录会成为私有目录，不识别或猜测配置字段名。独立的 ESM/CommonJS 模块加载让文件接口、依赖缓存的接口和依赖自身的锁记录归属同一作用域、同一个包；宿主 SDK 和声明的 peer 依赖仍共享身份。第三方磁盘文件未修改。

The directory tree has a logical and a physical path. Requests normalize relative paths and `..` against the original working directory before choosing a mount. `realpath` maps its result back to the logical namespace. `import.meta.url`, its filename/directory and resolved package-resource URLs also retain their original meaning, so passing an asset path to a host service does not expose an internal module-cache path.

目录同时有逻辑路径和实际存储路径。相对路径、`..` 先按原工作目录解析，再选择私有目录；`realpath` 的结果还原为逻辑路径。插件的 `import.meta.url`、文件名、代码目录和资源解析路径同样保留原来的含义，把资源路径交给宿主服务时不会误传内部加载路径。

```text
logical / 逻辑                    physical / 实际
/data/plugin/value.txt       →    private instance A / 实例 A 私有目录
/data/plugin/value.txt       →    private instance B / 实例 B 私有目录
/data/plugin/../shared.txt   →    /data/shared.txt
```

Only mounted subtrees are redirected. Existing data is not copied into a new instance; original directories remain untouched. The private directory manifest and data survive restarts. An inheriting session uses its ancestor's instance, while an explicitly enabled session gets its own data. New-child defaults copy configuration, not the parent's data files.

只重定向已登记的目录子树。新实例不会复制原目录的数据，原目录保持不动；私有目录清单和数据会跨重启保留。继承的会话共用上级实例，独立启用的会话使用自己的数据；下级默认设置复制配置，不复制父实例的数据文件。

## Checks / 测试

The repository suite passes **33/33 tests**, including these additions:

仓库测试 **33/33 通过**，本次新增覆盖：

| Case / 场景 | Result / 结果 |
| --- | --- |
| Two instances create/write/read the same absolute and relative paths / 两个实例使用相同绝对、相对路径 | Separate data / 数据独立 |
| `..` inside and outside a mount, similarly named sibling directory / 子目录回退、离开私有目录、同前缀兄弟目录 | Original logical destination / 保持原逻辑目标 |
| Sync, native, callback, promise, URL and Buffer forms of `realpath` / 多种 realpath 接口及路径形式 | Logical results, usable for later reads / 返回可继续访问的逻辑路径 |
| Junction resolution and reads through its canonical path / junction 解析及解析后读写 | Passed / 通过 |
| `readdir`/`opendir` directory-entry paths and fresh temporary directories / 目录枚举路径及临时目录 | Private paths do not leak into subsequent lookups / 不把内部路径带入后续访问 |
| ESM, CommonJS, `createRequire`, CommonJS requiring ESM, reserved-word exports / 模块互操作和缓存接口 | Same instance-bound file view / 仍使用对应实例的文件接口 |
| SQLite open path / SQLite 数据库打开路径 | Independent files / 独立文件 |
| Workspace inheritance, explicit session enable, disable/re-enable, child defaults and menu restart / 菜单层继承、开关、下级默认及重启 | Expected sharing and persistence / 按预期共用或隔离，并保留数据 |

The module interoperability test uses a separate native Node process because the `tsx` test runner replaces Node's `require(esm)` behavior. Production uses native Node's module hooks, matching the desktop host. Run `npm ci --ignore-scripts` and `npm run check` for the repository suite.

模块互操作测试单独运行原生 Node，因为测试框架 `tsx` 会替换 Node 的 `require(esm)` 行为。生产实现使用原生 Node 模块钩子，与桌面宿主一致。执行 `npm ci --ignore-scripts` 和 `npm run check` 可运行仓库测试。

## Official Superagent / 官方 Superagent

Used the unchanged [official prototype](https://github.com/deepseek-ai/dsh-superagent-prototype/tree/8c32a9dc5d72c033816c6a8110b37f40cf94fba4), package **0.1.0**. Its **216** archive files still match byte-for-byte. Both lower instances kept the same `stateDir` as the client. They started together, acquired separate physical locks, opened separate SQLite files and stored different probe values; the client's value stayed unchanged. Menu disable/re-enable and actual Agent disposal/resume retained each instance's value. Package components, scoped presets and scoped HTTP requests also passed. **20 integration checks passed**.

使用未修改的官方原型 **0.1.0**；归档 **216 个文件**逐字节一致。两个下级实例沿用客户端相同的 `stateDir`，同时启动后分别获得实际锁目录、打开各自的 SQLite 文件，并写入不同测试值；客户端的值没有变化。关闭、重开菜单，以及真正卸载、恢复 Agent 后，各实例的数据仍然保留。整包组件、预设隔离和 HTTP 请求也通过；集成测试共 **20 项通过**。

Two expected native failures remain: Windows drive-letter path validation and the missing `sessionController.inspect` transcript API. The Router's Windows `bash` constraint still uses the previously documented non-executing placeholder in this fixture. Real DSH services, presets, persistence and model loops were used, with fixed model replies and no GitHub/Feishu accounts. This does not establish the full connected automation workflow; see the [earlier native controls](SUPERAGENT.md).

仍保留两项已在原生对照复现的问题：Windows 盘符路径校验、历史读取所需的 `sessionController.inspect` 接口缺失。Router 的 Windows `bash` 限制仍使用前次说明的禁止执行占位工具继续测试。使用真实 DSH 服务、预设、持久化和模型循环，模型固定回复，没有连接 GitHub/飞书账号；未据此宣称完整联网自动化流程通过。

## Scope / 覆盖范围

This is a compatibility layer for plugin-owned Node file calls and SQLite opening/backup paths. It is not an operating-system sandbox. Shared host services, native addons, SQLite paths embedded in SQL such as `ATTACH`, and external processes are not redirected by this layer. Files outside a private mount keep their original destination; a plugin may deliberately access them. Hardcoded ports remain unchanged.

这是插件自身 Node 文件调用以及 SQLite 打开、备份路径的兼容层，不是操作系统沙箱。共享宿主服务、原生扩展、SQL 中 `ATTACH` 等内嵌路径，以及外部进程的访问不由此层重定向。私有目录之外的文件仍按原目标访问，插件可以主动访问它们；写死的端口也不变。
