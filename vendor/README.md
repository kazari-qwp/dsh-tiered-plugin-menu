# Build/test fixture

`dsh-temporary-messages-0.1.10.tgz` is the unmodified MIT-licensed release package of the companion plugin by this project's contributors. Its license and source maps are included in the archive. SHA-256 is recorded in `SHA256SUMS`.

It supplies the original settings component during the build and the real plugin during tests. The menu's runtime does **not** require this package to be installed. No neighboring checkout or private GitHub access is needed to build this repository.

This fixture is excluded from the menu's npm tarball. The embedded client component keeps its notices in `THIRD_PARTY_NOTICES.txt`.

中文：这是同一作者的临时消息插件原始发行包，仅用于构建设置组件及真实插件测试；未改动包内文件。许可和源码映射均在包内。它让本仓库不再依赖旁边的私有仓库，运行菜单也无需预先安装临时消息。
