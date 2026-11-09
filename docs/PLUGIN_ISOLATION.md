# Experimental plugin isolation / 插件隔离（实验性）

Version 0.6.0 adds a second switch to the menu's Settings. It defaults to **off**, also for existing installations. Changes persist immediately and apply after restarting DSH.

0.6.0 在菜单设置页增加第二个开关，**默认关闭，升级不自动开启**。修改后立即保存，重启 DSH 生效。

> 给插件提供相对独立的环境，可能能修复一些兼容性问题，但也可能带来更多兼容性问题。

## Shared implementation

- Client entries use the same `ScopedModules` and `DirectoryView` as lower instances. Native Loader entries, saved configuration and frontend module discovery remain in use.
- Service environments are separated by scope and package. Components of a package share their environment. Explicit dependencies can connect to an unambiguous active provider; native host consumers are included.
- `ScopedServices` retains its per-session ownership checks. With the switch on, tool, skill, command, prompt and projection names receive a stable plugin prefix. Both conflicting tools keep their own schemas, executors and output renderers in one Agent's admitted tool set.
- HTTP registrations use an `/api/__tiered/…` prefix. The existing frontend binding forwards requests to the selected instance. The original path is restored before calling the plugin's handler.
- Remote calls retain DSH's Gateway argument validation, peer authorization and cancellation, using the selected instance's Typert descriptors.
- Private clients are released before native registrations are restored when the menu is removed. Data and saved switches persist.

客户端、工作区和会话复用同一套模块、目录、服务和释放机制。此次没有修改 DSH 或第三方源码，也没有按插件名增加适配分支。

## Regression results

Third-party code ran in an Ubuntu 24.04 VM, as an unprivileged user in a network namespace with loopback only. The host client did not receive sample plugins. DSH was pinned to **0.2.2-rc.1**, Node to **24.22.2**. The [machine-readable summary](reports/plugin-isolation-0.6.0.json) includes all **26 package versions**.

| Check | Result |
| --- | --- |
| Native `@fooxe/dsh-memory` + `meow-memory`, without menu | Reproduced duplicate `memory_search` registration failure |
| Same pair, isolated at client scope, one Agent | **5/5**: both schemas admitted, native trust command works, both empty-index searches execute, one session override disables only its chosen tool |
| All 26 samples, isolated client entries | All sample entries and native host dependencies active; clean exit |
| All 26 samples, isolated workspace/session mix | **33/33**: two workspaces, nested inheritance, real npm configuration/storage, skills, session overrides, child defaults, menu removal and re-enabling |
| Switch off, 25 samples excluding the known native memory conflict | Native client startup passes; concurrent lower-scope checks **32/32** |
| All 26 installed, switch on; temporary messages, context and notifications | **54/54** functional switch combinations across two workspaces and four sessions; **72** mock-model requests |
| Local automated checks | **42/42**, plus type checking and build |

The two lower-scope mixes deliberately start third-party client entries disabled. Four native presets consequently wait for a globally disabled provider in **both** switch states. This is recorded in `hostInactive`; it is not counted as a new isolation failure. With client entries enabled, all four activate.

The 54-case functional matrix completed during implementation. Subsequent frozen-config, Remote-binding and skill-lookup fixes were verified in focused tests; the 26-package mixed run was repeated after the configuration fix. Historical 341-case results in other documents belong to their stated releases and are not counted here.

实测发现并修复：新装插件未自动隔离、HTTP 路径前缀不符合原生要求、原生预设的服务依赖被隔断、恢复全局服务时的释放顺序、根级易变配置与冻结字典无法再次提交、设置页 Remote 调用取错描述表，以及技能列表中的公开名称无法原样传回读取接口。每项修复均有失败复现后的验证。

## 0.6.1 session restoration fix

An installed menu owns the helper contexts used for isolation. The 0.6.0 dependency scan mistakenly counted those private services as package exports, then redirected host registries to them. This could stop session services when loading a session, leaving its cached transcript visible while its title, sidebar entry and input became unavailable. Cold startup could also hang. Session logs and workspace membership were not deleted in the reproduced case.

The scan now accepts runtime provisions only when their isolation key matches the package entry's visible key. Cross-package dependency aliases are limited to entries actually managed by the isolation layer; the menu's native services remain native. This is a scope-based fix with no third-party package name branches.

The original mixed-plugin harness inserted the menu by file URL, outside the installed package inventory. That missed this failure. The harness now installs the menu as a bundle, and a local regression covers discovery, native service identities, existing and newly opened Agents, and menu removal/re-enabling. All **43 local tests** pass. On Windows, five copied persisted sessions were restored one at a time with isolation enabled; all five stayed listed and available with their original titles. No model requests or original-session edits were needed.

0.6.1 修复了菜单把自身私有辅助服务误当成对外服务、继而替换 DSH 全局服务的问题。之前的混装测试将菜单按文件路径加载，未把它加入已安装插件清单，漏掉了这个条件；现在已改用真实安装方式。Windows 下逐个恢复五个会话副本，五个均保留且可用，本地 43 项测试通过。

The corrected offline-VM harness also passes the 26-package isolated client startup, **33/33** isolated lower-scope checks, **32/32** switch-off control checks, and **5/5** conflicting-memory-tool checks. The same four native presets wait only in runs that deliberately disable their client-level provider. [0.6.1 results and package versions](reports/session-restoration-0.6.1.json). 修正测试安装方式后的混装回归也已通过；此次未重新运行完整的 54 组模型功能矩阵。

## Limits and data

Private data is stored beside the menu settings in `<config-filename>.data/`. First activation starts with fresh private directories. Existing global directories are left in place; turning the switch off and restarting returns client entries to them. The two sets of data are not automatically merged.

This is compatibility isolation, **not a security sandbox**. Fixed TCP ports, native addons, subprocess filesystem access, global files outside redirected mounts and module-import side effects are outside its guarantees. Conflicting Agent preset IDs are not renamed. Original-name references embedded in prompts or cross-plugin code may require plugin changes. The frontend fetch binding cannot distinguish two callers that use exactly the same original URL; prefixed backend registrations alone do not solve that frontend collision.

The real memory test exercises empty-index search and tool admission, not remote embedding providers or a full memory workflow. Mixed runs exercise lifecycle, scope routing and selected operations, not every UI action or third-party tool.

## Reproduce in the offline VM

Install the pinned sample lists from `scripts/compatibility/samples*.json` in the existing disposable lab, build the menu, then run:

```sh
npm run check
node scripts/compatibility/third-batch.mjs native-memory-pair \
  isolation-memory-pair isolation-client-all isolation-concurrent-all \
  client-without-conflict concurrent-without-conflict isolation-functional-all
```

Run sample code under the lab's unprivileged, offline sandbox launcher. Each case creates an independent HOME, DSH profile and working directory. The functional adapter is local and uses no paid model API.
