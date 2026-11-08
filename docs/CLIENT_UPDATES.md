# Frontend update regression / 前端更新回归

Tested on 2026-11-09 with DSH 0.2.2-rc.1, Node.js 24.22.2, in the same disposable offline VM used for the compatibility matrix. Third-party code was not executed on the personal desktop during these tests.

## Reproduction and fix

The 0.2.0 menu retained a plugin's old frontend export and cached settings cards after DSH replaced the module. The native module loader disposes the old runtime and its CSS, so scoped panels could disappear and old settings cards could remain mounted.

The menu now observes completion of native module-graph updates, reads the current Loader export, and rebuilds scoped panels and configuration cards when that export changes. Session selection and forms survive the replacement. If the package temporarily disappears from the graph, its old panels/cards are disposed until the replacement arrives. No plugin-specific adapter or third-party source edit is involved.

## Results

| Case | Native control | Menu 0.2.0 | Menu 0.2.1 |
| --- | --- | --- | --- |
| Generic module factory replacement | Pass | Scoped panels disappear | Pass |
| Original dsh-context 0.82.2 → 0.83.0 frontend update | Pass | Expected 2 conversation panels, received 0 | Pass |
| CSS replacement, Insights component render, retained session settings | Pass | Update regression above prevents completion | Pass |
| Module removed and re-added | Pass | — | Pass |

The core suite passes **23/23** checks. New regression coverage also verifies that all matching Settings/detail configuration cards render separately with dividers, and that their edits use the selected scoped form.

These checks exercise DSH's real ClientModuleSystem and Loader with React/jsdom, not a desktop click-through or the package-download/update endpoint. Network requests from the rendered context UI return local empty fixtures. The update script takes an unchanged replacement frontend bundle as input:

```sh
# Inside the offline VM, after building this repository:
./node_modules/.bin/tsx scripts/compatibility/client-update.ts /tmp/context-client-0.83.0.js
# Optional third argument: an older menu's dist/client/index.js for the failing control.
```

## 中文

0.2.0 菜单缓存了旧的前端导出和配置卡，DSH 更新插件模块后没有重新绑定。原生加载器已回收旧运行实例和 CSS，此时下级面板可能消失，打开的设置页仍使用旧组件。

修复后等待原生模块图更新结束，再读取当前导出并重建面板、配置卡；保留会话选择和配置。更新过程中包暂时移出模块图时，先移除旧界面，待新版到达后恢复。实现不包含具体插件名称适配。

使用未经修改的 context 0.82.2 与 0.83.0 前端包：不装菜单的对照通过；旧菜单复现了应有两个会话面板却得到零个；修复版通过面板、CSS、洞察页渲染、配置保留及移除后重载测试。完整测试 **23/23** 通过。

这些是断网虚拟机中的原生加载器与 React/jsdom 测试，没有点击桌面更新按钮，也没有测试下载更新接口。设置页和详情页同时提供配置卡时，也验证了全部显示、横线分隔及本层配置写入。
