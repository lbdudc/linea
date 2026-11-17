import pkg from '../package.json';

/** The window. Kept out of index.tsx so that `--version`, `help` and one-shot commands do not load the renderer and its native library. */
export async function runInteractive(): Promise<void> {
  const { render } = await import('@opentui/solid');
  const { App } = await import('./app.js');
  await render(() => <App version={pkg.version} />, { exitOnCtrlC: false });
}
