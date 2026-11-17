# Example plugins

Two plugins that follow [`plugins.md`](../plugins.md). Point a server at this folder with `PLUGINS_DIR=$PWD/docs/linea/plugin-examples`. That reaches the server side only: for `hello-plugin`'s pages, copy or symlink the folder to `<checkout>/../plugins` and rebuild the client.

| | Kind | Shows |
|---|---|---|
| `hello-plugin` | in-process, with a web side | `ctx.router`, `ctx.settings`, `ctx.onSettingsChange`, `ctx.events.on`; `ui.addNav`, `addRoute`, `addSlot`; public settings |
| `echo-plugin` | remote (a Node service, `service/server.js`) | `remote.health` / `remote.events`, signature check, `serviceKey` and `X-Act-As`, a `url` and a `secret` setting |

The echo service: `EVENT_WEBHOOK_SECRET=… LINEA_URL=http://localhost:3000 ECHO_SERVICE_KEY=… node docs/linea/plugin-examples/echo-plugin/service/server.js`. It carries a copy of the SDK in [`sdk/`](../../../sdk) (`service/linea-plugin-sdk.js`): the plugin's folder is all that is deployed.

`server/src/test/pluginExamples.test.js` loads both through the real host.
