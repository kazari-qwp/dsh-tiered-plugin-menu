# Tools in separate scopes / 不同作用域的工具

Menu **0.5.3**, DSH **0.2.2-rc.1**, 2026-11-09. [Test evidence / 测试记录](tool-registration-results.json).

Previously, lower instances forwarded tools into a global registration. Different plugins registering the same name could collide even in different workspaces. A focused test reproduced `tool "shared_lookup" is already registered` on 0.5.2.

此前下级实例把工具转发到全局注册，不同插件即使放在不同工作区也可能撞名。针对性测试在 0.5.2 复现了 `tool "shared_lookup" is already registered`。

Lower tools now register into each consuming Agent's native DSH scope, using the original complete tool definition and registration condition. Schemas, execution and rendering stay with their instance. New agents receive the tools selected by their inherited configuration; configuration changes and disposal update only the affected registrations. The workspace plugin instance remains shared by inheriting sessions.

现在下级工具注册到实际使用它的 Agent 的原生 DSH 作用域，保留完整工具定义和注册条件。参数、执行与渲染都归属原实例。新 Agent 按继承配置获得工具，配置变化和释放只更新受影响的注册；继承同一工作区的会话仍共用该工作区插件实例。

This supports conflicting plugins enabled in **different workspaces or sessions**. Enabling them together in the same session retains native DSH behavior. There is no tool renaming, conflict arbitration or package-specific adapter.

范围是冲突插件分别在**不同工作区或会话**启用。同一会话里同时启用时按 DSH 原生行为处理，不增加工具改名、冲突仲裁或按包名适配。

## Validation / 验证

- Type checking and build pass; core tests pass **38/38** on both Windows and the Linux VM. The new regression executes different same-name definitions and checks their schemas, output rendering, native admission conditions, late-created agents, configuration replacement, session disposal and menu restart.
- Unmodified **@fooxe/dsh-memory 0.13.10** and **meow-memory 0.32.6**, both registering `memory_search`, pass **6/6** targeted checks: separate workspaces, model-facing schemas and callbacks, new agents, different sessions in one workspace, independent disabling and menu restart.
- The previous **25-package coexistence set** passes **32/32** concurrent checks again, including real skill loading and `dsh-npm` file operations in independent instances.

类型检查、构建通过，Windows/Linux 核心测试均为 **38/38**。新增测试实际执行同名工具的不同实现，检查参数、渲染、原生条件筛选、新会话、改配置、会话释放和菜单重开。原版两款记忆插件的 **6/6** 项定向检查通过；此前可共存的 **25 个包**再次通过 **32/32** 项并发检查，包括真实技能读取与独立实例文件操作。

Third-party code ran only in the offline, unprivileged VM. No test packages were installed in the personal desktop profile. The memory-pair checks validate registration, schemas and lifecycle, not external memory-service workflows. The earlier 341 scope checks and 54 functional combinations were not rerun for this patch.

第三方代码只在断网、非管理员虚拟机内执行，没有向日常客户端安装测试包。记忆插件检查覆盖注册、参数和生命周期，不代表已测试外部记忆服务业务。此前 341 项分层检查与 54 组功能组合没有在本次补丁重跑。

Inside the prepared VM / 在已准备的虚拟机内：

```sh
npm test
node scripts/compatibility/third-batch.mjs scoped-memory-pair concurrent-without-conflict
```
