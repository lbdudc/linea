import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import monacoEditorPluginModule from 'vite-plugin-monaco-editor';
import { pluginDeps } from './plugin-deps.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// where the plugins are: PLUGINS_DIR, or the `linea-plugins` checkout next to this one
const pluginsDir = process.env.PLUGINS_DIR || path.resolve(__dirname, '../../../linea-plugins');

const monacoEditorPlugin = monacoEditorPluginModule.default ?? monacoEditorPluginModule;

// A browser that closes a tab (or a websocket that drops) resets the proxied connection; Vite 2 does not handle the error that raises and
// the dev server exits. It is not a problem of the page: ignore it.
const ignoreResets = (proxy) => {
  proxy.on('error', () => {});
  proxy.on('proxyReqWs', (_proxyReq, _req, socket) => socket.on('error', () => {}));
};

export default defineConfig(({ command }) => {
  const dev = command === 'serve';

  return {
    build: {
      outDir: 'dist',
      target: ['es2019', 'edge88', 'firefox78', 'chrome87', 'safari13.1'],
      assetsInlineLimit: 4096,
    },

    assetsInclude: ['**/*.wasm'],

    resolve: {
      // plugin code lives outside this folder and has no node_modules of its own: it gets the app's copy of these
      dedupe: ['vue', 'vue-router', 'vue-i18n', 'pinia', 'primevue', 'axios', 'chart.js', 'vue-chartjs'],
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

        buffer: 'buffer',
        process: 'process/browser',
        stream: 'stream-browserify',
        events: 'events',
        util: 'util',
        vm: 'vm-browserify',
      },
    },

    define: {
      'process.env.API_URL': JSON.stringify(
        process.env.API_URL !== undefined ? process.env.API_URL : (dev ? 'http://localhost:9000' : ''),
      ),
      global: 'globalThis',
    },

    worker: {
      format: 'es',
    },

    plugins: [
      vue(),
      pluginDeps({ pluginsDir: pluginsDir, from: path.resolve(__dirname, 'src/main.js') }),

      monacoEditorPlugin({
        customDistPath(root, buildOutDir) {
          const base = path.isAbsolute(buildOutDir) ? buildOutDir : path.join(root, buildOutDir);
          return path.join(base, 'monacoeditorwork');
        },
      }),
    ],

    server: {
      // Vite 2 defaults to 3000, the server's port; OAuth's REDIRECT_URI and API_URL expect the client on 9000
      port: 9000,
      strictPort: true,
      open: true,
      // the plugins (their own repository, linea-plugins, next to this checkout) are part of the app
      fs: { allow: [path.resolve(__dirname, '../..'), pluginsDir] },
      proxy: {
        '/api': { target: process.env.LINEA_SERVER ?? 'http://127.0.0.1:3000', changeOrigin: true, configure: ignoreResets },
        // the repositories of the local git host, to `git clone` and `git push`
        '/git': { target: process.env.LINEA_SERVER ?? 'http://127.0.0.1:3000', changeOrigin: false, configure: ignoreResets },
        '/socket.io': { target: process.env.LINEA_SERVER ?? 'http://127.0.0.1:3000', changeOrigin: true, ws: true, configure: ignoreResets },
      },
    },
  };
});
