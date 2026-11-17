import fs from 'node:fs';
import path from 'node:path';

/**
 * Plugin code lives outside this folder, in `plugins/`, and has no `node_modules` of its own: what it imports that is not a relative path
 * (vue, primevue, a chart library, the aliases of the app...) is resolved as if the app itself imported it. One copy of each, the app's.
 */
export const pluginDeps = ({ pluginsDir, from }) => {
  const posix = (file) => file.replaceAll('\\', '/');
  const dir = `${posix(path.resolve(pluginsDir))}/`;
  const virtual = 'virtual:linea-plugins';
  return {
    name: 'linea-plugin-deps',
    enforce: 'pre',
    // `import available from 'virtual:linea-plugins'`: { <plugin id>: () => import(<its client/index.js>) } for every plugin of the folder
    load(id) {
      if (id !== '\0' + virtual) return null;
      const entries = fs.existsSync(dir)
        ? fs.readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'client', 'index.js')))
            .map((e) => `  ${JSON.stringify(e.name)}: () => import(${JSON.stringify(`${dir}${e.name}/client/index.js`)}),`)
        : [];
      return `export default {\n${entries.join('\n')}\n}`;
    },
    async resolveId(source, importer, options) {
      if (source === virtual) return '\0' + virtual;
      if (!importer || !posix(importer).startsWith(dir)) return null;
      if (source.startsWith('.') || source.startsWith('/') || source.startsWith('\0') || /^[a-z]+:/i.test(source)) return null;
      return this.resolve(source, from, { ...options, skipSelf: true });
    },
  };
};
