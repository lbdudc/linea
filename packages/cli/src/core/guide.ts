import fs from 'node:fs';
import path from 'node:path';
import type { Session } from '../commands/types.js';
import { findContext, type FolderContext } from './context.js';
import { changedCount, gitAsync, isRepo, readOrigin, repoState } from './gitops.js';

/**
 * What to tell a person who has just opened the CLI: not every command, but the few that make sense *here*. The same answer feeds the
 * welcome panel, the placeholder of the prompt, the order of the `/` menu and the top of `help`, so they never disagree.
 */

export interface Tip {
  /** what to type */
  command: string;
  /** what it does, in this situation */
  why: string;
}

export interface Checkout {
  name: string;
  /** it came from LINEA (or was uploaded to it) */
  linked: boolean;
  branch?: string;
  changes: number;
  ahead: number;
  behind: number;
}

export interface GuideState {
  signedIn: boolean;
  user?: string;
  /** how many SPLs this machine has in the workspace */
  spls: number;
  line?: Checkout;
  product?: Checkout;
  pkg?: { kind: 'module' | 'metamodel'; name: string };
  /** where the commands act, for the footer */
  folder: string;
}

const checkoutOf = (name: string, dir: string): Checkout => {
  if (!isRepo(dir)) return { name, linked: false, changes: 0, ahead: 0, behind: 0 };
  try {
    const s = repoState(dir);
    return { name, linked: Boolean(readOrigin(dir)), branch: s.branch, changes: changedCount(s), ahead: s.ahead, behind: s.behind };
  } catch {
    return { name, linked: Boolean(readOrigin(dir)), changes: 0, ahead: 0, behind: 0 };
  }
};

/** The same as `checkoutOf`, without holding the window: the `git status` runs beside whatever else there is to do. */
const checkoutOfAsync = async (name: string, dir: string): Promise<Checkout> => {
  if (!isRepo(dir)) return { name, linked: false, changes: 0, ahead: 0, behind: 0 };
  const linked = Boolean(readOrigin(dir));
  try {
    const res = await gitAsync(dir, ['status', '--porcelain=v2', '--branch', '--untracked-files=all']);
    if (res.status !== 0) throw new Error(res.stderr);
    let branch = '(detached)';
    let ahead = 0;
    let behind = 0;
    let changes = 0;
    for (const line of res.stdout.split(/\r?\n/)) {
      if (line.startsWith('# branch.head ')) branch = line.slice('# branch.head '.length);
      else if (line.startsWith('# branch.ab ')) {
        const m = /\+(\d+) -(\d+)/.exec(line);
        if (m) [ahead, behind] = [Number(m[1]), Number(m[2])];
      } else if (/^(1|2|u|\?) /.test(line)) changes++;
    }
    return { name, linked, branch, changes, ahead, behind };
  } catch {
    return { name, linked, changes: 0, ahead: 0, behind: 0 };
  }
};

/**
 * Where you are and how things stand there, without waiting for git: the checkouts' status is asked for with `guideStateAsync`.
 * `checkouts` gives the line's and the product's, when they are known.
 */
export function guideState(
  session: Session,
  folder: FolderContext = findContext(session.cwd ?? process.cwd()),
  checkouts?: { line?: Checkout; product?: Checkout },
): GuideState {
  const root = folder.workspace ?? session.workdir;
  let spls = 0;
  try {
    if (root) spls = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && findContext(path.join(root, e.name)).line?.dir === path.join(root, e.name)).length;
  } catch {
    /* no workspace yet */
  }
  return {
    signedIn: session.authed,
    ...(session.user?.username ? { user: session.user.username } : {}),
    spls,
    ...(folder.line ? { line: checkouts ? checkouts.line ?? { name: folder.line.name, linked: false, changes: 0, ahead: 0, behind: 0 } : checkoutOf(folder.line.name, folder.line.dir) } : {}),
    ...(folder.product ? { product: checkouts ? checkouts.product ?? { name: folder.product.name, linked: false, changes: 0, ahead: 0, behind: 0 } : checkoutOf(folder.product.name, folder.product.dir) } : {}),
    ...(folder.package ? { pkg: { kind: folder.package.kind, name: folder.package.name } } : {}),
    folder: folder.line?.dir ?? folder.package?.dir ?? root ?? process.cwd(),
  };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const whereStand = (n: number): string => (n === 1 ? 'where your SPL stands' : `where your ${n} SPLs stand`);

