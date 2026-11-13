# 官方插件兼容性 / Official plugin compatibility

2026-11-13，开发分支。测试使用未经修改的 Windows Harness 0.2.2-rc.3 安装程序与独立测试 profile；没有加载用户日常 profile、账号或模型凭证。所有测试数据位于 E 盘。

## 通用修改

- 从 Harness 的 `official`、`availability`、`listedByDefault` 元数据识别官方组合包，不维护插件名称白名单。读取嵌套组合包中的组件默认配置。
- 客户端整包开关交给原生包管理器执行，保留组合包对宿主配置的覆盖及撤销语义。
- 对仅在构造函数中声明服务名的 `Service`，保留组合包的组件顺序，挂载后记录实际提供的服务；普通声明依赖仍走依赖计划和缺失提示。
- 为 `sessionTitle` 和 `permissionPresets` 的单一注册槽增加共用的会话路由，保持原生服务的工作调度、取消和配置逻辑。先释放下级注册，再撤销路由，避免清掉客户端注册。
- 投影 handle 读取其他会话时继续返回合法的折叠状态，同时不向该会话发布本实例的界面投影。

以上改动针对宿主服务接口，不检查官方插件包名，也不修改外部插件源码。官方身份不自动等于自兼容声明。

## 实际 Harness 测试

每个组合包分别运行以下三个场景，共 **36/36 通过**：

1. 客户端关闭，在同一工作区的 A、B 会话独立启用；C 会话仍关闭；关闭 A 不影响 B，再启用 A。
2. 完全退出测试 Harness 后冷启动，恢复 A、B、C，检查实际组件 fiber 的运行状态。
3. 客户端开启、关闭各两次，检查运行状态，并核对原宿主组件的启用状态已恢复。

| Harness 中的名称 | 组合包 | 组件数 |
| --- | --- | ---: |
| 开发者工具 | `@deepseek-ai/dsh-experimental-inspector-profile` | 3 |
| 语音输入 | `@deepseek-ai/dsh-experimental-voice-input-bundle` | 4 |
| 自动授权审查 | `@deepseek-ai/dsh-experimental-auto-review` | 1 |
| 思考过程机器翻译 | `@deepseek-ai/dsh-experimental-cot-translation-bundle` | 2 |
| DSH 徽章技能 | `@deepseek-ai/dsh-experimental-badge-skill-bundle` | 1 |
| 随对话更新的标题 | `@deepseek-ai/dsh-experimental-session-titles-bundle` | 1 |
| 持久终端 | `@deepseek-ai/dsh-experimental-terminal-bundle` | 3 |
| Git 工作树 | `@deepseek-ai/dsh-experimental-tool-worktree` | 2 |
| 自定义插件索引 | `@deepseek-ai/dsh-experimental-plugin-market-bundle` | 2 |
| 个性化推荐 | `@deepseek-ai/dsh-personalized-recommendations` | 6 |
| 变更请求与工作树 | `@deepseek-ai/dsh-experimental-forge-bundle` | 6 |
| DeepSeek 会话导入 | `@deepseek-ai/dsh-deepseek-chat-import` | 1 |

另测：

- 这 12 个包在不加载菜单的原生 profile 中分别启动，均通过，作为对照。
- rc.1 和 rc.3：翻译服务的 A、B 实例分别使用 `maxTextChars=100/200`，检查运行中服务的实际值；切换工作区继承、恢复独立配置，再冷启动检查保存结果。
- rc.1 和 rc.3 的自动授权审查、会话标题：客户端及下级同时启用，关闭整个菜单，再重新启用；客户端注册保留，下级实例恢复。
- 实际 Web 客户端：12 个官方条目、会话级开关、确认与组件详情；1280×850 和 390×844 截图检查。修复了手机宽度下的横向溢出与侧栏遮挡。
- 70 项回归测试通过，覆盖既有第三方插件、MCP/Skill、树继承与配置、并发会话回调、注册释放、投影读取和 TUI 操作。
- rc.1 和 rc.3：官方翻译组件及普通测试插件分别在客户端、工作区、会话级关闭保存配置，启用后检查运行值，启用期间保存立即更新，再关闭保存并冷启动。共 24 项通过；保存不修改启用状态。
- 实际 Web 页保存关闭的官方和第三方插件配置；桌面和手机宽度下滚轮只移动右侧内容，分类导航及关闭按钮固定，无横向溢出。

## 复现入口

先在仓库运行 `npm run build`。以下命令在 PowerShell 中执行；安装路径和测试目录按实际环境调整，测试目录必须与日常 DSH_HOME 分开。

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& 'E:\dsh\Harness\DeepSeek Harness.exe' scripts/compatibility/official-bundles.cjs `
  'E:\dsh\Harness' 'E:\tests\official-translation' arm `
  '@deepseek-ai/dsh-experimental-cot-translation-bundle' | Out-Host
```

将 `arm` 改为 `check`，使用同一测试目录验证冷启动。`client` 测客户端开关，`unload` 测菜单卸载重载，`list` 导出清单，`baseline` 在不加载菜单的新测试目录中作原生对照。脚本将结果写入测试目录的 `<mode>-report.json`。

`config-arm` 和 `config-check` 依次测试关闭保存及冷启动恢复，无需最后的包名参数。它们在隔离 profile 中创建一个普通测试插件，并同时检查官方翻译组件。

可以设置 `OFFICIAL_CONFIG_CASE` 指定要核对的实例配置。例如翻译服务：

```json
{"component":"translator","field":"maxTextChars","values":[100,200],"service":"translator","property":"maxTextChars"}
```

## 范围

这些结果验证菜单的基础多实例兼容性，不等于所有业务功能已端到端验证。没有下载语音模型、录音、调用付费审查/标题模型、访问真实 GitHub PR 或导入用户聊天文件。此次手机检查是 Web 窄屏浏览器，不是重新运行 Android APK。没有证明任意官方组合包混装都互不冲突，也不保证未来宿主内部注册结构不变。

## English

The official tab uses native Harness bundle metadata. The fixes are generic host-service adaptations, not package-name patches: nested defaults, native whole-bundle toggles, constructor-declared services, session-routed registration slots, safe disposal and projection-handle reads.

All 12 bundles above passed independent dual-session activation, full cold restoration and repeated client toggles: **36/36 scenarios**. Each also started in an unmodified profile without the menu. Distinct translation settings and workspace inheritance survived restarts in rc.1 and rc.3. Menu unload/reload preserved client title and permission registrations. Desktop/mobile-width Web interaction checks and 70 regression tests passed. An additional 24 checks covered inactive configuration saves, enablement, live updates and cold restoration for official/ordinary plugins at all three levels on rc.1 and rc.3. Browser checks covered saving while disabled and fixed category navigation at both widths.

Tests used private profiles without user credentials. Recording, speech model downloads, paid model calls, live GitHub operations and real chat imports were not exercised. Mobile checks used a browser viewport, not the Android APK. This validates instance lifecycle compatibility, not every feature or arbitrary combination of bundles.
