import fs from 'node:fs';
import { flagString, parseFlags } from '../core/args.js';
import { splalm } from '../core/client.js';
import { findContext } from '../core/context.js';
import { readOrigin } from '../core/gitops.js';
import { listLocalLines } from '../core/workspace.js';
import { defaultDataDir, displayPath } from '../core/workdir.js';
import type { SplalmLineSummary, SplalmProductDetail } from '../core/types.js';
import { cloneProductInto, webUiOf } from './bridge.js';
import { commandNamed } from './lookup.js';
import { createModularLineHere, createPlainLineHere } from './modules.js';
import { createProductFromSpec } from './product.js';
import type { Command, Session } from './types.js';

/**
 * The commands that used to ask you which side you were on (`--cloud`, a mode, a second command to bring it down): they look at both
 * LINEA and your machine, and do the whole thing. Signed in, a new SPL or product is made on LINEA and comes to your folder; signed out,
 * or offline (`mode offline`, or `--offline` for one command), it is made here, and `push` puts it on LINEA when you are ready.
 */

const workdirOf = (session: Session): string => session.workdir ?? defaultDataDir();
const LOCATION = /^(gitlab|github):/;

/** Whether this command may talk to the server: signed in, and not told `--local`. */
import { modeOf, online } from '../core/mode.js';
export { online };

// ---------------------------------------------------------------- spl list

interface Row {
  name: string;
  here?: string;
  linea?: { id: string; version: string };
}

const splList: Command = {
  name: 'spl list',
  where: 'both',
  summary: 'Your SPLs: the ones on this machine and the ones on LINEA, side by side',
  usage: 'spl list [--local]',
  flags: ['--local'],
  run: async ({ session, data }) => {
    const rows = new Map<string, Row>();
    const byLineId = new Map<string, Row>();
    for (const l of listLocalLines(workdirOf(session))) {
      const row: Row = { name: l.name, here: l.dir };
      rows.set(l.name, row);
      const origin = readOrigin(l.dir);
      if (origin?.lineId) byLineId.set(origin.lineId, row);
    }

    let note = '';
    if (!online(session)) note = modeOf(session) === 'offline' ? 'Offline: only the SPLs on this machine. mode server shows the SPLs of LINEA too.' : '';
    else {
      try {
        for (const l of (await splalm.get('/api/lines/enrolled')) as SplalmLineSummary[]) {
          const row = byLineId.get(l._id) ?? rows.get(l.name) ?? { name: l.name };
          row.linea = { id: l._id, version: l.version };
          rows.set(row.name, row);
        }
      } catch {
        note = 'LINEA did not answer: only this machine is listed.';
      }
    }

    const all = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
    data?.(all);
    if (!all.length) return ['No SPLs yet.', 'Make one with: spl new <name>', ...(note ? [note] : [])].join('\n');
    const where = (r: Row) => (r.here && r.linea ? 'here + LINEA' : r.here ? 'here only' : 'LINEA only');
    const next = (r: Row) => (r.here && r.linea ? '' : r.here ? '  (push uploads it)' : `  (get ${r.name})`);
    const width = Math.max(...all.map((r) => r.name.length), 4);
    return [
      ...all.map((r) => `  ${r.name.padEnd(width)}  ${where(r).padEnd(12)}  ${(r.linea ? `v${r.linea.version}` : '').padEnd(8)}${r.here ? displayPath(r.here) : ''}${next(r)}`),
      ...(note ? ['', note] : []),
    ].join('\n');
  },
};

// ---------------------------------------------------------------- spl new

