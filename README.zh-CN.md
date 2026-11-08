# 分级插件菜单

[English](README.md) | 简体中文

为 DeepSeek Harness 插件提供 **客户端 → 工作区 → 会话** 三层配置，最近的明确设置优先。工作区内的会话共用一个工作区实例；单独启用的会话拥有自己的实例和配置。

这是早期版本，测试环境为 **DSH 0.2.2-rc.1**、Node.js 24。不修改 DSH 核心或被管理插件。分级隔离不是插件安全沙箱。

## 安装

从 [Releases](https://github.com/kazari-qwp/dsh-tiered-plugin-menu/releases) 下载构建好的 `.tgz`，在 DSH 插件页添加，或执行：

```sh
dsh plugin --profile desktop add ./dsh-tiered-plugin-menu-0.1.11.tgz
```

Web 版换成自己的 profile 名称，通常是 `web`。未开启热重载时重启 DSH。无需预先安装临时消息插件。

发行包包含宿主和浏览器构建产物、bundle patch 与许可，无需安装时执行构建脚本。GitHub 源码需要先构建才能加载，推荐通过 Release 的 tarball 安装。这是 [DSH 官方打包教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.zh.md)支持的分发方式。

## 使用

- 侧栏「工作区」总标题旁的插件图标打开客户端配置；各工作区、会话行上的图标打开对应层级配置。
- 每行提供 **继承｜启用｜关闭** 三段按钮。「设置」展开配置，点击插件名称进入 DSH 原生详情页。
- 本层关闭后不再执行继承来的实例；下级明确启用仍可覆盖上级关闭。
- 客户端级使用 DSH 原有实例和开关，下两级创建独立实例。离开页面不会卸载后台会话的实例。
- 选中另一个会话时切换前端绑定；进入洞察、设置等页面保留当前绑定。

例如客户端配置 A、工作区配置 B、其中一个会话配置 C：该会话用 C，同工作区其他继承的会话用 B，其他工作区继承 A。

分层配置保存在 `$DSH_HOME/plugins/tiered-plugin-menu.json`，可通过菜单插件的 `dataFile` 更改。客户端配置通过 DSH 原生配置编辑器写入 profile。

## 兼容情况

所有已安装插件都会列入客户端级。下两级不根据「启动成功」自动认定兼容：未验证插件单独分组，启用前需要二次确认。

| 插件 | 已测下级行为 |
| --- | --- |
| dsh-temporary-messages 0.1.10 | 真实 Agent 输入尾部、独立配置、继承、生命周期及原设置页 |
| dsh-context 0.82.2 | 提示词、统计投影和 HTTP 路由分层；原设置页、上下文及洞察组件 |
| dsh-notification 0.1.2 | 事件过滤、本机 webhook 实际投递；未验证浏览器和系统通知 |
| 其余样本 | 仍有不兼容项，见下方报告 |

沙箱测试包含十个包，覆盖热门和小众项目。十个包单独启动、原生混装、加入菜单后客户端混装均通过。三个功能样本在两个工作区、四个会话中通过全部 **54 组开关组合**。其他样本发现了共享服务/HTTP 注册冲突、下级前端模块缺失及多入口包限制，**不宣称兼容**。[完整结果与复现方法](docs/COMPATIBILITY.md)。

当前不通用处理多入口 bundle、任意第三方前端和设置页、插件自己的全局存储及全局服务注册。固定端口插件不在兼容范围内。未适配插件的失败试验可能需要重启 DSH 才能恢复原生注册。

临时消息和 dsh-context 的原客户端组件已嵌入，因此不必先开启它们的全局后端。其他插件在下级使用 JSON 配置编辑器；这不代表其前端或内部存储已经按层隔离。

## 兼容性声明

插件作者可以在 `package.json` 声明自己验证过的层级：

```json
{
  "dsh": {
    "tieredPluginMenu": {
      "verifiedScopes": ["workspace", "session"]
    }
  }
}
```

这是本菜单的约定，不是 DSH 官方认证。缺少声明即视为未验证，自家临时消息插件也遵循同样规则。菜单不会代替其他插件写入验证声明。

## 开发

```sh
npm ci --ignore-scripts
npm run check
npm pack
```

构建可在独立 checkout 中完成。`vendor/` 包含未经改动的 MIT 临时消息测试依赖，不需要访问私有仓库。`check` 执行类型检查、构建和 15 项测试，使用真实 DSH 服务/插件及 React/jsdom，不使用浏览器自动化或付费模型。

大规模第三方测试单独在一次性隔离虚拟机内运行，见 [兼容性测试说明](docs/COMPATIBILITY.md#reproduce)。复现时不要把待测第三方插件安装进个人 DSH 实例。

主要文件：`src/manager.ts` 管理实例和继承；`src/routing.ts` 过滤事件；`src/scoped-services.ts` 转发已适配的注册；`src/catalog.ts` 自动发现插件；`src/client/` 实现菜单和组件适配。

## 许可

[MIT](LICENSE)，允许商用、修改和分发，保留许可声明即可。内嵌第三方组件保留原 MIT/Apache-2.0 声明，见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)。
