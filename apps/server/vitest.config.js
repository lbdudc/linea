import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// The plugins have tests of their own that run with the server's (they use its test support and dependencies). Their repository
// (linea-plugins) is a checkout next to this one, or PLUGINS_DIR.
const plugins = process.env.PLUGINS_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../linea-plugins')

export default defineConfig({
  // @lbdudc/linea-git is linked from a sibling folder: its `gitlab-commando` has to be the very module the tests spy on
  resolve: { dedupe: ['gitlab-commando'] },
  // the plugins' own tests run with the server's: they use its test support and its dependencies
  server: { fs: { allow: ['../..', plugins] } },
  test: {
    include: ['src/**/*.test.js', `${plugins}/*/test/server/**/*.test.js`],
    watchExclude: ['**/tmp/**'],
    setupFiles: ['./src/test/support/env.setup.js', './src/test/support/netProbe.setup.js'],
    hookTimeout: 30000,
  },
})