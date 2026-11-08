# DSH Tiered Plugin Menu

English | [简体中文](README.zh-CN.md)

Configure DeepSeek Harness plugins at three levels: **client → workspace → session**. The nearest explicit setting wins. Workspace instances are shared by their sessions; session instances have their own configuration and lifecycle.

This is an early implementation, tested with **DSH 0.2.2-rc.1** and Node.js 24. It does not modify DSH or the managed plugins. It is **not a security sandbox** for plugins.

## Install

Download the prebuilt `.tgz` from [Releases](https://github.com/kazari-qwp/dsh-tiered-plugin-menu/releases), then add it in DSH's plugin page or run:

```sh
dsh plugin --profile desktop add ./dsh-tiered-plugin-menu-0.1.11.tgz
```

For the Web application, substitute your profile name (usually `web`). Restart DSH if hot reload is disabled. Installing the companion temporary-messages plugin is optional.

The release tarball contains the compiled host and browser code, bundle patch and licenses. It needs no install-time build script. The GitHub source checkout must be built before it can be loaded; the release tarball is the supported distribution method. See the [official DSH packaging guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md).

## Use

- The plugin icon beside the sidebar's **Workspaces** heading opens client settings.
- Icons on workspace and session rows open settings for that specific scope.
- Each row offers **Inherit | Enable | Disable**. Click **Settings** to expand its configuration, or click the plugin name to open DSH's native details page.
- Disabling a scope blocks its inherited instance. Explicitly enabling a child still overrides a disabled parent.
- Client scope uses the original DSH instance and native switch. Lower scopes create additional instances. Closing a view does not stop background agents.
- Switching to another session changes the active panel binding. Visiting Insights or Settings preserves the current binding.

Example: client config A, workspace config B, session config C. That session uses C, other inheriting sessions in its workspace use B, and other workspaces inherit A.

Configurations are stored in `$DSH_HOME/plugins/tiered-plugin-menu.json`; the menu's `dataFile` option can override this path. Client settings are saved through DSH's native profile configuration editor.

## Compatibility

Every installed plugin is discovered at client level. Lower-scope compatibility is not inferred from successful startup. Unverified plugins appear below a separator and require a second confirmation before activation.

| Plugin | Tested lower-scope behavior |
| --- | --- |
| dsh-temporary-messages 0.1.10 | Real Agent input tail, independent settings, inheritance, lifecycle and original settings UI |
| dsh-context 0.82.2 | Scoped prompts, projections and HTTP requests; original settings, context and Insights components |
| dsh-notification 0.1.2 | Event routing and loopback webhook delivery; browser/OS notifications not verified |
| Other sampled plugins | Several incompatibilities remain; see the report below |

The sandbox matrix tested ten packages, including popular and small projects. All ten started individually and together, with and without the menu. Three functional samples passed all **54 switch combinations** across four sessions and two workspaces. The other samples revealed shared service/HTTP registrations, missing lower-scope frontend modules, and unsupported multi-entry bundles. These are **not** claimed to be compatible. [Full results and reproduction](docs/COMPATIBILITY.md).

Known limits include multi-entry bundles, arbitrary third-party frontend/settings integration, plugin-owned global storage and global service registries. Fixed-port plugins are outside the compatibility scope. Failed experiments with unadapted plugins can require a DSH restart to restore their native registrations.

The original client components of temporary-messages and dsh-context are embedded for use when their global backend is disabled. Other plugins receive a JSON configuration editor at lower scopes; this does not automatically scope their frontend or private storage.

## Compatibility declaration

A plugin may declare which lower scopes its author has verified:

```json
{
  "dsh": {
    "tieredPluginMenu": {
      "verifiedScopes": ["workspace", "session"]
    }
  }
}
```

This is a convention of this menu, not an official DSH certification. Missing metadata means unverified, including for our own companion plugin. The menu never writes a verification declaration on another plugin's behalf.

## Development

```sh
npm ci --ignore-scripts
npm run check
npm pack
```

The build is self-contained. `vendor/` holds the unchanged MIT companion-plugin fixture needed by the build and tests. No private repository access is required. `check` covers type checking, packaging and 15 focused tests with real DSH services/plugins and React/jsdom, without browser automation or paid model requests.

The larger third-party matrix runs separately in a disposable isolated VM. See [the compatibility instructions](docs/COMPATIBILITY.md#reproduce). Do not run downloaded third-party code in your personal DSH profile merely to reproduce this matrix.

Core files: `src/manager.ts` (instances and inheritance), `src/routing.ts` (event routing), `src/scoped-services.ts` (adapted registries), `src/catalog.ts` (discovery), `src/client/` (menus and component adapters).

## License

[MIT](LICENSE): commercial use, modification and redistribution are permitted with the license notice retained. Bundled third-party components retain their MIT/Apache-2.0 notices in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
