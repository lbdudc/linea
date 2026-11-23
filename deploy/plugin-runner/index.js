import { createRunner } from './app.js';

const port = Number(process.env.PORT || 7070);
const pluginsDir = process.env.PLUGINS_DIR;
if (!pluginsDir) throw new Error('PLUGINS_DIR is needed: the folder of the plugins, at the same path the Docker host sees it (compose build contexts are resolved by the host).');

createRunner({ pluginsDir, key: process.env.PLUGIN_RUNNER_KEY }).listen(port, () => console.log(`[plugin-runner] listening on :${port}, plugins in ${pluginsDir}`));
