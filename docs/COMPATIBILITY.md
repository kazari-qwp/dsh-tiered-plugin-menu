# Compatibility guide / 兼容性详细文档

这里集中说明菜单的通用兼容机制、限制、作者声明及历史验证记录。每份报告的结论只对应其中注明的版本和测试范围，不等于所有插件功能或组合都已验证。

This guide covers generic compatibility mechanisms, limits, author declarations and historical evidence. Each report applies to its stated versions and scenarios, not every feature or plugin combination.

## 机制与范围 / Mechanisms and scope

| 机制 / Mechanism | 行为及边界 / Behavior and limits |
| --- | --- |
| 实例、配置与生命周期 / Instances, configuration, lifecycle | 明确启用的工作区或会话创建独立实例；继承共用上级实例。离开页面不卸载后台实例，释放与恢复遵循作用域。Independent overrides create scoped instances; inherited settings share their ancestor instance. Navigation does not stop backend work. |
| 私有服务与依赖 / Private services and dependencies | 将插件提供的私有服务隔开，显式依赖连接到当前作用域的提供者，宿主共享服务继续访问原有数据。Private plugin services are separated; explicit dependencies are routed without privatizing shared host data. |
| 工具与技能 / Tools and skills | 先按会话筛选可见来源，保留各自的参数、执行与渲染；释放一个来源不移除其他来源。同会话重名处理需实验性隔离。Scope-aware discovery preserves independent schemas, execution and rendering; same-session name qualification is experimental. |
| 共享注册 / Shared registrations | 转发命令、提示词、统计投影、HTTP 等注册到对应实例，并随实例释放；不修复其他插件此前遗留的原生注册。Scoped brokers own their contributions, not other plugins' pre-existing leaked registrations. |
| 前端与配置卡 / Frontend and configuration cards | 使用真实 Loader 入口加载原前端和 CSS，支持仅下级启用、界面切换及更新重载。保留原设置卡，没有卡时使用 JSON。自定义绕过宿主接口的前端不保证兼容。Original installed frontend modules and styles are reused; custom integrations bypassing host APIs may need further work. |
| Agent 预设 / Agent presets | 隔离不同作用域的同名声明，保留原 ID 与版本引用；使用了宿主内部声明表，宿主更新仍需验证。Scoped declarations preserve IDs and revision leases; this uses host internals rather than a stable cross-version API. |
| 目录重定向 / Directory redirection | 插件通过受支持的 Node 文件接口创建私有目录时按作用域和包重定向；相对路径、上级路径和 realpath 保留逻辑含义。外部进程、原生扩展、未进入私有目录的全局文件不在此范围。Supported Node file access is redirected; external processes, native addons and unrelated global files are not. |
| 包、组件与资源 / Bundles, components and resources | 一个包可含多个组件；按声明及已观察到的服务依赖安排开关。官方与第三方共用逻辑，MCP/Skill 复用继承与配置机制。Package controls and dependency plans apply equally to official and third-party plugins, with shared inheritance for MCP and skills. |

这些是兼容层，不是安全沙箱。固定端口不做重定向；远端服务、外部进程及其文件存储是否独立，取决于插件本身和配置。实验性隔离默认关闭，打开后可能改善重名问题，也可能影响依赖原公开名称的代码。

This is a compatibility layer, not a security sandbox. Fixed ports are not redirected. Remote services and external-process storage depend on plugin configuration. Experimental isolation is off by default and can break code that relies on original public names.

<a id="author-declaration"></a>

## 作者声明与测试建议 / Author declaration and testing

在包的 `package.json` 中设置 `dsh.tieredPluginMenu.Compatible: true`，表示作者已自行测试与本菜单兼容。字段区分大小写，必须是布尔值；字符串 `"true"`、`false` 或未填写都不构成声明。菜单不会自动标记或替作者写入声明。

Set `dsh.tieredPluginMenu.Compatible: true` after testing compatibility with this menu. The key is case-sensitive and only boolean `true` counts. The menu never writes or infers an author declaration.

旧的 `selfCompatible` 和 `supportsChildInstances` 不再作为当前兼容声明读取。旧字段仅涉及更窄的多实例能力，作者应自行检查下面的行为后声明 `Compatible`；未声明仍可确认后启用，不会禁止使用或清除已有配置。

Legacy `selfCompatible` and `supportsChildInstances` fields do not count as the current declaration. Authors should check the broader menu behavior before declaring `Compatible`. Unverified packages can still be enabled after confirmation; existing configuration is not cleared.

建议作者至少覆盖以下行为，并注明测试使用的 Harness 与菜单版本：

