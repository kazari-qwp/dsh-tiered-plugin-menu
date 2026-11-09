# Superagent validation / Superagent 实测

**Update / 更新:** Menu 0.5.0 now passes the same-directory multi-instance case through generic directory redirection. The earlier 0.4.0 results below are historical. See [directory isolation validation / 目录隔离实测](DIRECTORY_ISOLATION.md).

Menu **0.4.0**, DSH **0.2.2-rc.1**, Node **24.21.0**, Windows; tested **2026-11-09**.
Official prototype: [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype/tree/8c32a9dc5d72c033816c6a8110b37f40cf94fba4), package **0.1.0**, commit `8c32a9dc5d72c033816c6a8110b37f40cf94fba4`.

[Recorded results / 测试记录](superagent-0.4.0.json).

## What changed / 本次实现

Workspace inheritance follows registered directory ancestry. A Router workspace can provide defaults to Worker workspaces beneath it, without requiring native parent-Agent ownership. Explicit Worker settings override the inherited configuration. Missing intermediate workspace registrations are skipped; the hierarchy is not limited to two levels.

工作区按已注册目录的祖先关系继承。Router 工作区的配置可以传给位于其目录下的 Worker 工作区，不要求 Worker 是 DSH 原生子 agent。Worker 的独立设置优先；未注册的中间目录会被跳过，层数不限。

```text
client
└─ state/                  Router workspace / Router 工作区
   └─ work/                directory only / 未注册为工作区的目录
      ├─ workerA/          inherits Router or uses its own settings
      └─ workerB/          independently configurable
```

Agent preset declarations now resolve within the workspace/session hierarchy. Two scopes can register the same preset ID with different definitions. Native IDs, Agent bindings and revision leases remain intact. This fixes the previous `Duplicate agent preset` failure when enabling the complete Superagent bundle at lower scopes. Restoring an unloaded session also restores its local preset before DSH resolves the saved ID.

Agent 预设声明现在按工作区、会话查找；两个作用域可以注册同名、不同配置的预设。保留 DSH 原有的 ID、Agent 绑定和版本持有机制，解决此前下级启用完整 Superagent 包的重复注册错误。恢复已卸载的会话时，先恢复本地预设，再让 DSH 查找历史中保存的 ID。

Both mechanisms are generic. No Superagent name checks, third-party source edits or DSH core file changes were added. The preset adapter uses the internal declaration table of the pinned DSH version.

这两部分都是通用机制，没有按 Superagent 名称写适配，没有修改外部插件或 DSH 核心文件。预设适配使用当前锁定 DSH 版本的内部声明表。

## Passed checks / 已通过

| Check / 检查 | Result / 结果 |
| --- | --- |
| Router + two Workers, separate models and temporary-message configurations / 两种角色、三个会话独立配置 | Passed / 通过 |
| Worker inherits Router workspace, nearest override, live tree toggle, disabled parent with explicitly enabled child / 工作区继承、就近覆盖、实时切换、上级关闭下级启用 | Passed / 通过 |
| New Worker workspace/session receives child defaults / 新 Worker 获得下级默认设置 | Passed / 通过 |
| All five bundle components enabled in two sessions, separate data directories / 两个会话启用完整五组件包，目录分别配置 | Passed / 通过 |
| Same preset ID, different local names/configurations; global declaration unchanged / 同名预设配置隔离，不影响全局声明 | Passed / 通过 |
| Workspace-only preset creates and resumes Workers with client preset disabled / 客户端预设关闭时，工作区预设创建和恢复 Worker | Passed / 通过 |
| Menu disable/re-enable restores global and scoped declarations / 菜单关闭、重开时恢复预设声明 | Passed / 通过 |
| Actual Agent disposal followed by immediate session resume, session-only preset restored / 真正卸载 Agent 后立即恢复会话及本地预设 | Passed / 通过 |
| Scoped HTTP endpoints return each instance's own data / HTTP 请求返回各自实例数据 | Passed / 通过 |

The separate repository suite passes **30/30 tests**, including deeper trees, ancestor deletion, service rebinding, same-ID preset mounting, native revision retention in subagents and asynchronous teardown. Run `npm ci --ignore-scripts` and `npm run check` to run that suite.

仓库测试另有 **30/30 项通过**，覆盖更深的工作区树、删除祖先、服务重新绑定、同名预设挂载、子 agent 保留原预设版本，以及异步卸载。执行 `npm ci --ignore-scripts`、`npm run check` 可运行这些测试。

## Remaining native limits / 仍有的原生限制

The following failures were also reproduced without the menu:

以下问题在不装菜单的对照中也复现：

| Native behavior / 原生行为 | Effect / 影响 |
| --- | --- |
| Two main instances use the same `stateDir` / 两个主实例共用目录 | `Lock file is already being held`. Choose a distinct data directory for each independent instance. / 每个独立实例需要不同数据目录。 |
| Windows drive-letter path rejected by `/^\//` validation / 拒绝 Windows 盘符绝对路径 | The fixture used a slash-prefixed path to the same directory. / 测试改用以斜线开头、指向同一目录的路径。 |
| Router restricts tools to `bash`, while the Windows preset supplies `pwsh` / Router 限制列表写了 bash，Windows 预设提供 pwsh | Creation fails without a `bash` tool. The fixture registered a placeholder that throws if executed. / 创建会失败；测试宿主注册了禁止执行的占位工具以继续验证配置。 |
| Transcript resource calls missing `sessionController.inspect` / 历史资源调用当前 DSH 不提供的接口 | Transcript retrieval fails on this host version. / 当前宿主版本的历史读取失败。 |

## Test scope / 测试范围

Tests used an isolated local profile, real DSH services, the unchanged official `Sessions.ensure` implementation, native role presets, persistence and model loops. Model replies were fixed text; ticket/effect inputs were fixtures. No GitHub or Feishu account was connected, and no paid model API was used. The full workflow from incoming requests through command execution and publishing was not tested. No desktop UI automation was used. The official source's 216 archive files were compared byte-for-byte and were unchanged.

测试使用本机独立 profile、真实 DSH 服务、官方未修改的 `Sessions.ensure`、角色预设、持久化和模型循环。模型回复是固定文本，工单及外围事件为测试数据。没有连接 GitHub、飞书账号，也未使用付费模型；没有验证从接单到执行命令、发布结果的完整流程，没有操作桌面界面。官方归档的 216 个文件逐字节比对均未改动。

The temporary test driver is disposed before runtime restart checks; it does not keep global event subscriptions into an old runtime. The final integration run has **19 passing checks** and the **three expected native failures** recorded above (path validation, transcript API and shared-directory locking). The Router tool constraint is bypassed only by the explicitly described fixture. These results establish configuration/preset compatibility within that scope, not complete Windows Superagent compatibility.

临时测试驱动在运行时重启检查前释放，不保留指向旧运行时的全局事件订阅。最终集成测试 **19 项通过**，另记录上述 **3 项预期的原生失败**（路径校验、历史接口、目录锁）；Router 工具限制仅通过前述占位夹具绕过。这证明了所测范围的配置、预设兼容性，不代表 Windows 上完整 Superagent 流程全部可用。
