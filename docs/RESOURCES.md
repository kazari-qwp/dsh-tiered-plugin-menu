# MCP 与 Skill 分级配置验证

环境：Windows、Node 24.21.0、DSH SDK 0.2.2-rc.1。测试数据和服务器安装在仓库的 `work/` 下，不读取正在使用的 DSH profile 或会话日志。所有测试在受限执行环境内运行，无付费模型请求。

2026-11-12：包含新增资源测试在内的 **53 项检查全部通过，没有跳过**。构建后的 0.7.0 tarball 另经 DSH 官方 CLI 安装到全新的独立 profile，再由桌面安装包内的原生运行时启动，验证 MCP 分级连接、会话技能覆盖及工作区技能目录查询。此项 profile 在仓库之外的 `E:/Codex/dsh-resources-install-070-final/`，未借用开发仓库的依赖。

实际运行时检查发现文件技能提供方位于默认 Agent 预设层，而非全局注册表。客户端和工作区目录查询已改用 DSH 的 `agentPresets.acquireScope()` 借用预设读取作用域，结束后释放；不创建临时 Agent。对应场景已加入回归测试。

## 测试对象

| 对象 | 验证内容 |
| --- | --- |
| 本地 stdio MCP 测试服务器 | 使用真实 DSH MCP 客户端，分别提供工具、资源和服务器指令；客户端、工作区、会话独立连接，继承复用、关闭、子 agent 默认值、菜单重启、卸载后恢复原生入口；实验性插件隔离开／关各测一次 |
| 本地 HTTP MCP 测试服务器 | 不同会话请求头不同；连接失败回滚，新增失败不残留条目；持久化恢复 |
| `@modelcontextprotocol/server-filesystem@2.3.0` | 两个会话指向不同允许目录，读取各自文件；越界读取被服务器拒绝 |
| `@modelcontextprotocol/server-memory@2.1.1` | 两个会话使用不同 `MEMORY_FILE_PATH`，分别创建和读取实体；菜单重启后内容和配置保留 |
| 文件技能与运行时注册技能 | 分别开关、正文和调用权限覆盖，工作区树、下级默认值、多级子 agent，重启、卸载恢复；原始文件保持不变 |
| 文件系统 MCP + 记忆 MCP + 三个文件技能 + 临时消息插件 | 混装后独立配置、单项关闭、重启，确认其他资源继续可用 |
| 客户端设置界面与官方 Remote/Gateway | 左侧分类、本级／下级切换、展开配置、保存、添加 MCP、技能配置的 RPC 调用 |

## 运行

常规依赖安装后：

```sh
npm run check
```

额外参考服务器安装到独立测试目录（不作为插件的发布依赖）：

```sh
npm install --prefix work/mcp-lab --ignore-scripts @modelcontextprotocol/server-filesystem@2.3.0 @modelcontextprotocol/server-memory@2.1.1
node --experimental-transform-types --test test/resources-reference.test.ts
```

没有安装这两个参考服务器时，仅对应的额外测试会标记为 skipped；本地 stdio / HTTP 服务器和技能测试始终运行。

受限 Windows 环境中若 `tsx` 在启动前因 `uv_os_get_passwd` 失败，可使用 Node 的 TypeScript 支持运行后端资源测试，或将测试编译到 `work/` 后运行 JS。该限制与插件运行无关。

## 范围

这些检查验证配置、路由、生命周期以及参考服务器的实际协议调用。它们不等于对任意 MCP 服务的兼容保证。HTTP 远端服务没有自动复制；stdio 子进程的数据目录需要通过参数或环境变量指定。Skill 共用提供方和原始资源，菜单提供独立开关及可选内容覆盖。
