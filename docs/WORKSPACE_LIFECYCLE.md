# 工作区删除与恢复 / Workspace deletion and restoration

本记录对应1.1.0 的工作区生命周期修复。验证环境：Windows 上实际 DSH **0.2.2-rc.1 / rc.3**，每组使用独立的 E 盘 profile 与数据目录，不修改日常客户端数据，不调用模型 API。

This records the workspace lifecycle fix in 1.1.0, tested with actual Windows DSH rc.1 and rc.3 hosts in separate profiles, without model API calls.

## 已复现的问题

删除已注册工作区后，Harness 保留会话原来的 cwd；菜单此前仅按显式成员关系或 cwd 完全匹配寻找工作区。因此，原工作区下的会话可能直接继承客户端，跳过仍存在的父工作区。被删工作区的配置和下级默认值还会保留，旧菜单也能继续写入这些失效记录。

The previous lookup required explicit membership or an exact cwd match. After deletion it could skip a surviving parent workspace and fall back to client scope. Deleted-scope settings also remained writable through an already-open menu.

## 修改后的行为

- 优先使用宿主记录的会话归属；需要从 cwd 判断时，选择最近的已注册工作区。
- 包装工作区注册表的公开删除方法，在删除成功后清理该作用域的本级配置、下级默认值和父级记录，更新子级引用并同步实例与服务。
- 会话自己的插件、MCP、Skill 配置保持不变，已复制到会话的默认值仍属于会话自己的配置。
- 失效工作区的旧菜单拒绝保存，避免重新生成残留配置。
- 启动时清理旧版本留下或菜单关闭期间删除的工作区记录，再根据当前归属恢复实例。
- 私有数据目录不在此次清理范围；不会删除工作区文件或会话历史。

Session overrides survive; deleted-workspace settings are removed. Stale menus reject writes, and startup reconciles missing workspaces before restoring instances. Private plugin data, workspace files and conversation history are not deleted.

## 实际宿主验证

使用一个真实注册工具的测试插件；不同实例返回不同配置标签。检查工具在各会话中的实际可见性和返回值，不只检查菜单开关。

| 场景 | rc.1 | rc.3 |
| --- | --- | --- |
| 删除子工作区，原会话和存活的下级工作区继承父工作区 | 通过 | 通过 |
| 删除无父工作区的工作区，会话继承客户端 | 通过 | 通过 |
| 会话独立配置和创建时复制的默认配置保留 | 通过 | 通过 |
| 删除后切换父工作区开关、修改父配置，影响继承会话 | 通过 | 通过 |
| 会话关闭、独立启用、恢复继承均按新归属生效 | 通过 | 通过 |
| 旧工作区菜单拒绝保存，配置和运行实例已清理 | 通过 | 通过 |
| 退出进程并冷启动，恢复后的工具和继承结果正确 | 通过 | 通过 |

rc.3 另外使用修复前复现留下的数据冷启动，确认残留工作区配置清除、原会话配置保留。

Additional rc.3 verification resumed pre-fix reproduction data to check cleanup of existing stale records.

## 复现入口

脚本：`scripts/compatibility/workspace-delete.cjs`。用 Harness 自带运行时执行，参数依次为安装目录、独立测试数据目录、阶段；`arm` 创建测试工作区并删除，`cold` 在新进程恢复同一目录。完整报告写入测试目录的 `arm-report.json` / `cold-report.json`。

类型和核心回归：`npm run check`；dsh-go 桥接：`npm run test:go`。测试只覆盖这里列出的范围，不代表所有第三方插件的工作区生命周期都已验证。
