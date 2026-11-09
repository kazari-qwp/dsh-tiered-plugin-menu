# Cross-plugin skill isolation / 跨插件技能隔离

Menu **0.5.2**, DSH **0.2.2-rc.1**, 2026-11-09. [Test evidence / 测试记录](skill-registration-results.json).

In 0.5.1, separate brokers for different plugins could attempt to register the same host provider name. Two plugins calling `skills.register()` for the same skill also collided on the generated `runtime:<skill-name>` provider, even when enabled in different sessions. Both failures were reproduced before this fix.

0.5.1 中，不同插件各自的转发器会重复注册同名宿主提供器。两个插件通过 `skills.register()` 注册同名技能，也会在生成的 `runtime:<技能名>` 上撞名，即使分别启用在不同会话。两种错误均已先复现，再修复。

The brokers now share one host registration per provider name. Every contribution retains its own owner, callbacks and lifecycle. Discovery gathers only contributions visible to the requesting session; a request without a session gathers only client-level contributions. Matching the same name does not make lower-scope skills globally visible.

现在同名提供器共用一个宿主入口，每条注册仍保留自己的所属实例、回调和生命周期。查询时只收集当前会话可见的来源；不带会话的查询只收集客户端级来源。共用入口不会让下级技能变成全局可见。

DSH continues to compare candidate ranks. Within a shared provider, equal-rank candidates retain registration order; ordering between different host providers remains DSH's responsibility. Each winning candidate is routed back to its originating callback with the original candidate object and locator. Skill names remain unchanged.

DSH 继续按候选技能的优先级选择。同一共享提供器内优先级相同时保留注册顺序，不同宿主提供器之间仍采用 DSH 的顺序。选中后把原候选对象和 locator 交还原来源回调，技能名称保持不变。

Disposing one contribution leaves the others active and refreshes the catalog. A provider that fails discovery does not hide healthy contributions sharing its name; the observation remains incomplete so it is not cached. The host entry is released after its last contribution is removed.

卸载一个来源后，其他来源继续工作，并刷新技能目录。某个来源读取失败不会遮住同名提供器中的其他正常来源，这次读取标记为不完整，不缓存失败状态。最后一个来源释放后才移除宿主入口。

## Validation / 验证

- Two new tests fail on 0.5.1 with duplicate provider errors and pass after the fix. They cover separate and overlapping sessions, global invisibility, rank and tie selection, original candidate identity, partial discovery, cache refresh and independent disposal.
- Type checking and build pass. The complete suite passes **37/37** on Windows and **37/37** in the Linux VM.
- The previous **25-package coexistence set** passes **32/32** concurrent checks in the offline, unprivileged VM, including real GenUI and Normify skill contents, disabled-session visibility, private file operations and menu restart.
- The tested host entry hash is `06a5dab08d0fb50bc3c918b59bc39cae7da41f093a18526edba1bbb7db436b4d`.

新增两项测试在旧实现报重名，修复后通过，覆盖不同会话、同会话重名、全局不可见、优先级、原候选对象、不完整读取、缓存刷新和独立释放。类型检查与构建通过，Windows/Linux 完整测试均为 **37/37**。断网非管理员虚拟机中，前轮可共存的 **25 个包**再次通过 **32/32** 项并发检查。

This is a targeted follow-up to the [26-sample matrix](THIRD_BATCH.md). The earlier 341 scope checks and 54 functional combinations describe 0.5.1; they were not rerun for this patch. No third-party source, DSH core or package-name adapter was changed.

这是前轮二十六样本矩阵的定向回归。此前的 341 项分层检查和 54 组功能组合属于 0.5.1，本次没有重跑整套矩阵。没有修改第三方源码、DSH 核心，也没有添加按插件名判断的适配。
