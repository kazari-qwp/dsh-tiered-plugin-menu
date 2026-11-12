# 实际 TUI / Web 界面测试

2026-11-12，在 Ubuntu 24.04 虚拟机内安装开发 tarball，加载实际的 dsh-TUI 0.19.0 与 DSH 0.2.2-rc.1。Web 和 TUI 使用同一个 Node 后端、同一个分级核心。终端通过 tmux / xterm 运行，Web 使用 Chromium；截图来自实际窗口。

虚拟磁盘、依赖缓存、临时文件和截图保存在 E 盘。测试进程使用独立账户和仅有 loopback 的网络命名空间，未导入个人凭据或会话，未调用付费模型。测试的是实际界面与真实 DSH/MCP 服务，截图中的会话没有模型回复。

## 冷启动验收要求

后续界面和生命周期改动必须包含冷启动：完全退出 DSH 后端与客户端进程，再从实际安装包启动。热运行时切换开关和重新加载插件不能替代冷启动验收。分别检查新配置首次启用，以及已有配置在新进程中的恢复；检查实际入口、页面和数据，不能只依据后端状态或“保存成功”。多端测试同时覆盖独立启动与共享后端。

2026-11-12 的共享核心回归：Web 适配器独立安装时，核心没有自己的 Loader 父入口，导致下级后端运行正常，但 DSH 无法发现对应的前端模块。修复把这些临时入口登记到根索引，释放时移除，不写入客户端 profile。未修改外部插件。

在实际 DSH rc.2 + 原版 dsh-context 0.83.0 中复现并验证：客户端关闭、会话独立启用；冷启动恢复已有会话；插件隔离开启；上下文统计页面正常显示；切到未启用的会话隐藏入口。后端和 Chromium 均重新启动，模型回复由本地固定测试适配器生成。页面无 JavaScript 错误。60 项自动回归通过，另补充共享核心入口发现、索引解析、多界面存活和最后释放的断言。

![冷启动后，会话独立启用 context](images/live-ui/context-cold-isolated.png)

## 原有多端验收

| 操作 | 结果 |
| --- | --- |
| Web 打开客户端和工作区菜单 | 插件 / MCP / Skill 标签、本级 / 下级、开关与展开配置可用 |
| 原“临时消息”配置页 | 复用原组件；Web 保存模板后，TUI 字段编辑器读到同一值 |
| TUI 修改模板 | Web 重新打开配置页读到 TUI 的修改 |
| 下级默认 | TUI 可切换独立默认，并执行插件启用的二次确认 |
| MCP | Web 添加真实 stdio 测试服务，TUI 中可发现同一个服务器 |
| Skill | 加载真实 SKILL.md；客户端正文覆盖被工作区继承，工作区独立正文被 TUI 当前会话继承；会话关闭技能后显示关闭 |
| 重启 | 重启真实宿主后仍能读取已保存的配置 |
| 单独关闭 Web 适配入口 | 核心仍存在，TUI 面板仍可刷新和读取配置 |
| 布局 | 检查 1280×900、800×700 Web 窗口及 160×48、110×32 终端；控件未重叠，窄终端提示正常换行 |

## 实测发现并修复

1. TUI 限制插件从根 Context 挂载组件。改为显式核心 bundle 在自己的 Context 挂载，TUI 等待该服务；不绕开宿主限制。
2. 多入口包可以保留当前宿主没有安装的旧版组件。列出禁用组件时不再因缺少模块而中止整个菜单；真正启用不存在的模块仍会报错。
3. 原配置可以含 Loader 的 `!!js` 表达式。读取时使用 Loader 自带的求值接口，再按原插件 schema 解析，不修改保存的表达式。
4. TUI 中部分组件启用的包此前显示“关闭”，改为“部分启用”。

修复均针对通用接口，未修改 DSH、dsh-TUI 或外部插件源码。自动回归另覆盖核心重开、旧 Web 入口、插件隔离、MCP/Skill、子/孙代理继承以及 dsh-go 原生注册路由。

最终 `npm run check`：类型检查、构建、60 项测试全部通过。`npm run test:go -- <dsh-go 源码目录>`：官方 NativeCore 多实例路由、数据订阅、释放和 SDK 菜单校验通过。四个组件已重新打包，仍为未发布开发产物。

## 截图

Web 插件列表：

![实际 Web 插件菜单](images/live-ui/web-client.png)

Web 窄窗口中的工作区 Skill 配置：

![800×700 Web 窗口](images/live-ui/web-narrow.png)

TUI 下级默认设置：

![实际 TUI 下级默认](images/live-ui/tui-children.png)

TUI 当前会话读到工作区独立 Skill 正文：

![实际 TUI 技能配置](images/live-ui/tui-skill.png)

## 范围与限制

- 该版本官方 TUI 的依赖声明只接受到 DSH rc.1，rc.2 会跳过其 bundle。这次未放宽或修改官方声明，TUI 视觉测试使用 rc.1。此前的 rc.2 后端测试不能当作 rc.2 TUI 实测。
- Web 显示“连接异常，刷新重试”；在完全不加载分级核心和三个适配器的同版本对照 profile 中也复现。菜单 HTTP 请求与配置操作可用；这次未修复该宿主连接现象，也未据此宣称所有 Web 订阅和会话导航均正常。
- 没有运行 Android 真机或模拟器；dsh-go 仍是官方 SDK / 原生桥接层测试，不宣称通过了手机界面验收。虚拟机未提供 `/dev/kvm`。
- 这次不是所有外部插件、所有 TUI 终端类型的全量兼容认证。

## TUI profile 要点

安装核心依赖文件与启用核心 bundle 是两步。已有的 TUI profile 应包含以下 bundle 顺序（其余既有 bundle 保留）：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-tiered-plugin-core",
        "@deepseek-harness-tui/dsh-tui",
        "dsh-tiered-plugin-menu",
        "dsh-tiered-plugin-tui"
      ]
    }
  }
}
```

未发布组件用本地 tarball 和包管理器 override 安装；不要把开发机 `file:` 路径写进发布依赖。

## English

Cold-start verification is required for future UI and lifecycle changes: stop both host and client processes, launch the installed artifacts, and check first activation and persisted-state restoration in the actual UI. Reloading a plugin in a warm process is insufficient. A shared-core regression was reproduced and fixed by exposing otherwise detached runtime entries in the Loader root index without persisting them. Live DSH rc.2 / unmodified dsh-context 0.83.0 checks passed with the client plugin disabled, session activation, isolation enabled, cold restoration, and hiding the UI in another session.

Live VM testing used Ubuntu 24.04, real dsh-TUI 0.19.0 and DSH rc.1, with Web sharing the same host. It verified bidirectional settings edits, child defaults, a real stdio MCP endpoint, filesystem Skill overrides, restart persistence, and a surviving TUI after unloading the Web adapter. Screenshots cover normal and narrow layouts. No credentials or paid model calls were used.

The fixes address explicit core ownership under TUI's root-mutation restriction, disabled missing bundle entries, Loader configuration expressions, and partial package status. An offline Web connection indicator also reproduced in the upstream-only baseline. Android UI and rc.2 TUI remain unverified; the tested upstream TUI release rejects rc.2 in its own dependency declaration.