1. **冷启动**：客户端级关闭，从干净进程直接在工作区或会话启用，检查实际功能和原前端，而不只检查开关状态。
2. **独立配置与继承**：两个工作区、多个会话和子 agent 使用不同配置，交叉切换继承、启用、关闭，检查数据与事件不串用。
3. **配置保存**：关闭时保存不启动实例；启用后应用，运行中保存立即生效，保存不改变开关。
4. **生命周期**：离开页面仍能处理后台任务；关闭、重新启用、恢复会话和重启后，注册和配置正确释放或恢复。
5. **依赖与界面**：多组件包、服务依赖、配置卡、原前端与 CSS，以及宿主允许的插件更新流程。
6. **目录与作用域变化**：检查私有数据、路径访问、删除工作区后的会话归属及自己的显式配置。若声称支持实验性隔离，单独测试该开关。

Recommended coverage: cold starts with the native instance disabled; independent configurations and inheritance across workspaces, sessions and subagents; saving while disabled/enabled; background work, disposal and restoration; dependency/frontend/update behavior; private data and workspace ownership changes. Test experimental isolation separately when claiming support for it.

声明仅表示作者测试过与本菜单配合，不是官方认证，也不表示与任意其他插件组合均兼容。

## 详细报告索引 / Detailed reports

