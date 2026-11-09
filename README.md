# DSH Tiered Plugin Menu

English | [简体中文](README.zh-CN.md)

**Enable or disable DSH plugins independently for each workspace and each session, with different settings for each.**

For example, enable a plugin only in your coding workspace and keep it off elsewhere. Use configuration A in one session and configuration B in another. Open the menu from the small plugin buttons in the sidebar, then expand **Settings** to use the plugin's original configuration UI.

Settings inherit through **client → parent workspace → child workspace → session**, at any workspace depth. Keep the parent's settings by default, or override them for a workspace or an individual session.

## Where to find the buttons

![Sidebar screenshot: the client plugin button sits beside the Workspaces heading, above the workspace and session rows](docs/images/sidebar-buttons.png)

- **Client plugins**: the **plug icon** beside the **Workspaces** heading sets the default plugins and configuration for the client.
- **Workspace plugins**: hover over a workspace row, then click its plug icon.
- **Session plugins**: hover over a session row, then click its plug icon.

Workspace and session buttons appear on hover, so they are hidden on the unhovered rows in this screenshot.

## Install

Download the prebuilt `.tgz` from [Releases](https://github.com/kazari-qwp/dsh-tiered-plugin-menu/releases), then add it in DSH's plugin page or run:

```sh
dsh plugin --profile desktop add ./dsh-tiered-plugin-menu-0.6.1.tgz
```

For Web, use your profile name (usually `web`). Restart DSH if hot reload is disabled. No companion plugin is required.

The release includes compiled host/browser code, the bundle patch and licenses. It needs no install-time build script. A GitHub source checkout must be built first; use the release tarball for installation. This follows the [official DSH packaging guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md).

## Use

- The plugin icon beside **Workspaces** opens client settings. Icons on workspace/session rows open that scope's settings.
- The outer list shows **one row per package**. Its **Inherit | Enable | Disable** buttons apply to every component in the package.
- Click a package to open its component list. Control components individually there; a mixed package displays **partially enabled**.
- **Settings** expands the original plugin configuration cards when available, with a JSON editor as fallback. Cards from both Settings and plugin details are shown separately, divided by a line.
- Disabling a scope blocks the inherited instance. An explicitly enabled child can still override a disabled parent.
- Client scope uses the original DSH entries and native switches; lower scopes create separate instances. The optional experimental isolation switch also gives client entries private environments. Leaving a view does not stop background agents.
- Disabling this menu releases its lower-scope instances, endpoints and UI while preserving saved settings for re-enabling. The original frontend is restored only for plugins enabled at client scope.
- Choosing another session changes the active frontend binding; visiting Insights or Settings keeps that binding.
- Updating an installed plugin replaces its scoped frontend and open configuration cards after DSH finishes reloading its module and CSS, keeping the selected session and its settings.

Example: client configuration A, workspace B, session C. That session uses C, inheriting sessions in its workspace use B, and other workspaces inherit A.

## Workspace tree inheritance

The menu's own Settings page includes **Inherit along workspace tree (按工作区树继承)**, enabled by default. Changes save and take effect immediately. The sidebar menus still edit plugins at each level.

The nearest registered ancestor directory is the parent, matching DSH's **Workspace Tree** grouping. Missing intermediate workspace registrations are skipped. Each plugin resolves its nearest explicit configuration; inheritance shares that ancestor's instance. Turning the switch off makes every workspace inherit directly from the client, while preserving explicit configurations and new-child defaults. Changing or deleting an ancestor also reconnects consumers of its services.

This describes directory hierarchy, not Agent ownership: a Superagent Worker can inherit its Router's workspace configuration when its directory is below the Router's directory, even though the Worker is not a native DSH subagent.

## Experimental plugin isolation

**Plugin isolation (experimental / 插件隔离（实验性）)** is the second switch in the menu's Settings. It is **off by default**, including on upgrade. Changes save immediately and take effect after restarting DSH.

It gives plugins relatively independent environments. This may fix some compatibility issues, but may also introduce new ones.

When enabled, isolation starts at client scope. It reuses the module loading, directory redirection, service routing and lifecycle handling of workspace/session instances. Tools, skills, commands, prompt sections and projection keys receive stable plugin-qualified names, so two plugins with the same tool name can both serve **the same session**. Explicit service dependencies remain connected; unrelated services stay private.

Private client data starts fresh in `<config-filename>.data/`; existing plugin directories stay in place. Turning isolation off and restarting returns client entries to their original data. Fixed ports, external processes, conflicting preset IDs, and plugin code that requires another plugin's original public names are not covered. [Tested behavior and limits](docs/PLUGIN_ISOLATION.md).

## Defaults for new children

Every menu opens on **This level (本级)** and has a **Children (下级)** tab. Children default to **Inherit (继承)**. Select **Independent (独立)** to edit plugin switches and reuse the original configuration cards for new children.

| Parent menu | Defaults apply to |
| --- | --- |
| Client | New top-level workspaces (all workspaces when tree inheritance is off), and new sessions without a workspace |
| Workspace | New ordinary sessions; new child workspaces when tree inheritance is on |
| Session | New subagents, recursively including their descendants |

Explicit on/off entries are copied into each new child; plugins left on Inherit continue to use their parent. Editing defaults starts no preview instance and changes no existing workspace, session or subagent. Resuming sessions, restarting DSH and reopening workspaces do not reapply defaults.

Subagents follow their actual parent chain to the nearest independent child policy. Without their own override, they use the parent's child defaults for later descendants. Each new instance receives its own configuration copy. An ordinary conversation fork is not classified as a subagent just because it records a parent session ID.

Nested workspaces similarly find the nearest workspace with independent child defaults. Existing children are never overwritten when a policy changes.

Scope settings live in `$DSH_HOME/plugins/tiered-plugin-menu.json`; the menu's `dataFile` option overrides that location. Client settings are persisted through DSH's native profile editor. Existing package-level settings migrate to component keys.

## Dependencies

Before changing switches, the menu calculates the complete affected set:

- Enabling a component lists any disabled dependencies and offers **Enable automatically / Cancel**.
- Disabling a provider lists enabled dependents and offers **Disable automatically / Cancel**. This includes descendant sessions that inherit the provider.
- A missing/uninstalled dependency produces an error and changes no switches. Nothing is installed automatically.
- Sharing a package is not itself a dependency. The outer package buttons deliberately operate the whole package; individual controls use declared DSH services and observed runtime dependencies.

Confirmation applies to switches operated through this menu; DSH's own plugin page remains native.

## Automatic directory isolation

When a lower instance creates or ensures a directory through Node's file APIs, the menu assigns it a private directory. Identical logical paths can hold different data in different instances. Inheritance shares the ancestor's instance and directory; explicit enablement uses an independent instance. Configured paths remain unchanged, with no field-name guesses or plugin-name adapters.

Relative paths and `..` resolve in the original logical namespace before redirection. `realpath` returns logical paths, so subsequent child/parent lookups keep their meaning. Tests cover ordinary file APIs and SQLite opening paths; two Superagent instances using the same `stateDir` hold separate directory locks and databases.

Data lives beside the menu configuration file in `<config-filename>.data/`, separated by scope and package. Menu restarts and session resumes reuse it. First use creates fresh private data; existing directories are neither moved nor deleted. See [test results and coverage](docs/DIRECTORY_ISOLATION.md).

## Compatibility

Current version: **0.6.1**. Tested with **DSH 0.2.2-rc.1** and Node.js 24. Package/component controls and dependency confirmation use shared DSH mechanisms, without adapters named after individual plugins or changes to DSH and third-party source code.

0.6.1 fixes sessions disappearing from the sidebar after opening them with experimental isolation enabled. Private helper services no longer replace host services. Existing session files remain intact; update and restart DSH. [Cause and regression checks](docs/PLUGIN_ISOLATION.md#061-session-restoration-fix).

Installed packages are discovered automatically. Packages without declared self-compatibility appear below the **Unverified self-compatibility (未验证自兼容性)** separator at lower scopes and require confirmation. Successful startup does not mark them verified.

The implementation isolates provided services per scope and routes shared DSH registries such as tools, prompts, commands, skills, projections and HTTP handlers. Lower instances are real Loader entries, so DSH can load the **installed package's original frontend and CSS**, even when its client-level instance is disabled. The menu embeds no third-party frontend copies.

Different plugins can also register same-named skill providers and skills. Discovery selects contributions visible to the current session, then DSH resolves skill priorities; unloading one contribution preserves the others. [Skill isolation and 0.5.2 regression results](docs/SKILLS.md).

Plugins with same-named tools can run in separate workspaces or sessions. Lower-instance tools use DSH's native per-agent registrations, keeping their own parameter schemas, executors and output renderers. The optional experimental switch extends this to same-session tool conflicts using distinct public names. [Tool isolation and 0.5.3 results](docs/TOOLS.md), [experimental isolation](docs/PLUGIN_ISOLATION.md).

Agent preset declarations are also scoped: identical preset IDs can have different workspace/session configurations without duplicate registration. Native preset IDs and revision leases are preserved, including a subagent retaining its parent's revision. The adapter uses the declaration table of the pinned DSH version; this is not a cross-version API guarantee. See [Superagent validation](docs/SUPERAGENT.md) for the tested workflow and remaining upstream issues.

The 0.2.1 update fix was reproduced against the released 0.2.0 menu and verified with unmodified dsh-context 0.82.2 → 0.83.0 frontend bundles, including Insights rendering, CSS replacement, retained session settings and temporary module removal/re-addition. [Update regression details](docs/CLIENT_UPDATES.md).

The isolated matrix covers ten packages. Temporary messages, dsh-context and notifications pass **54 functional switch combinations** across four sessions and two workspaces. Seven other samples were checked independently for lifecycle, separate configuration and frontend module availability; Clock's actual configuration component also passes two-session save checks. [Results, versions and reproduction](docs/COMPATIBILITY.md).

A second batch adds eight packages: Better Sidebar, Agent Teams, another memory plugin, Force Compact, Bill, Auto Mode, Workbench and Simplify. Their mixed lower-scope run passes **110/110 lifecycle/configuration cases**. It exposed and fixed a parse-only projection schema incompatibility in this menu. Workbench also reproduces a native route-cleanup failure without the menu. [Second-batch details](docs/SECOND_BATCH.md).

The 0.5.1 third batch mixes eight new packages with the previous eighteen. Excluding a memory-tool naming conflict that also occurs natively, all 25 packages pass **341/341 lower-scope lifecycle/configuration checks**. This exposed a missing skill-registry adapter: packaged skill providers and runtime skills now follow the selected workspace/session and release with their instance. [Third-batch results and native controls](docs/THIRD_BATCH.md).

`@fooxe/dsh-memory` has a reproducible native HTTP-route cleanup problem without this menu. Starting with its native instance disabled avoids that leftover registration in the tested lower-scope cases. This menu does not repair upstream native registrations.

This isolates configuration, lifecycle and the file access described above; it is **not a security sandbox**. Global files outside private mounts, hardcoded TCP ports, native addons and external-process file access are outside this layer. Not every third-party tool, UI action or remote endpoint has been exercised; custom frontends that bypass the tested DSH interfaces may need further work.

## Self-compatibility declaration

Self-compatibility means that multiple independent instances of the same plugin can coexist, with separate configurations and runtime state. Plugin authors can declare it with a boolean in `package.json`:

```json
{
  "dsh": {
    "tieredPluginMenu": {
      "selfCompatible": true
    }
  }
}
```

`true` declares self-compatibility at workspace, session and subagent scopes. `false` or an omitted field means unverified and retains the enable confirmation. It does not declare compatibility with other plugins. This is this menu's convention, not official DSH certification. Our companion plugin follows the same rule. The menu never writes declarations for another package.

In 0.5.4, `selfCompatible` replaces `supportsChildInstances`. Packages declaring the old field should rename it; the old field is no longer read.

## Development

```sh
npm ci --ignore-scripts
npm run check
npm pack
```

The checkout is self-contained. `vendor/` holds an unchanged MIT test fixture; no private repository access is needed. `check` covers type checking, building and 42 tests with real DSH services/plugins and React/jsdom. It uses neither browser automation nor paid model requests. Coverage includes child defaults, deep workspace trees, live inheritance changes, preset isolation and revision leases, session disposal/resume, native configuration cards and restart persistence.

The broader third-party matrix runs in a disposable offline VM; see [reproduction instructions](docs/COMPATIBILITY.md#reproduce). No sample packages are installed into a personal DSH profile by these instructions.

Core files: `src/manager.ts` (instances and scope inheritance), `src/dependencies.ts` (dependency plans), `src/runtime-tree.ts` (Loader entries), `src/isolation.ts` (private services), `src/scoped-services.ts` (shared registries), and `src/client/` (menus and original client bindings).

## License

[MIT](LICENSE): commercial use, modification and redistribution are permitted with the license notice retained. Bundled validation code and source test fixtures retain their notices in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