/** The few things worth doing next, most useful first. */
export function tipsFor(state: GuideState): Tip[] {
  const tips: Tip[] = [];

  if (state.pkg && !state.line) {
    return [
      { command: 'check', why: `does ${state.pkg.name} fit what it needs?` },
      { command: 'open', why: `edit ${state.pkg.name} in your editor` },
      { command: `${state.pkg.kind} publish --bump patch --to <group>`, why: 'release a new version of it' },
    ];
  }

  const here = state.product ?? state.line;
  if (here) {
    if (state.line && !state.line.linked && !state.product) {
      tips.push(
        state.signedIn
          ? { command: 'push', why: `put ${state.line.name} on LINEA (it is only on this machine)` }
          : { command: 'login', why: `sign in, and push will put ${state.line.name} on LINEA` },
      );
    }
    if (here.changes > 0 || here.ahead > 0) tips.push({ command: 'push -m "…"', why: `send ${plural(here.changes || here.ahead, here.changes ? 'change' : 'commit')} to LINEA` });
    if (here.behind > 0) tips.push({ command: 'get', why: `bring ${plural(here.behind, 'new commit')} from LINEA` });
    if (state.product) {
      tips.push({ command: 'open', why: `edit ${state.product.name} in your editor` });
      tips.push({ command: 'product show', why: 'its features and models, and what is missing' });
      tips.push({ command: 'check', why: 'do its features and models fit its SPL?' });
      tips.push({ command: 'generate --preview out', why: 'derive it into a folder to look at' });
    } else {
      tips.push({ command: 'open', why: `edit ${state.line!.name} in your editor, with its modules` });
      tips.push({ command: 'check', why: 'do the modules fit together?' });
      tips.push({ command: 'product new <name>', why: 'add a product to this SPL' });
      tips.push({ command: 'spl add <module>', why: 'use another module' });
    }
    tips.push({ command: 'status', why: 'where this stands against LINEA' });
    return dedupe(tips).slice(0, 5);
  }

  if (!state.signedIn) {
    tips.push({ command: 'login', why: 'sign in: your SPLs on LINEA, and git access' });
    tips.push({ command: 'spl new <name> --local', why: 'start an SPL on this machine' });
    if (state.spls) tips.push({ command: 'status', why: whereStand(state.spls) });
    tips.push({ command: 'doctor', why: 'check that git and an editor are in place' });
    return tips.slice(0, 5);
  }
  tips.push({ command: 'spl list', why: 'your SPLs, here and on LINEA' });
  tips.push({ command: 'get <spl>', why: 'bring one to work on' });
  tips.push({ command: 'spl new <name>', why: 'make a new one on LINEA, here in one step' });
  if (state.spls) tips.push({ command: 'status', why: whereStand(state.spls) });
  tips.push({ command: 'module list --remote', why: 'the modules available on your git host' });
  return tips.slice(0, 5);
}

const dedupe = (tips: Tip[]): Tip[] => {
  const seen = new Set<string>();
  return tips.filter((t) => (seen.has(t.command) ? false : (seen.add(t.command), true)));
};

/** The commands people use every day, in the order they are used: after the tips, this is the order of the menu and of `help`. */
export const EVERYDAY = [
  'get',
  'push',
  'status',
  'open',
  'check',
  'spl list',
  'spl new',
  'product new',
  'generate',
  'spl add',
  'module list',
  'login',
] as const;

/** The first word(s) of a tip (`push -m "…"` → `push`), to find the command it is about. */
export const commandOfTip = (tip: Tip, known: (name: string) => boolean): string | undefined => {
  const words = tip.command.split(/\s+/);
  const two = words.slice(0, 2).join(' ');
  return known(two) ? two : known(words[0]!) ? words[0] : undefined;
};

/**
 * The names of commands in the order to offer them: the ones the tips are about, then the everyday ones, then the rest as they come.
 * `names` are the commands that may be offered at all.
 */
export function rankCommands(names: string[], tips: Tip[]): string[] {
  const available = new Set(names);
  const order: string[] = [];
  const add = (n: string | undefined) => {
    if (n && available.has(n) && !order.includes(n)) order.push(n);
  };
  for (const t of tips) add(commandOfTip(t, (n) => available.has(n)));
  for (const n of EVERYDAY) add(n);
  for (const n of names) add(n);
  return order;
}

/** `guideState`, with the git status of the SPL and of the product asked for together and without blocking. */
export async function guideStateAsync(session: Session, folder: FolderContext = findContext(session.cwd ?? process.cwd())): Promise<GuideState> {
  const [line, product] = await Promise.all([
    folder.line ? checkoutOfAsync(folder.line.name, folder.line.dir) : undefined,
    folder.product ? checkoutOfAsync(folder.product.name, folder.product.dir) : undefined,
  ]);
  return guideState(session, folder, { ...(line ? { line } : {}), ...(product ? { product } : {}) });
}
