// The bundler must not touch these: they are files of /public (see scripts/copy-bango-worker.js), and it would rewrite an import of
// them (the dev server refuses to serve a file of /public as a module). A native dynamic import loads them as the browser finds them.
const nativeImport = new Function('url', 'return import(url)')

/**
 * bango's libraries for the metamodel studio: the worker client, the renderer's views, the studio itself, and Monaco (which is this
 * page's own, so there is one copy of it).
 */
export const loadBangoLibraries = async () => {
  const [{ connectBango }, rendererLibrary, studioLibrary, monaco] = await Promise.all([
    nativeImport('/bango/client.js'),
    nativeImport('/bango/renderer.js'),
    nativeImport('/bango/studio.js'),
    import('monaco-editor'),
  ])
  return { connectBango, rendererLibrary, studioLibrary, monaco }
}

/** An engine in a worker: bango restarts it, with the offending script switched off, if a script never returns. */
export const startEngine = (connectBango) => connectBango(() => new Worker('/bango/bango.worker.js', { type: 'module' }))
