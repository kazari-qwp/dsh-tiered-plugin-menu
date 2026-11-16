# 冷启动性能与启动失败隔离 / Cold startup and failure containment

对应 [issue #3](https://github.com/kazari-qwp/dsh-tiered-plugin-menu/issues/3)，修复版本为 **Core 1.1.1 + Web 1.1.1**。本报告记录 2026-11-16 的测试，不代表任意插件组合都已验证。

## 改动

- Core 共享已安装插件清单的枚举结果。原生插件管理、Loader 配置及入口变更会使缓存失效；枚举途中发生变更也会重新读取。实际配置、开关与运行状态仍从当前状态计算。
- Web 在一轮发现流程内共享列表结果，合并连续刷新通知；变化发生在刷新期间会补跑一轮。未被菜单接管的插件不再重复请求会话级列表，没有会话时也不重复请求客户端列表。
- 分别处理插件导入、配置读取、客户端接管和下级实例启动错误；失败项显示自己的错误，菜单服务和其他插件继续工作。接管失败会撤销该项已经挂上的隔离服务，并尝试恢复原入口。
- 用户主动启用或保存无效配置仍会报错并按原规则回滚，列表容错不代表跳过配置校验。

没有修改宿主或第三方插件源码，没有按具体插件名分支。后端同步仍保持串行；本次没有把后台实例改为依赖打开菜单才启动。

## 测试环境与测量范围

- Ubuntu 24.04 专用虚拟机，4 CPU / 4 GB，Node 24.22.2，实际 DSH **0.2.2-rc.3**。
- 非特权用户、独立网络和进程命名空间，仅开放回环网络；不接入宿主个人配置、外部模型或远端服务。
- 每次使用新 DSH 进程和独立 profile；混装十个公开样本，加上宿主与菜单共 **236 个 Loader 入口**。
- 样本：`dsh-pet@0.4.9`、`dsh-plugin-wallpaper-engine@1.4.2`、`dsh-better-sidebar@0.32.1`、`dsh-mnemon@0.5.46`、`dsh-video-skin@0.1.6`、`dsh-draw-meme@1.0.1`、`dsh-see-now@0.2.2`、`dsh-agent-soul@0.9.17`、`ds-harness-remote@0.6.5`、`dshmarket@1.73.20`。
- 这些是公开可取得的样本，不包含反馈者的本地包，部分版本与其后来补充的清单不同。`dsh-draw-meme` 取自 `Y8962314/dsh-draw-meme` 的 `b227278b7052036b1f2311512571ad7bf553532e`。

| 指标 | 修复前 1.1.0，两次运行 | 修复后，三次运行 |
| --- | --- | --- |
| 前端全量列表请求数 | 62 / 62 | 2 / 2 / 2 |
| 列表处理累计耗时 | 4778 / 4864 ms | 205 / 172 / 194 ms |
| `refresh()` 次数 | 64 / 64 | 4 / 4 / 4 |
| 冷启动后端 `sync()` 次数 | 1 / 1 | 1 / 1 / 1 |

以上排除了计时结束后的直接探针调用。方法耗时包含等待，嵌套方法的累计值不能相加，也不能当作独占 CPU 时间。**列表处理耗时不是从点击图标到会话可用的总耗时。** 修复后三次之一在虚拟机恢复后连宿主基础启动也较慢，因此不拿其总启动时间作直接性能结论。

重复枚举与前端按插件重复读取确实造成开销；这个样本中未复现后端 changed/sync 风暴。`markEntry()` 没有磁盘写入，基线两次调用合计约 0.06 ms。其他怀疑点不能仅凭本轮数据认定为反馈者剩余延迟的原因。

## 路由冲突对照

使用公开的 `wwsmiler1-bit/dsh-agent-md`，版本 0.2.0、提交 `fc762b4865893999c02ec0282aa122ffacd1d400`，可以复现 `/api/agent-md` 重复注册以及旧菜单 API 404。

这个样本未保留路由注册的释放函数；关闭菜单后，仅用原生插件开关关闭再启用，也会重复注册。反馈者提供的是本地包，**不能仅因包名和版本号相同就认定其代码和根因相同**。

`enabled:false` 本身没有创建关闭的下级实例。此前设置任意作用域覆盖会让菜单接管并重启原客户端实例，原实例的遗留路由可在此暴露；旧菜单让这个异常中断整个启动流程。

修复后，同一失败样本保留自己的错误行；菜单 `list` 返回 HTTP **200**。另一个正常插件可以在会话级关闭并恢复继承，操作后菜单 API 仍返回 200。此修复不清理或覆盖第三方此前泄漏的原生路由。

## 回归与限制

- 类型检查、构建、**78 项测试通过**，其中宿主回归依赖基于 DSH rc.1。
- 新增多控制器共享读取、缓存变更与并发失效、刷新结束时不漏更新、单插件路由泄漏和下级实例启动失败等测试。
- 现有配置保存、客户端开关、工作区生命周期、端口回滚、目录隔离、MCP、Skill、TUI 与 dsh-go 相关回归通过。
- 没有原样复现反馈者 Windows 桌面上约 30 秒的完整延迟；需要在其实际 profile 升级后确认。历史会话 UI 探针在不启用菜单的对照中也未找到所建会话，因此未计入性能结论。
- 没有重新进行完整 Android/TUI 视觉矩阵，也未验证所有混装样本的外网功能。

## English

Core and Web **1.1.1** address confirmed repeated discovery work and cascading startup errors from issue #3. Core shares catalog enumeration and invalidates it on native package/profile/entry changes, including invalidation during an in-flight read. Effective configuration and live state are still read dynamically. Web shares rows within one discovery pass, coalesces refresh bursts without losing later changes, and avoids unnecessary session-list reads for unmanaged plugins.

On actual DSH rc.3 in an isolated Ubuntu VM with ten public plugin samples and 236 Loader entries, list RPCs fell from **62 to 2**. Cumulative list handling fell from **4.78–4.86 s to 0.17–0.20 s**. These are list timings, not end-to-end desktop startup or exclusive CPU time. Public samples differ from some versions and local packages in the reporter's profile. Their full Windows delay remains unconfirmed.

A public `dsh-agent-md@0.2.0` sample reproduces the route leak even under native disable/enable without the menu. A disabled scope did not create a child instance: takeover restarted the original client, exposing leaked native registrations. After the fix, this failure remains visible on that plugin while menu RPCs return HTTP 200 and a healthy plugin can still be disabled and restored to inheritance. This does not establish that the reporter's local package has identical code, nor repair third-party route leaks.

Typechecking, builds and 78 regression tests passed. No host or external-plugin sources were modified and no plugin-specific branches were added. Validation did not cover every third-party feature, the reporter's exact Windows profile, or a new complete Android/TUI visual matrix.
