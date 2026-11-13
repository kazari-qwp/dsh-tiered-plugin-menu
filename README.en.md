# DSH Tiered Plugin Menu

[简体中文](README.md) | English

**[Download center: Desktop / Web · TUI · dsh-go](https://kazari-qwp.github.io/dsh-tiered-plugin-menu/)** — Separate latest versions and download histories for each interface. The shared core installs automatically.

**Enable or disable DSH plugins, MCP servers and skills independently for each workspace and each session, with different settings for each.**

For example, enable a plugin only in your coding workspace and keep it off elsewhere. Use configuration A in one session and configuration B in another. Open the menu from the small plugin buttons in the sidebar, then expand **Settings** to use the plugin's original configuration UI.

Settings inherit through **client → parent workspace → child workspace → session**, at any workspace depth. Keep the parent's settings by default, or override them for a workspace or an individual session.

## Multi-platform components

All four packages are released as **1.0.0** and remain independently updatable. This release adds official plugin management, generic instance compatibility, configuration saves while disabled, and fixed Web category navigation. Saving preserves enablement; enabled plugins apply saves immediately. Existing users should update both the core and their interface to 1.0.0.

| Package | Role |
| --- | --- |
| `dsh-tiered-plugin-core` | Shared inheritance, instances, dependencies, MCP and Skills |
| `dsh-tiered-plugin-menu` | Existing desktop/Web UI, keeping the package name and configuration path |
| `dsh-tiered-plugin-tui` | Terminal panel using the host's React and dialogs |
| `dsh-tiered-plugin-go` | Native mobile menu and scope routing for other native plugin contributions |

Packages have independent versions. Adapters depend on a compatible core version range; a core patch does not require publishing all adapters. Interfaces attached to **one DSH host share one core and plugin instances**. Closing one interface leaves others and background tasks running. Separate DSH processes have separate managers.

All interfaces manage third-party and official plugins, MCP, Skills and child defaults. Web reuses original settings components; TUI edits fields and mobile uses JSON forms. See [TUI](packages/tui/README.md), [dsh-go](packages/dsh-go/README.md) and [architecture/testing](docs/COMPONENTS.md). Live tests cover TUI/Web in an isolated VM and the official Android APK connected to that VM, including UI operations and full cold starts. See [screenshots and coverage](docs/LIVE_UI_TESTING.md).

### Install one package for your interface

| Interface | Package |
| --- | --- |
| Desktop / Web | `dsh-tiered-plugin-menu` |
| dsh-TUI | `dsh-tiered-plugin-tui` |
| dsh-go | `dsh-tiered-plugin-go` |

Starting with Web 0.9.0 and TUI / dsh-go 0.2.0, each interface bundle declares a core component and an interface component. It automatically registers and enables the shared core through Harness package management. No separate core installation is required.

```sh
dsh plugin --profile <profile> add dsh-tiered-plugin-tui
```

Use the profile actually used by your interface. Restart when Harness requests it, then open **分级配置** in TUI's sidebar panel picker.

### Update in Harness

Click **Refresh** on the Plugins page, then update the package you want. Core and interface versions are managed separately. The interface's **Component versions** section links to core management.

Registry-installed 0.7.1 can upgrade directly to 0.9.0. One interface update adds core management automatically and preserves existing settings, including custom `dataFile` paths. Harness may require a restart after changing package locations. Later core fixes do not require an interface release. Local `.tgz` installs remain subject to Harness's local-source update limitations. [Upgrade verification](docs/COMPONENT_UPDATES.md).

## MCP and skills

The left navigation switches between **Plugins / Official plugins / MCP / Skill**. All categories reuse scope inheritance and new-child defaults. The child policy's Inherit/Independent switch covers every category; defaults are copied only when a child is created.

The official tab reads Harness bundle metadata, including locally shipped plugins that are disabled at client scope. Enable them independently for a workspace or session. Package controls affect all components; open details to configure individual components. Optional packages not present locally must first be installed through Harness. Host infrastructure is excluded.

Official and third-party packages share the same dependency and instance handling, without plugin-name-specific patches. Self-compatibility still comes from package metadata. Tests cover activation, cold restoration and disposal for 12 official bundles in rc.3; see [coverage and limitations](docs/OFFICIAL_PLUGINS.md).

- **MCP:** discovers existing `@deepseek-ai/dsh-mcp-client` entries and supports adding servers with JSON connection settings (stdio or streamable-http). Inherited configuration shares its parent's connection. A local override starts a separate connection, including a separate process for stdio. Tools, resources and server instructions follow the selected scope. Background connections survive navigation away from a session.
- **Skills:** lists filesystem and plugin-provided skills available in the current scope. Each can be enabled or disabled, with optional overrides for its description, body and model/user invocation flags. Overrides live in the menu's configuration; original files remain unchanged. Skill providers, scripts and resource directories remain shared. Changes affect subsequent skill discovery/loading, not text already in conversation history.

MCP command arguments, environment, working directory, URL and headers can differ per scope. Remote services and external-process storage are independent only when their configuration makes them so. Disabling the menu releases its added MCP connections and restores native DSH entries; enabling it restores saved scope settings.

See [resource tests and reproduction steps](docs/RESOURCES.md).

## Where to find the buttons

![Sidebar screenshot: the client plugin button sits beside the Workspaces heading, above the workspace and session rows](docs/images/sidebar-buttons.png)

- **Client plugins**: the **plug icon** beside the **Workspaces** heading sets the default plugins and configuration for the client.
- **Workspace plugins**: hover over a workspace row, then click its plug icon.
- **Session plugins**: hover over a session row, then click its plug icon.
- **New session**: after choosing a workspace, click **分级配置** to the right of the workspace and agent-preset controls above the composer. Configure the current session and its child defaults before sending the first message.
- **Conversation tab**: open **分级配置** at the top of a conversation to edit its own settings and new-child defaults for plugins, MCP and skills. Navigating into a child or grandchild agent targets the displayed session, preserving recursive parent-agent inheritance. The tab uses DSH's official slot and coexists with tabs from Context and other plugins.

Workspace and session buttons appear on hover, so they are hidden on the unhovered rows in this screenshot.

On rc.1, the conversation tab is another entry point to the existing session menu. On rc.2, it also works after navigating into a subagent. Both use the same configuration and inheritance logic; upgrading to rc.2 is not required.

## Install

In DSH, open **Plugins → Add plugin** and enter the npm package name:

```text
dsh-tiered-plugin-menu
```

If a registry mirror still serves the initial placeholder package, select the official npm registry and retry.

Or install from the command line:

```sh
dsh plugin --profile desktop add dsh-tiered-plugin-menu
```

Prebuilt `.tgz` packages are also available from [Releases](https://github.com/kazari-qwp/dsh-tiered-plugin-menu/releases).

For Web, use your profile name (usually `web`). Restart DSH if hot reload is disabled. No companion plugin is required.

The new core includes the inactive-plugin configuration fix from 0.8.1. See the [0.8.1 regression report](docs/CORE_0.8.1.md).

The release includes compiled host/browser code, the bundle patch and licenses. It needs no install-time build script. A GitHub source checkout must be built first; use the release tarball for installation. This follows the [official DSH packaging guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md).

## Use

- The plugin icon beside **Workspaces** opens client settings. Icons on workspace/session rows open that scope's settings.
- The outer list shows **one row per package**. Its **Inherit | Enable | Disable** buttons apply to every component in the package.
- Click a package to open its component list. Control components individually there; a mixed package displays **partially enabled**.
- **Settings** expands the original plugin configuration cards when available, with a JSON editor as fallback. Cards from both Settings and plugin details are shown separately, divided by a line.
- Official and third-party plugins can save configuration while locally disabled; enabling applies it. Saves apply immediately to enabled plugins and never change the enablement mode. Choose a local on/off override before editing inherited settings. The category navigation stays visible while the content scrolls.
- Disabling a scope blocks the inherited instance. An explicitly enabled child can still override a disabled parent.
- Client scope uses the original DSH entries and native switches; lower scopes create separate instances. The optional experimental isolation switch also gives client entries private environments. Leaving a view does not stop background agents.
- Closing an interface removes its UI. The last interface component releases lower-scope instances and endpoints, retaining saved settings. The original frontend is restored only for plugins enabled at client scope.
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

Components are published independently. Tested with **DSH 0.2.2-rc.1 / rc.2** and Node.js 24. Package/component controls and dependency confirmation use shared DSH mechanisms, without adapters named after individual plugins or changes to DSH and third-party source code.

0.7.1 removes the exact DSH version restriction: `engines.dsh` is omitted and DSH host peer dependencies use `*`, so this plugin's manifest no longer blocks DSH upgrades solely because the version changed. When `agents.isOwnedBy` is absent, the menu uses session metadata to identify parent sessions. Development dependencies remain pinned for reproducible builds and tests.

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
npm run pack             # All four components in dist/
npm run pack -- core     # Only the core package
```

The checkout is self-contained. `vendor/` holds an unchanged MIT test fixture; no private repository access is needed. `check` runs type checking, building and serial regression tests against real DSH services/plugins and React/jsdom. It uses neither browser automation nor paid models. Coverage includes inheritance, presets, lifecycle, configuration cards, MCP/Skills, shared-core leases and TUI keyboard interaction. Official dsh-go SDK/bridge checks run separately; see [component development](docs/COMPONENTS.md).

The broader third-party matrix runs in a disposable offline VM; see [reproduction instructions](docs/COMPATIBILITY.md#reproduce). No sample packages are installed into a personal DSH profile by these instructions.

Core implementation lives in `packages/core/src/`; the original Web client is in `packages/web/src/client/`. Terminal and mobile adapters live in `packages/tui/` and `packages/dsh-go/`.

Uninstall currently preserves configuration and private data outside the package directory. DSH updates also use removal/reinstallation, so data deletion is not tied to a generic removal or instance disposal. Reinstallation restores saved settings.

## License

[MIT](LICENSE): commercial use, modification and redistribution are permitted with the license notice retained. Bundled validation code and source test fixtures retain their notices in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
