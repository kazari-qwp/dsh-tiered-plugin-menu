# Compatibility report / 兼容性报告

Test date / 测试日期: **2026-11-09**. Menu **0.2.0**, DSH **0.2.2-rc.1**, Node **24.22.2**, Ubuntu 24.04 in a disposable VMware VM.

Current evidence: [compatibility-0.2.0.json](compatibility-0.2.0.json). Historical 0.1.11 reports remain in [compatibility-results.json](compatibility-results.json) and [isolated-scope-results.json](isolated-scope-results.json); they do not describe the current implementation. The old memory native-control result is corrected below.

当前证据见新报告；旧 JSON 保留为 0.1.11 的历史记录，不代表当前兼容性。旧报告对 memory 原生开关的判断有遗漏，下文明确修正。

Eight additional packages were subsequently tested: [second-batch report / 第二批新增八个样本的报告](SECOND_BATCH.md).

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