const splNew: Command = {
  name: 'spl new',
  where: 'both',
  summary: 'Create an SPL. Made of modules by default (--plain for the classic kind); signed in, it is made on LINEA and comes to your folder',
  usage: 'spl new <name> [--modules gitlab:g/m,github:o/m] [--plain] [--desc text] [--namespace id] [--local]',
  flags: ['--modules a,b', '--plain', '--desc text', '--namespace id', '--local'],
  run: async (ctx) => {
    const { session } = ctx;
    const { positional, flags } = parseFlags(ctx.args, {
      value: { modules: undefined, desc: undefined, version: undefined, namespace: undefined },
      optional: { plain: undefined },
    });
    const name = positional[0];
    if (!name) return 'Usage: spl new <name> [--modules a,b] [--plain] [--local]';
    const plain = flags['plain'] === undefined ? undefined : (flagString(flags, 'plain') ?? '');
    // `--plain UML,SENSOR` used to pick the models of a classic SPL; those are metamodels of modules now
    const ignored = plain ? ` (--plain takes no models: the data model and the sensors are metamodels of modules, so "${plain}" is not used)` : '';
    const modules = (flagString(flags, 'modules') ?? '').split(',').filter(Boolean);

    if (!online(session)) {
      // on this machine: the same thing, in a folder, and the window moves into it
      if (plain !== undefined) return createPlainLineHere(session, name, ctx.updateSession) + ignored;
      const tracked = trackSession(ctx);
      const out = [createModularLineHere(session, name, tracked.ctx.updateSession)];
      for (const m of modules) out.push(String(await commandNamed('spl add').run({ ...tracked.now(), args: [m] })));
      out.push('Offline: it is only on this machine. After `mode server` (and login), push uploads it to LINEA.');
      return out.join('\n');
    }

    // on LINEA, and then here
    const local = modules.filter((m) => !LOCATION.test(m));
    if (local.length) {
      throw new Error(`LINEA can only use modules of the git host (gitlab:group/project, github:owner/repo), not ${local.join(', ')}. ` +
        'Publish them (module publish <name> --to <group or owner>), or make the SPL here with --local.');
    }
    const namespace = flagString(flags, 'namespace');
    await splalm.post('/api/lines', {
      name,
      version: flagString(flags, 'version') ?? '1.0.0',
      description: flagString(flags, 'desc') ?? name,
      ...(plain === undefined ? { modular: true, modules: Object.fromEntries(modules.map((m) => [m, '*'])) } : { models: ['FM'] }),
      ...(namespace ? { parentNamespaceId: /^\d+$/.test(namespace) ? Number(namespace) : namespace } : {}),
    });
    return commandNamed('get').run({ ...ctx, args: [name] });
  },
};

/** `newmodular` makes the SPL the active one through `updateSession`; the call that follows has to see it. */
function trackSession(ctx: Parameters<Command['run']>[0]) {
  let session = ctx.session;
  const traced = {
    ...ctx,
    updateSession: (patch: Partial<Session>) => {
      session = { ...session, ...patch };
      ctx.updateSession(patch);
    },
  };
  return { ctx: traced, now: () => ({ ...traced, session }) };
}

// ---------------------------------------------------------------- product new

const productNew: Command = {
  name: 'product new',
  where: 'both',
  summary: 'Create a product: a name and the features it selects, or a spec file. In an SPL that is on LINEA it is made there and comes to your folder',
  usage: 'product new <name> [--features A,B] [--version x.y.z] [--local]   |   product new --from <spec.json>',
  flags: ['--from spec.json', '--features A,B', '--version x.y.z', '--local'],
  run: async ({ args, session, setStatus }) => {
    const { positional, flags } = parseFlags(args, { value: { from: undefined, features: undefined, version: undefined } });
    const from = flagString(flags, 'from');
    let spec: unknown;
    if (from) {
      if (!fs.existsSync(from)) throw new Error(`File not found: ${from}`);
      try {
        spec = JSON.parse(fs.readFileSync(from, 'utf8'));
      } catch (e) {
        throw new Error(`Could not parse ${from} as JSON: ${(e as Error).message}`);
      }
    } else {
      const name = positional[0];
      if (!name) return 'Usage: product new <name> [--features A,B]   |   product new --from <spec.json>';
      spec = {
        basicData: { name, version: flagString(flags, 'version') ?? '0.0.0', languages: ['en'], SRID: '4326' },
        dataModel: { cells: [] },
        features: (flagString(flags, 'features') ?? '').split(',').filter(Boolean),
        statics: [],
      };
    }

    // in an SPL that is on LINEA: the product is made there, and its copy comes into the SPL's folder
    const lineDir = findContext(session.cwd ?? process.cwd()).line?.dir;
    const origin = lineDir ? readOrigin(lineDir) : undefined;
    if (online(session) && lineDir && origin?.lineId) {
      setStatus('making the product on LINEA…');
      const product = (await splalm.post('/api/products', { lineId: origin.lineId, spec })) as SplalmProductDetail;
      const { webUi, provider } = await webUiOf();
      setStatus(`cloning ${product.spec.basicData.name}…`);
      const dir = await cloneProductInto(lineDir, { server: origin.server ?? session.baseUrl, provider, lineId: origin.lineId, webUi }, {
        _id: product._id,
        name: product.spec.basicData.name,
        repo: { id: product.repo.id, webUrl: product.repo.webUrl },
      });
      return `✓ Created ${product.spec.basicData.name} on LINEA, and it is here: ${displayPath(dir)}\nNext:  cd ${displayPath(dir)}   then   open · check · generate`;
    }
    return createProductFromSpec(session, spec);
  },
};

export const workflowCommands: Command[] = [splList, splNew, productNew];
