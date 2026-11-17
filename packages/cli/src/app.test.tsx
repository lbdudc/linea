import { test, expect, beforeAll, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { testRender } from '@opentui/solid';
import { App } from './app.js';

const cwd0 = process.cwd();
beforeAll(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-test-'));
  process.env['LINEA_HOME'] = home;
});
// the window moves the process into the SPLs it makes (that is what `cd` is for): each test starts where the others did, signed out
beforeEach(() => {
  delete process.env['LINEA_TOKEN'];
});
afterEach(() => {
  process.chdir(cwd0);
});

// every SPL is made of the feature metamodel (and what it needs): a workspace of the tests holds copies of the real ones
function withFeatureMetamodel(workdir: string): void {
  // the metamodels repository (linea-metamodels next to this checkout, or LINEA_METAMODELS_DIR)
  const metamodels = path.join(process.env['LINEA_METAMODELS_DIR'] ?? path.resolve(import.meta.dir, '../../../linea-metamodels'), 'metamodels');
  for (const name of ['common', 'featuremodel']) {
    if (fs.existsSync(path.join(workdir, 'metamodels', name)) || !fs.existsSync(path.join(metamodels, name))) continue;
    fs.mkdirSync(path.join(workdir, 'metamodels'), { recursive: true });
    fs.cpSync(path.join(metamodels, name), path.join(workdir, 'metamodels', name), { recursive: true });
  }
}

function isolatedHome(state: Record<string, unknown> = {}): { workdir: string; restore: () => void } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-test-home-'));
  const workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'linea-test-workdir-')));
  // every SPL is made of the feature metamodel: the workspace holds it
  withFeatureMetamodel(workdir);
  fs.mkdirSync(path.join(home, '.linea'), { recursive: true });
  fs.writeFileSync(path.join(home, '.linea', 'credentials.json'), JSON.stringify({ workdir, ...state }));
  const previous = process.env['LINEA_HOME'];
  process.env['LINEA_HOME'] = home;
  return {
    workdir,
    restore: () => {
      process.chdir(cwd0);
      process.env['LINEA_HOME'] = previous;
      // the list watches folders, and Windows keeps a watched one busy for a moment after the window closes: removed in the background
      const gone = { recursive: true, force: true, maxRetries: 20, retryDelay: 100 };
      for (const dir of [home, workdir]) void fs.promises.rm(dir, gone).catch(() => {});
    },
  };
}

/** The text of the prompt line: what is typed after the ❯. */
const prompt = (frame: string): string => (/│ ❯ (.*?)\s*│/.exec(frame)?.[1] ?? '').trim();
const footer = (frame: string): string => frame.split('\n').filter((l) => l.trim()).at(-1) ?? '';

test('mounts and renders the welcome panel, prompt and status line', async () => {
  const t = await testRender(() => <App version="9.9.9" />, { width: 100, height: 30 });
  await t.renderOnce();
  const frame = t.captureCharFrame();
  expect(frame).toContain('Welcome to LINEA');
  expect(frame).toContain('v9.9.9');
  expect(frame).toContain('❯');
  expect(frame).toContain('? shortcuts');
  t.renderer.destroy();
});

test('typing "/he" surfaces the /help completion, Tab accepts it', async () => {
  const t = await testRender(() => <App version="9.9.9" />, { width: 100, height: 30 });
  await t.renderOnce();

  await t.mockInput.typeText('/he');
  await t.waitForFrame((f) => f.includes('/help'));

  t.mockInput.pressTab();
  await t.waitForFrame((f) => f.includes('/help ') && !f.includes('type / for commands'));
  t.renderer.destroy();
});

test('help lists the commands, the useful ones for where you are first', async () => {
  // the listing is grouped and longer than a small screen
  const t = await testRender(() => <App version="9.9.9" />, { width: 100, height: 160 });
  await t.renderOnce();

  await t.mockInput.typeText('help');
  t.mockInput.pressEnter();
  await t.waitForFrame((f) => f.includes('Start here') && f.includes('spl new') && f.includes('Ctrl+C or /exit to quit'));
  t.renderer.destroy();
});

