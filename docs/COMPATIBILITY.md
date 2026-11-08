# Compatibility report / 兼容性报告

Test date / 测试日期: **2026-11-08**. Menu **0.1.11**, DSH **0.2.2-rc.1**, Node **24.22.2**, Ubuntu 24.04 in a disposable VMware VM. The original snapshot is commit `d826cc9`; the configuration fix is `99a0150`.

## Isolation / 隔离方式

Plugin execution used an unprivileged guest account, a separate network namespace with loopback only, `no_new_privs`, and no host shared directories, clipboard or credentials. Dependencies were downloaded with install scripts disabled before execution. No third-party samples were installed into the user's desktop profile. Model requests went to a deterministic local adapter; webhook requests went to a loopback HTTP server. No paid API was used.

插件运行于一次性虚拟机中的非管理员账号；执行时只有 loopback 网络，禁止提权，没有宿主共享目录、剪贴板或凭据。依赖下载阶段禁用安装脚本，执行阶段断网。未向用户日常客户端安装这些样本。模型使用本地模拟适配器，通知发往虚拟机内的 HTTP 服务，未调用付费 API。

## Samples / 样本

Stars are an approximate snapshot, not a code-quality score. All packages below started individually, in the native mixed profile, and in the mixed profile with the menu. Native enable/disable controls were repeated three times per package. A startup pass is not an end-to-end feature certification.

星数只是选样时的热度快照，不代表代码质量。以下所有包均通过单独启动、原生混装、带菜单客户端混装；每个包重复三次原生开关。启动成功不等于全部功能通过。

