# 下载中心部署

下载中心的 GitHub Pages 环境保护规则保持不变。发布事件（published、edited、deleted）只请求在 `master` 上运行 `downloads.yml`，不直接构建或部署标签中的代码。该请求使用 GitHub 自带的 `GITHUB_TOKEN`，只有 dispatch job 获得 `actions: write`；无需新增 PAT 或放开标签部署。

新的 master 运行重新读取 Releases，并从 master 构建下载中心，在同一次运行中上传和部署产物。它不下载发布事件运行的产物。master 的站点变更仍自动部署，也保留手动入口。

发布事件的成功仅表示请求已提交，最终部署结果请查看随后在 master 上运行的 **Download center**。需要手动恢复时，在 Actions → Download center → Run workflow 中选择 **master**，不要重跑旧的标签部署任务。

此修复合入后，应从包含修复的新提交创建后续发布标签。旧标签仍保存旧工作流，编辑或删除旧 Release 时可能仍触发旧流程；可按上述方式手动恢复，不必移动历史标签。

参考：[GitHub 的 GITHUB_TOKEN 触发例外](https://docs.github.com/en/actions/concepts/security/github_token)。workflow_dispatch 可由 GITHUB_TOKEN 触发，普通 push 等事件不具有这一例外。