test('a command that works on folders runs signed out, and the status line says so', async () => {
  const { restore } = isolatedHome();
  try {
    const t = await testRender(() => <App version="9.9.9" />, { width: 100, height: 30 });
    await t.renderOnce();
    expect(footer(t.captureCharFrame())).toContain('○ not signed in');

    await t.mockInput.typeText('spl list --local');
    t.mockInput.pressEnter();
    await t.waitForFrame((f) => f.includes('No SPLs yet'));
    t.renderer.destroy();
  } finally {
    restore();
  }
});

test('↑ and ↓ walk back and forth through the commands you ran, even though each one opens the menu', async () => {
  const { restore } = isolatedHome();
  try {
    const t = await testRender(() => <App version="9.9.9" />, { width: 100, height: 40 });
    await t.renderOnce();
    for (const line of ['doctor', 'spl list --local', 'status']) {
      await t.mockInput.typeText(line);
      t.mockInput.pressEnter();
      await t.waitForFrame((f) => f.includes('❯ Try') || f.includes('? shortcuts'));
      await new Promise((r) => setTimeout(r, 60));
    }

    t.mockInput.pressArrow('up');
    await t.waitForFrame((f) => prompt(f) === 'status');
    t.mockInput.pressArrow('up');
    await t.waitForFrame((f) => prompt(f) === 'spl list --local');
    t.mockInput.pressArrow('up');
    await t.waitForFrame((f) => prompt(f) === 'doctor');
    t.mockInput.pressArrow('down');
    await t.waitForFrame((f) => prompt(f) === 'spl list --local');
    t.renderer.destroy();
  } finally {
    restore();
  }
});

test('a command is plain text: typing "spl " (no slash) offers its verbs, and nothing is offered for an empty line', async () => {
  const t = await testRender(() => <App version="9.9.9" />, { width: 100, height: 40 });
  await t.renderOnce();
  // empty line: no menu
  expect(t.captureCharFrame()).not.toContain('select · Tab complete');

  await t.mockInput.typeText('spl ');
  await t.waitForFrame((f) => f.includes('spl list') && f.includes('spl new') && f.includes('Tab complete'));
  expect(t.captureCharFrame()).not.toContain('/spl list');
  t.renderer.destroy();
});

test('Enter on half a command takes the suggestion instead of running it', async () => {
  const t = await testRender(() => <App version="9.9.9" />, { width: 100, height: 40 });
  await t.renderOnce();
  await t.mockInput.typeText('stat');
  await t.waitForFrame((f) => f.includes('status'));
  t.mockInput.pressEnter();
  await t.waitForFrame((f) => prompt(f) === 'status' && !f.includes('Unknown command'));
  t.renderer.destroy();
});

test('typing "/spl " offers the verbs of spl, and Tab completes one', async () => {
  const t = await testRender(() => <App version="9.9.9" />, { width: 100, height: 40 });
  await t.renderOnce();

  await t.mockInput.typeText('/spl ');
  await t.waitForFrame((f) => f.includes('/spl list') && f.includes('/spl new'));

  await t.mockInput.typeText('n');
  t.mockInput.pressTab();
  await t.waitForFrame((f) => f.includes('/spl new ') && !f.includes('type / for commands'));
  t.renderer.destroy();
});

test('a command that only the server can do says to sign in', async () => {
  const { restore } = isolatedHome();
  try {
    const t = await testRender(() => <App version="9.9.9" />, { width: 100, height: 30 });
    await t.renderOnce();
    await t.mockInput.typeText('namespaces');
    t.mockInput.pressEnter();
    await t.waitForFrame((f) => f.includes('namespaces needs you signed in: run login'));
    t.renderer.destroy();
  } finally {
    restore();
  }
});

test('making an SPL moves the window into it, and cd moves it out again', async () => {
  const { restore, workdir } = isolatedHome();
  try {
    const t = await testRender(() => <App version="9.9.9" />, { width: 100, height: 40 });
    await t.renderOnce();

    await t.mockInput.typeText('spl new Shop --plain --local');
    t.mockInput.pressEnter();
    await t.waitForFrame((f) => f.includes('Created Shop'));
    // the status line is about the SPL, and what follows acts on it
    await t.waitForFrame((f) => footer(f).includes('Shop'));
    expect(fs.realpathSync(process.cwd())).toBe(path.join(workdir, 'Shop'));

    await t.mockInput.typeText('product new web');
    t.mockInput.pressEnter();
    await t.waitForFrame((f) => f.includes('Created web'));

    // the products of the SPL you are in complete
    await t.mockInput.typeText('product show ');
    await t.waitForFrame((f) => f.includes('› web'));
    await t.mockInput.typeText('web');
    t.mockInput.pressEnter();
    await t.waitForFrame((f) => f.includes('Product: web'));

    await t.mockInput.typeText('cd ..');
    t.mockInput.pressEnter();
    await t.waitForFrame((f) => footer(f).includes('not in an SPL'));
    expect(fs.realpathSync(process.cwd())).toBe(workdir);
    t.renderer.destroy();
  } finally {
    restore();
  }
});