| Package / 包 | Version | Stars | Lower-scope finding / 下级结果 |
| --- | --- | ---: | --- |
| [billion-context](https://github.com/ranxianglei/billion-context) | 0.1.213 | 4,947 | Multi-entry bundle rejected by the menu; no independent instance. 多入口包，菜单明确拒绝创建独立实例。 |
| [dsh-context](https://github.com/bowenliang123/dsh-context) | 0.82.2 | 4,618 | Adapted prompts/projections/HTTP and original UI components tested. 提示词、统计、HTTP 和原 UI 组件已测。 |
| [clutch-dsh-title](https://github.com/Cerbur/clutch-dsh) | 0.1.7 | 45 | A second lower instance collides on `titleRemote`; native recovery after the experiment can need a restart. 第二实例服务重名；失败试验后可能需要重启恢复。 |
| [dsh-prompt-setting](https://github.com/zangxx66/dsh-prompt-setting) | 0.2.6 | 29 | Duplicate `/prompt-setting` HTTP prefix; plugin catches the failure, so ACTIVE is not proof of a working instance. HTTP 路由冲突被插件内部捕获，显示 ACTIVE 仍可能未挂载。 |
| [dsh-prompt-history](https://github.com/Xiaofei-fei/dsh-prompt-history) | 1.11.2 | 11 | Second instance collides on `promptSuggest`; lower-only frontend module absent. 服务重名，单独下级启用也缺少原前端模块。 |
| [@fooxe/dsh-memory](https://github.com/annkun/dsh-memory) | 0.13.10 | 6 | Duplicate `/dsh-memory/api/v1/list` route and `dsh-memory:auto` prompt registration. HTTP 和提示词注册冲突。 |
| [dsh-tacit](https://github.com/hackernotfound/dsh-tacit) | 0.7.0 | 4 | Second instance collides on `tacit`; original shared storage is not adapted. 第二实例服务重名，内部共享存储也尚未适配。 |
| [dsh-notification](https://github.com/nishit130/dsh-notification) | 0.1.2 | 2 | 18/18 event-routing and webhook cases; OS/browser UI not exercised. 事件过滤及 webhook 18/18，未测系统/浏览器弹窗。 |
| [@deepcodec/dsh-clock](https://github.com/DeepCodec/dsh-clock) | 1.0.0 | 0 | Host mounts with separate JSON configs, but original frontend module is missing when client scope is off. 后端配置可分层，客户端关闭时下级缺少原前端模块，不能判兼容。 |
| dsh-temporary-messages | 0.1.10 | Local fixture | 18/18 real Agent request-tail cases; companion UI/lifecycle suite also passes. 真实 Agent 尾部输入 18/18，设置页和生命周期另有回归测试。 |

The service/route errors above were not reproduced by native single-instance toggles without the menu. They are limitations introduced by trying to duplicate these plugins at lower scopes, not dismissed as unrelated native conflicts. Fixed TCP-port support was excluded as requested.

以上同名服务/路由冲突在不装菜单的原生单实例开关对照中没有复现，因此归为菜单下级复制的兼容性限制，不推给原插件。按要求不处理固定 TCP 端口兼容。

## Functional matrix / 功能矩阵

Two workspaces, four live Agents. For each of temporary-messages, dsh-context and notification: client **on/off** × workspace **inherit/on/off** × session **inherit/on/off** = **18 cases**; **54 total**, all pass with all ten samples installed. Each case checks the targeted session, a sibling session, and both sessions in another workspace.

两个工作区、四个真实 Agent。临时消息、dsh-context、通知三个样本各测试客户端开/关 × 工作区继承/开/关 × 会话继承/开/关，共 54 组，十插件混装时全部通过。每组同时检查目标会话、同区另一会话及另一区两个会话。

- Temporary messages: 72 real Agent turns reach the mock model; inspect the actual final message block.
- Context: assemble the real system prompt and check the selected prefix.
- Notification: trigger real DSH status events and count actual HTTP deliveries; duplicate delivery is a failure.
- Lower-instance lifecycle: enable two workspaces and two sessions, disable/inherit, enable a child under a disabled parent, and restore the native client.
- The 15-test core suite separately covers instance release/reload, concurrent session creation, original settings components, context projections/HTTP, UI navigation and CSS ownership.

临时消息检查 72 次真实循环最终发给模型的消息；上下文检查真实系统提示词装配；通知检查实际 HTTP 投递且不允许重复。下级试验覆盖两个工作区、两个会话实例、开关/继承、关闭父级后启用子级及恢复客户端。15 项核心测试另覆盖释放/恢复、并发建会话、原设置组件、统计和 HTTP、跨页面与样式生命周期。

This is bounded compatibility evidence, not a security audit or a claim that every tool, remote UI or provider call of all ten plugins works. In particular, shared internal storage, all third-party frontend interactions, and all possible cross-plugin configurations were not exhaustively tested.

这份报告不代表安全审计或十个插件所有功能均正常。内部共享存储、所有第三方前端交互及任意跨插件配置组合没有穷尽验证。

## Reproduced fix / 实测修复

The menu previously used `Entry.update()` for client configuration. The native switch reloads the profile, so a just-saved in-memory value could be lost. Version 0.1.11 first uses the native enable path and then persists the normalized configuration through `configEditor.edit()` on the live entry. A regression checks the first enable, another native off/on cycle, and the actual profile file for both adapted plugins.

之前客户端配置只调用 `Entry.update()` 改内存，原生开关重读 profile 会丢值。0.1.11 先走原生启用流程，再通过 `configEditor.edit()` 持久化当前入口配置。临时消息和 dsh-context 都验证首次启用、再次原生开关以及配置文件中的实际值。

## Reproduce

Use a disposable Linux VM with Node.js 24. Keep all source and dependencies inside it; do not mount a personal home directory. Download dependencies first, without executing package install scripts:

```sh
npm ci --ignore-scripts
npm install --save-dev --ignore-scripts --legacy-peer-deps --no-audit --no-fund \
  @deepseek-ai/dsh@0.2.2-rc.1 \
  @fooxe/dsh-memory@0.13.10 dsh-tacit@0.7.0 dsh-prompt-setting@0.2.6 \
  dsh-notification@0.1.2 @deepcodec/dsh-clock@1.0.0 \
  @cerbur/clutch-dsh-title@0.1.7 billion-context@0.1.213 dsh-prompt-history@1.11.2
node scripts/compatibility/complete-official-peers.mjs
```

`--legacy-peer-deps` is used for the isolated matrix because some sample peer ranges exclude the tested DSH prerelease. `complete-official-peers.mjs` fills missing first-party dependencies with the same pinned DSH version. This is test preparation, not an instruction to change a personal profile.

Then run **as an unprivileged user in a network namespace with loopback only and `no_new_privs`**:

```sh
npm run check
node scripts/compatibility/run.mjs
```

Reports go to `work/compatibility/`. The runner records unsupported lower-scope findings separately; a functional-matrix or persistence failure produces a nonzero exit code. The source files are ordinary Node.js and do not use computer-use or browser automation.

中文：以上安装仅用于一次性虚拟机。依赖准备后，切换到无提权权限、只有 loopback 网络的非管理员运行环境再执行检查。报告保存在 `work/compatibility/`；下级不兼容按调查结果记录，功能矩阵或配置持久化失败会返回非零退出码。