| 内容 / Topic | 文档 / Document |
| --- | --- |
| 混装与原生对照 / Mixed plugins and native controls | [第一批（本页下方）](#first-batch)、[第二批](SECOND_BATCH.md)、[第三批](THIRD_BATCH.md) |
| 官方组合包 / Official bundles | [OFFICIAL_PLUGINS.md](OFFICIAL_PLUGINS.md) |
| 工具、技能与资源 / Tools, skills and resources | [TOOLS.md](TOOLS.md)、[SKILLS.md](SKILLS.md)、[RESOURCES.md](RESOURCES.md) |
| 目录隔离与 Agent 预设 / Directories and presets | [DIRECTORY_ISOLATION.md](DIRECTORY_ISOLATION.md)、[SUPERAGENT.md](SUPERAGENT.md) |
| 实验性隔离与会话恢复 / Experimental isolation and session restoration | [PLUGIN_ISOLATION.md](PLUGIN_ISOLATION.md) |
| 工作区删除与配置恢复 / Workspace deletion and configuration restoration | [WORKSPACE_LIFECYCLE.md](WORKSPACE_LIFECYCLE.md) |
| 插件前端更新 / Plugin frontend updates | [CLIENT_UPDATES.md](CLIENT_UPDATES.md) |
| 多端架构与实际界面验证 / Platforms and live UI | [COMPONENTS.md](COMPONENTS.md)、[LIVE_UI_TESTING.md](LIVE_UI_TESTING.md) |
| 组件升级与历史修复 / Component updates and earlier fixes | [COMPONENT_UPDATES.md](COMPONENT_UPDATES.md)、[CORE_0.8.1.md](CORE_0.8.1.md) |

历史报告保留当时的术语、版本和问题记录，判断当前行为请以本页机制说明及当前代码为准。发布记录见 [GitHub Releases](https://github.com/kazari-qwp/dsh-tiered-plugin-menu/releases)。

<a id="first-batch"></a>

## 第一批历史报告 / First-batch historical report

Test date / 测试日期: **2026-11-09**. Menu **0.2.0**, DSH **0.2.2-rc.1**, Node **24.22.2**, Ubuntu 24.04 in a disposable VMware VM.

Evidence for this batch: [compatibility-0.2.0.json](compatibility-0.2.0.json). Earlier 0.1.11 reports remain in [compatibility-results.json](compatibility-results.json) and [isolated-scope-results.json](isolated-scope-results.json); they do not describe the current implementation. The old memory native-control result is corrected below.

当前证据见新报告；旧 JSON 保留为 0.1.11 的历史记录，不代表当前兼容性。旧报告对 memory 原生开关的判断有遗漏，下文明确修正。

Eight additional packages were subsequently tested: [second-batch report / 第二批新增八个样本的报告](SECOND_BATCH.md).

Later mixed regression: [third batch, menu 0.5.1 / 26 样本混装回归](THIRD_BATCH.md).

## Isolation / 隔离方式

Third-party code ran only as an unprivileged guest user, in a network namespace with loopback only and `no_new_privs`. The disposable VM had no shared host folders, clipboard, drag-and-drop or credentials. Dependencies were prepared with install scripts disabled. No samples were installed into the user's desktop profile. Model responses and webhooks used local fixtures; no paid API was called.

第三方代码仅在一次性虚拟机中的非管理员账号运行，执行时只有 loopback 网络，禁止提权，没有宿主共享目录、剪贴板或凭据。依赖准备阶段禁用安装脚本。没有向用户日常客户端安装样本，也未调用付费模型。

## Results / 结果

All ten packages start individually and in the mixed client profile, with and without the menu. The final mixed profile mounts the menu at cold boot, just like an installed bundle. **21/21 core tests**, **54/54 functional combinations**, and the two native configuration-persistence checks pass.

十个包均通过单独启动、原生混装和菜单客户端级混装。最终混装测试随 profile 冷启动加载菜单。核心测试 **21/21**，功能组合 **54/54**，两项原生配置持久化检查也通过。

The final tarball also passes the official CLI installation and a fresh-profile host/frontend-module startup check. A clean dependency checkout passes type checking, build and all 21 core tests. The artifact SHA-256 is recorded in the evidence JSON.

最终安装包通过官方 CLI 安装，以及独立 profile 的宿主启动和前端模块加载检查。干净依赖目录下的类型检查、构建和 21 项测试通过；证据 JSON 记录了安装包 SHA-256。

| Package / 包 | Version | Observed behavior / 实测范围 |
| --- | --- | --- |
| [billion-context](https://github.com/ranxianglei/billion-context) | 0.1.213 | 14/14 scoped cases, including both components together; package-off plan lists dependent native presets. 两个组件同开同关及依赖清单。 |
| [dsh-context](https://github.com/bowenliang123/dsh-context) | 0.82.2 | 18/18 functional combinations; original configuration/Insights components, HTTP/projections and CSS lifecycle in the core suite. |
| [clutch-dsh-title](https://github.com/Cerbur/clutch-dsh) | 0.1.7 | 13/13 scoped cases; independent configuration and provided services. 独立配置及服务注册。 |
| [dsh-prompt-setting](https://github.com/zangxx66/dsh-prompt-setting) | 0.2.6 | 13/13 scoped cases; HTTP prefix no longer collides across instances. 同名 HTTP 前缀可分层注册。 |
| [dsh-prompt-history](https://github.com/Xiaofei-fei/dsh-prompt-history) | 1.11.2 | 13/13 scoped cases; independent service registration and original frontend module. |
| [@fooxe/dsh-memory](https://github.com/annkun/dsh-memory) | 0.13.10 | 13/13 from a clean process with native instance disabled; native route leak remains, detailed below. |
| [dsh-tacit](https://github.com/hackernotfound/dsh-tacit) | 0.7.0 | 13/13 scoped cases; independent service registration; private global files are not virtualized. |
| [dsh-notification](https://github.com/nishit130/dsh-notification) | 0.1.2 | 18/18 event-routing/webhook combinations; OS/browser notifications not exercised. |
| [@deepcodec/dsh-clock](https://github.com/DeepCodec/dsh-clock) | 1.0.0 | 13/13 scoped cases; actual original settings component renders twice and saves A without changing B. |
| dsh-temporary-messages | 0.1.10 | 18/18 real Agent request-tail combinations, original settings and lifecycle regressions. |

The seven samples other than context, notification and temporary-messages were also tested individually, without any other third-party plugin. Each received three native off/on cycles, a lower-scope run after native activation, and a fresh run starting with the native entry disabled. All seven original frontend modules appear in DSH's module graph when only lower instances are enabled. This proves loading availability, not every frontend action.

除上下文、通知、临时消息外，七个样本还分别在不加载其他第三方插件的 profile 中测试：三轮原生开关、原生启动后切到下级、原生禁用状态下直接启动下级。七个原前端模块在仅启用下级时均进入 DSH 模块图；这证明模块可加载，不等同于所有界面交互都已验证。

### Functional matrix / 功能矩阵

Two workspaces, four live Agents. Each functional sample uses client **on/off** × workspace **inherit/on/off** × session **inherit/on/off** = **18 combinations**, checking the selected session, its sibling, and two sessions in another workspace.

- Temporary messages: inspect the actual final input in 72 real Agent turns through a local model adapter.
- Context: assemble the real system prompt and check the selected prefix.
- Notification: emit real DSH status events and count actual loopback HTTP deliveries; duplicates fail.
- Core suite: component/package switches, cancel-without-writes, dependency ordering, missing dependency rejection, cross-scope dependents, private services, runtime lifecycle, settings, remotes, panels and CSS ownership.
- Clock: React/jsdom runs the original configuration component and state store. The portal menu primitive is stubbed; its native numeric input and form mutation run unchanged.

三个样本分别验证实际模型输入尾部、系统提示词和 HTTP 通知投递，而不只检查「已启用」标志。核心测试覆盖整包/组件操作、取消不写配置、依赖顺序、缺失依赖报错、跨层依赖和原界面生命周期。Clock 测试保留原数字输入和保存逻辑，只有弹出菜单的 portal 容器使用替身。

### Native memory limitation / memory 原生问题

Without the menu, `@fooxe/dsh-memory` fails **all three native off/on cycles** in a child fiber because `/dsh-memory/api/v1/list` remains registered. The earlier test inspected only the parent fiber's ACTIVE state and incorrectly counted this as success. The current harness checks failed child fibers too.

不装菜单，memory 三次原生开关都会在子实例中报重复路由。之前只看父实例 ACTIVE，误判了这三个对照。现在检查子实例失败状态，修正为 **0/3**。

After that native registration has leaked, the lower-scope run passes 7/12 cases; five activations fail on the same route. In a fresh process where the native instance never starts, the menu-managed run passes **13/13**. The generic route broker owns its registrations and releases them, but does not remove another plugin's earlier native leftovers. No package-specific repair is included.

已有路由残留时，下级试验 7/12，五次启动被同一残留阻止。干净进程直接由菜单管理时 13/13。通用路由转发器负责释放自己接管的注册，不去删除其他插件先前遗留的原生路由，也没有为 memory 写特殊处理。

### Test harness correction / 测试脚本修正

Hot-inserting an entry and immediately disposing the profile exposed an HMR shutdown wait. Replacing the menu with an empty plugin reproduced the same Loader/Hmr/Timer wait. Final mixed-profile tests put the entry in the profile before boot; they exit normally. No DSH or plugin lifecycle code was changed to suppress this observation.

运行后临时写入入口并立即退出，会触发 HMR 清理等待；用空插件替换菜单也复现。最终测试在启动前配置入口，正常退出。没有因此修改 DSH 或插件的生命周期实现。

## Implementation changes / 实测修复

- Provided services receive scope-private labels; components in one scope can share declared dependencies.
- Shared host registries route to the selected instance instead of duplicate registration.
- Real ephemeral Loader entries expose original frontend modules and styles; embedded per-plugin client copies were removed.
- Package rows group multiple entries; dependency plans precede any writes, with explicit confirmation and errors for unavailable dependencies.
- Original bundle and component configuration slots are reused. Persist raw configuration rather than a schema-transformed runtime object; this fixes the title sample's save failure.

对应修复为通用服务隔离、共享注册转发、真实 Loader 入口、整包/组件及依赖控制、复用整包/组件配置插槽，以及保存原始配置。没有修改第三方源码，也没有按插件名分支适配。

Global files, module variables and fixed TCP ports remain outside isolation. Fixed ports were excluded by request. Tool-schema changes between instance configurations, arbitrary custom UI/network calls and every sample's complete feature set have not been exhaustively tested. The report is bounded compatibility evidence, not a security audit.

## Reproduce

Use a disposable Linux VM with Node.js 24. Do not mount personal directories. Prepare dependencies with install scripts disabled:

```sh
npm ci --ignore-scripts
npm install --save-dev --ignore-scripts --legacy-peer-deps --no-audit --no-fund \
  @deepseek-ai/dsh@0.2.2-rc.1 \
  @fooxe/dsh-memory@0.13.10 dsh-tacit@0.7.0 dsh-prompt-setting@0.2.6 \
  dsh-notification@0.1.2 @deepcodec/dsh-clock@1.0.0 \
  @cerbur/clutch-dsh-title@0.1.7 billion-context@0.1.213 dsh-prompt-history@1.11.2 \
  @deepseek-ai/dsh-client-store@0.2.2-rc.1 zustand@4.5.7 immer@10.1.1
node scripts/compatibility/complete-official-peers.mjs
```

`--legacy-peer-deps` permits the tested prerelease peer ranges in this disposable fixture. Then run **as an unprivileged user with `no_new_privs`, no external network, and loopback enabled**:

```sh
npm run check
node scripts/compatibility/run.mjs
node scripts/compatibility/isolated-scopes.mjs
node_modules/.bin/tsx scripts/compatibility/client-settings.ts
```

The mixed runner accepts case names to repeat only affected cases, for example `node scripts/compatibility/run.mjs client-mix scoped-mix functional-mix`. Reports go to `work/compatibility/` and `work/isolated-scopes/`. Read case-level failures; a completed investigation is not a claim that every scoped case passed.

中文：依赖准备完成后，在断网、禁止提权、仅有 loopback 的非管理员环境执行检查。不要把第三方样本装进个人 DSH profile。报告会保留具体失败项，不把「调查执行完毕」等同于「所有样本兼容」。
