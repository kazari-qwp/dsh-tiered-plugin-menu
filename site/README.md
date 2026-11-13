# 下载中心

GitHub Pages 地址：https://kazari-qwp.github.io/dsh-tiered-plugin-menu/

页面按 Release 附件的包名分类、按组件版本排序，不依赖 GitHub 的 Latest 标记或发布时间。只列正式 Release 的稳定版本 .tgz，核心单独发布不会改变其他端的最新版。历史列表只包含已有 GitHub 附件的版本。

`site/build.mjs` 使用 Node 内置模块生成 `_site/`，不构建或修改插件包。浏览器无需请求 GitHub API，下载链接直接指向原 Release 附件。

```sh
node --test site/build.test.mjs
node site/build.mjs
```

可设置 `GITHUB_TOKEN` 使用认证 API；本地也可以先将 Release API 返回的数组保存为 JSON，再执行 `node site/build.mjs path/to/releases.json`。

工作流在网站文件修改、正式 Release 发布/编辑/删除时部署，也支持在 Actions 中手动运行 **Download center**。创建 Release 时先在草稿中上传附件，再发布；如果后来补传了附件，编辑并保存 Release 说明或手动运行工作流即可刷新列表。无需增加插件版本或发布 npm。
