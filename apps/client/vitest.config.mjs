import fs from 'node:fs';
import path from 'node:path';
import vue from '@vitejs/plugin-vue';
import { configDefaults, defineConfig } from 'vitest/config';
import { pluginDeps } from './plugin-deps.mjs';

const __dirname = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([a-zA-Z]:)/, '$1');

// where the plugins are: PLUGINS_DIR, or the `linea-plugins` checkout next to this one
const pluginsDir = process.env.PLUGINS_DIR || path.resolve(__dirname, '../../../linea-plugins');

export default defineConfig({
  plugins: [vue(), pluginDeps({ pluginsDir: pluginsDir, from: path.resolve(__dirname, 'src/main.js') })],
  resolve: {
    // plugin code lives outside this folder: it gets the app's copy of these
    dedupe: ['vue', 'vue-router', 'vue-i18n', 'pinia', 'primevue', 'axios', 'chart.js', 'vue-chartjs', '@vue/test-utils'],
    alias: {
      src: path.resolve(__dirname, 'src'),
      // the file icons of the code editor plugin (Material Icon Theme)
      'material-file-icons': path.resolve(__dirname, 'node_modules/material-icon-theme/icons'),
      app: path.resolve(__dirname, '.'),
      components: path.resolve(__dirname, 'src/components'),
      layouts: path.resolve(__dirname, 'src/layouts'),
      pages: path.resolve(__dirname, 'src/pages'),
      assets: path.resolve(__dirname, 'src/assets'),
      boot: path.resolve(__dirname, 'src/boot'),
      stores: path.resolve(__dirname, 'src/stores'),
    },
  },
  server: { fs: { allow: [path.resolve(__dirname, '../..'), pluginsDir] } },
  test: {
    environment: 'jsdom',
    // the first mount of a file imports its whole page: it can take longer than 5 s when the machine is busy
    testTimeout: 15_000,
    // (a plugin's own test setup, when that plugin is in the plugins folder)
    setupFiles: ['./src/test/setup.js', path.join(pluginsDir, 'agents-plugin/test/client/setup.js')].filter((file) => fs.existsSync(path.resolve(__dirname, file))),
    // the plugins' own tests run with the app's, so they see the same `src/` aliases
    include: ['src/test/**/*.test.js', `${pluginsDir}/*/test/client/**/*.test.js`],
    exclude: [...configDefaults.exclude, 'scripts/**'],
  },
});