test('Tab after "get " offers the SPLs LINEA has (asked for in the background), and those you have here', async () => {
  const { restore, workdir } = isolatedHome({ token: 'jwt', user: { userId: '1', username: 'alice' } });
  fs.mkdirSync(path.join(workdir, 'alpha', 'src', 'platform'), { recursive: true });
  const asked: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    asked.push(new URL(String(input)).pathname);
    return new Response(JSON.stringify([{ _id: '1', name: 'alpha', version: '1.0.0' }, { _id: '2', name: 'gamma', version: '1.0.0' }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const { forgetRemoteSplNames } = await import('./core/remote.js');
    forgetRemoteSplNames();
    process.chdir(workdir);
    const t = await testRender(() => <App version="9.9.9" />, { width: 100, height: 40 });
    await t.renderOnce();
    expect(asked).toEqual([]); // nothing is asked for until `get ` is typed

    await t.mockInput.typeText('get ');
    // what LINEA has and you do not comes first, then what you have in both
    await t.waitForFrame((f) => f.includes('gamma') && f.includes('LINEA only') && f.includes('alpha') && f.includes('here + LINEA'));
    expect(asked).toEqual(['/api/lines/enrolled']);

    await t.mockInput.typeText('ga');
    t.mockInput.pressTab();
    await t.waitForFrame((f) => prompt(f) === 'get gamma');
    t.renderer.destroy();
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('Tab after "cd " offers the SPLs by name, and the products of the SPL you are in', async () => {
  const { restore, workdir } = isolatedHome();
  try {
    process.chdir(workdir);
    const t = await testRender(() => <App version="9.9.9" />, { width: 100, height: 40 });
    await t.renderOnce();
    await t.mockInput.typeText('spl new Shop --plain --local');
    t.mockInput.pressEnter();
    await t.waitForFrame((f) => f.includes('Created Shop'));
    await t.mockInput.typeText('product new web');
    t.mockInput.pressEnter();
    await t.waitForFrame((f) => f.includes('Created web'));

    await t.mockInput.typeText('cd ');
    await t.waitForFrame((f) => f.includes('product of Shop') && f.includes('SPL') && f.includes('up one level'));
    await t.mockInput.typeText('we');
    t.mockInput.pressTab();
    await t.waitForFrame((f) => prompt(f) === 'cd web');
    t.mockInput.pressEnter();
    await t.waitForFrame((f) => f.includes('(product web)'));
    t.renderer.destroy();
  } finally {
    restore();
  }
});

test('startup never touches the network, even with a token stored from an earlier sign-in', async () => {
  const { restore } = isolatedHome({
    token: 'fake-jwt-from-an-earlier-sign-in',
    user: { userId: '1', username: 'alice' },
  });

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetchCalls++;
    throw new Error(`unexpected network call on startup: ${String(args[0])}`);
  }) as unknown as typeof fetch;

  try {
    const t = await testRender(() => <App version="9.9.9" />, { width: 100, height: 30 });
    await t.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(footer(t.captureCharFrame())).toContain('● alice');
    expect(fetchCalls).toBe(0);
    t.renderer.destroy();
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('wide window: the side panel lists the SPLs, their products and the workspace packages; narrow: no panel', async () => {
  const home = isolatedHome();
  try {
    const spl = path.join(home.workdir, 'gis');
    fs.mkdirSync(path.join(spl, 'shop', '.linea'), { recursive: true });
    fs.mkdirSync(path.join(spl, 'src', 'platform'), { recursive: true });
    fs.writeFileSync(path.join(spl, 'spl.json'), JSON.stringify({ name: 'gis' }));
    fs.writeFileSync(path.join(spl, 'shop', '.linea', 'spec.json'), JSON.stringify({ spec: { basicData: { name: 'shop' }, features: [] } }));
    fs.mkdirSync(path.join(home.workdir, 'modules', 'auth'), { recursive: true });
    fs.mkdirSync(path.join(home.workdir, 'modules', 'auth', '.linea'), { recursive: true });
    fs.writeFileSync(path.join(home.workdir, 'modules', 'auth', '.linea', 'module.json'), JSON.stringify({ name: 'auth', version: '1.0.0' }));
    process.chdir(spl);

    const wide = await testRender(() => <App version="9.9.9" />, { width: 130, height: 30 });
    await wide.renderOnce();
    const frame = wide.captureCharFrame();
    expect(frame).toContain('SPLs (1)');
    expect(frame).toContain('▸ gis');
    expect(frame).toContain('shop');
    wide.renderer.destroy();

    const narrow = await testRender(() => <App version="9.9.9" />, { width: 100, height: 30 });
    await narrow.renderOnce();
    expect(narrow.captureCharFrame()).not.toContain('SPLs (1)');
    narrow.renderer.destroy();
  } finally {
    home.restore();
  }
});

test('the side panel is clickable, can be hidden (Ctrl+B), and a code panel shows the files of what is picked (Ctrl+O)', async () => {
  const home = isolatedHome();
  try {
    const spl = path.join(home.workdir, 'gis');
    fs.mkdirSync(path.join(spl, 'src', 'platform'), { recursive: true });
    fs.writeFileSync(path.join(spl, 'spl.json'), JSON.stringify({ name: 'gis' }));
    fs.mkdirSync(path.join(home.workdir, 'modules', 'auth'), { recursive: true });
    fs.mkdirSync(path.join(home.workdir, 'modules', 'auth', '.linea'), { recursive: true });
    fs.writeFileSync(path.join(home.workdir, 'modules', 'auth', '.linea', 'module.json'), JSON.stringify({ name: 'auth', version: '1.0.0' }));
    process.chdir(home.workdir);

    const t = await testRender(() => <App version="9.9.9" />, { width: 150, height: 40 });
    await t.renderOnce();
    const rowOf = (needle: string): number => t.captureCharFrame().split('\n').findIndex((l) => l.includes(needle));
    expect(rowOf('auth')).toBeGreaterThan(-1);

    // a click on a module goes there, the way `cd auth` does
    await t.mockMouse.click(4, rowOf('auth'));
    await t.waitForFrame((f) => f.includes('❯ cd auth'));

    // the code panel shows the files of where you are: the module's manifest, opened first
    t.mockInput.pressKey('o', { ctrl: true });
    await t.waitForFrame((f) => f.includes('module.json') && f.includes('"version"'));

    // and the list goes away
    t.mockInput.pressKey('b', { ctrl: true });
    await t.waitForFrame((f) => !f.includes('SPLs ('));
    t.renderer.destroy();
  } finally {
    home.restore();
  }
});

test('the analysis dialog looks like a terminal: the command after a prompt, and what it found, one thing to a line', async () => {
  const { Dialog } = await import('./ui/Dialog.js');
  const t = await testRender(
    () => (
      <Dialog
        onClose={() => {}}
        view={{
          title: 'Feature model analysis (BDD)',
          command: 'fm analyze',
          rows: [
            { label: 'satisfiable', value: 'yes', tone: 'ok' },
            { label: 'configurations', value: '1,024', tone: 'info' },
            { label: 'dead features', items: ['Legacy', 'Old'], tone: 'err' },
            { label: 'variability', value: '0.5', ratio: 0.5 },
          ],
        }}
      />
    ),
    { width: 100, height: 24 },
  );
  await t.renderOnce();
  const frame = t.captureCharFrame();
  expect(frame).toContain('❯ linea fm analyze');
  expect(frame).toMatch(/satisfiable\s+yes/);
  expect(frame).toMatch(/configurations\s+1,024/);
  expect(frame).toContain('Legacy  Old');
  expect(frame).toContain('████████░░░░░░░░');
  expect(frame).toContain('Esc or Enter to close');
  t.renderer.destroy();
});

test('the list folds by a click on its heading, moves with the keys (Ctrl+E), and the layout is remembered', async () => {
  const home = isolatedHome();
  try {
    const spl = path.join(home.workdir, 'gis');
    fs.mkdirSync(path.join(spl, 'src', 'platform'), { recursive: true });
    fs.writeFileSync(path.join(spl, 'spl.json'), JSON.stringify({ name: 'gis' }));
    for (const m of ['auth', 'billing']) {
      fs.mkdirSync(path.join(home.workdir, 'modules', m), { recursive: true });
      fs.mkdirSync(path.join(home.workdir, 'modules', m, '.linea'), { recursive: true });
    fs.writeFileSync(path.join(home.workdir, 'modules', m, '.linea', 'module.json'), JSON.stringify({ name: m, version: '1.0.0' }));
    }
    process.chdir(home.workdir);

    const t = await testRender(() => <App version="9.9.9" />, { width: 150, height: 40 });
    await t.renderOnce();
    const rowOf = (needle: string): number => t.captureCharFrame().split('\n').findIndex((l) => l.includes(needle));
    expect(rowOf('▾ Modules (2)')).toBeGreaterThan(-1);
    expect(rowOf('billing')).toBeGreaterThan(-1);

    // a click on the heading folds the group
    await t.mockMouse.click(4, rowOf('▾ Modules (2)'));
    await t.waitForFrame((f) => f.includes('▸ Modules (2)') && !f.includes('billing'));
    await t.mockMouse.click(4, rowOf('▸ Modules (2)'));
    await t.waitForFrame((f) => f.includes('▾ Modules (2)') && f.includes('billing'));

    // the keys: the prompt lets go, the list starts at its first thing (gis), Down moves to the next (auth), Enter goes there
    t.mockInput.pressKey('e', { ctrl: true });
    t.mockInput.pressArrow('down');
    t.mockInput.pressEnter();
    await t.waitForFrame((f) => f.includes('❯ cd auth'));
    t.renderer.destroy();

    // hide the list and fold a group; a later window comes up the same
    const second = await testRender(() => <App version="9.9.9" />, { width: 150, height: 40 });
    await second.renderOnce();
    second.mockInput.pressKey('b', { ctrl: true });
    await second.waitForFrame((f) => !f.includes('SPLs ('));
    await new Promise((r) => setTimeout(r, 600));
    second.renderer.destroy();

    const third = await testRender(() => <App version="9.9.9" />, { width: 150, height: 40 });
    await third.renderOnce();
    expect(third.captureCharFrame()).not.toContain('SPLs (');
    third.renderer.destroy();
  } finally {
    home.restore();
  }
});

test('the list follows the folders: a module made from outside shows up without a command', async () => {
  const home = isolatedHome();
  try {
    const spl = path.join(home.workdir, 'gis');
    fs.mkdirSync(path.join(spl, 'src', 'platform'), { recursive: true });
    fs.writeFileSync(path.join(spl, 'spl.json'), JSON.stringify({ name: 'gis' }));
    fs.mkdirSync(path.join(home.workdir, 'modules', 'auth'), { recursive: true });
    fs.mkdirSync(path.join(home.workdir, 'modules', 'auth', '.linea'), { recursive: true });
    fs.writeFileSync(path.join(home.workdir, 'modules', 'auth', '.linea', 'module.json'), JSON.stringify({ name: 'auth', version: '1.0.0' }));
    process.chdir(home.workdir);

    const t = await testRender(() => <App version="9.9.9" />, { width: 150, height: 40 });
    await t.renderOnce();
    expect(t.captureCharFrame()).not.toContain('payments');

    // the editor (or git) adds a module, and a new SPL, next to the ones listed
    fs.mkdirSync(path.join(home.workdir, 'modules', 'payments'), { recursive: true });
    fs.mkdirSync(path.join(home.workdir, 'modules', 'payments', '.linea'), { recursive: true });
    fs.writeFileSync(path.join(home.workdir, 'modules', 'payments', '.linea', 'module.json'), JSON.stringify({ name: 'payments', version: '1.0.0' }));
    await t.waitForFrame((f) => f.includes('payments'), { timeoutMs: 4000 } as never).catch(async () => {
      // frames are only made when something asks for one: look again a few times
      for (let i = 0; i < 20 && !t.captureCharFrame().includes('payments'); i++) {
        await new Promise((r) => setTimeout(r, 150));
        await t.renderOnce();
      }
    });
    expect(t.captureCharFrame()).toContain('payments');
    t.renderer.destroy();
  } finally {
    home.restore();
  }
});
