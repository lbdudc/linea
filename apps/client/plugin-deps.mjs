import path from 'node:path';

/**
 * Plugin code lives outside this folder, in `plugins/`, and has no `node_modules` of its own: what it imports that is not a relative path
 * (vue, primevue, a chart library, the aliases of the app...) is resolved as if the app itself imported it. One copy of each, the app's.
 */
export const pluginDeps = ({ pluginsDir, from }) => {
  const posix = (file) => file.replaceAll('\\', '/');
  const dir = `${posix(path.resolve(pluginsDir))}/`;
  return {
    name: 'linea-plugin-deps',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !posix(importer).startsWith(dir)) return null;
      if (source.startsWith('.') || source.startsWith('/') || source.startsWith('\0') || /^[a-z]+:/i.test(source)) return null;
      return this.resolve(source, from, { ...options, skipSelf: true });
    },
  };
};
