import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import open from 'open';
import { parseFlags } from '../core/args.js';
import { git, readOrigin } from '../core/gitops.js';
import { gitSettings } from '../core/git.js';
import { displayPath } from '../core/workdir.js';
import { resolveOpenTarget } from './open.js';
import type { Command, Session } from './types.js';

/**
 * Things around the work, for the places you go to from it: the page of what you are in, its folder in the file manager, its
 * path on the clipboard, a terminal in it. Each takes what `open` takes (`fm`, a product, a module, a path; none: where you are),
 * and `--print` says what it would do instead of doing it.
 */

const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';

/** The folder or file a word means, for a command that acts on a place. */
function placeOf(session: Session, what: string | undefined): { path: string; label: string } {
  const resolved = resolveOpenTarget(session, what);
  const target = resolved.targets[0];
  if (!target) throw new Error('Nothing to act on here.');
  return { path: target, label: resolved.label };
}

/** The first folder at or above `from` that a clone left an origin in. */
function originAbove(from: string): { dir: string; origin: NonNullable<ReturnType<typeof readOrigin>> } | undefined {
  let dir = fs.existsSync(from) && fs.statSync(from).isFile() ? path.dirname(from) : from;
  for (let i = 0; i < 5; i++) {
    const origin = readOrigin(dir);
    if (origin) return { dir, origin };
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return undefined;
}

/** The web address of a `gitlab:group/project` or `github:owner/repo` location, on the host this machine is set up for. */
function locationUrl(location: string): string {
  const m = /^(gitlab|github):(.+)$/.exec(location);
  if (!m) throw new Error(`Not an address or a location: ${location}`);
  const { config } = gitSettings();
  const base = m[1] === 'github' ? (config.github?.webUrl ?? 'https://github.com') : config.gitlab?.url;
  if (!base) throw new Error(`The address of ${m[1] === 'github' ? 'GitHub' : 'GitLab'} is not set (GITLAB_HOSTNAME).`);
  return `${base.replace(/\/+$/, '')}/${m[2]!.replace(/\.git$/, '')}`;
}

const browse: Command = {
  name: 'browse',
  aliases: ['www'],
  summary: 'Open the page of what you are in (or name) in your browser: LINEA if it is there, else its repository',
  usage: 'browse [what] [--repo] [--print]   what: fm · <product> · <module> · <path> · an address or gitlab:group/project',
  flags: ['--repo (the git host, not LINEA)', '--print'],
  arg: 'place',
  run: async ({ args, session }) => {
    const { positional, flags } = parseFlags(args);
    const what = positional[0];
    let url: string | undefined;
    if (what && /^https?:\/\//i.test(what)) url = what;
    else if (what && /^(gitlab|github):/.test(what)) url = locationUrl(what);
    else {
      const place = placeOf(session, what);
      const found = originAbove(place.path);
      if (found) {
        const { origin } = found;
        const onLinea =
          origin.webUi && origin.kind === 'product' && origin.productId
            ? `${origin.webUi}/products/${origin.productId}`
            : origin.webUi && origin.kind === 'spl' && origin.lineId
              ? `${origin.webUi}/lines/${origin.lineId}`
              : undefined;
        url = flags['repo'] ? origin.webUrl : (onLinea ?? origin.webUrl);
      } else {
        // not cloned from LINEA: a plain git checkout may still say where it is
        const dir = fs.existsSync(place.path) && fs.statSync(place.path).isFile() ? path.dirname(place.path) : place.path;
        const remote = git(dir, ['remote', 'get-url', 'origin']).stdout.trim();
        if (remote) url = remote.replace(/\.git$/, '').replace(/^git@([^:]+):/, 'https://$1/');
      }
      if (!url) throw new Error(`${place.label} is only on this machine: it has no page yet. Send it first with: push`);
    }
    if (flags['print']) return url;
    await open(url);
    return `✓ Opened ${url}`;
  },
};

const reveal: Command = {
  name: 'reveal',
  aliases: ['folder', 'explorer', 'finder'],
  summary: 'Show what you are in (or name) in the file manager',
  usage: 'reveal [what] [--print]',
  flags: ['--print'],
  arg: 'place',
  run: ({ args, session }) => {
    const { positional, flags } = parseFlags(args);
    const place = placeOf(session, positional[0]);
    if (flags['print']) return place.path;
    const isFile = fs.existsSync(place.path) && fs.statSync(place.path).isFile();
    const dir = isFile ? path.dirname(place.path) : place.path;
    // a file is shown selected, in its folder, where the file manager can
    let child;
    if (WIN) {
      child = isFile
        ? spawn('explorer.exe', [`/select,"${place.path}"`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true })
        : spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' });
    } else if (MAC) {
      child = spawn('open', isFile ? ['-R', place.path] : [dir], { detached: true, stdio: 'ignore' });
    } else {
      child = spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' });
    }
    child.on('error', () => {
      /* no file manager: nothing to do, and the window must not fall over */
    });
    child.unref();
    return `✓ Showing ${displayPath(place.path)} in the file manager.`;
  },
};

/** What puts text on the clipboard here, or nothing. */
function clipboardCommand(): { command: string; args: string[] } | undefined {
  if (WIN) return { command: 'clip', args: [] };
  if (MAC) return { command: 'pbcopy', args: [] };
  for (const c of [
    { command: 'wl-copy', args: [] },
    { command: 'xclip', args: ['-selection', 'clipboard'] },
    { command: 'xsel', args: ['--clipboard', '--input'] },
  ]) {
    if (spawnSync(c.command, ['--version'], { stdio: 'ignore' }).error === undefined) return c;
  }
  return undefined;
}

const copy: Command = {
  name: 'copy',
  aliases: ['path'],
  summary: 'Put the path of what you are in (or name) on the clipboard',
  usage: 'copy [what] [--print]',
  flags: ['--print'],
  arg: 'place',
  run: ({ args, session }) => {
    const { positional, flags } = parseFlags(args);
    const place = placeOf(session, positional[0]);
    if (flags['print']) return place.path;
    const clip = clipboardCommand();
    const done = clip ? spawnSync(clip.command, clip.args, { input: place.path, stdio: ['pipe', 'ignore', 'ignore'] }) : undefined;
    if (!clip || done?.error || done?.status !== 0) {
      return `No clipboard to use here: ${place.path}`;
    }
    return `✓ Copied ${place.path}`;
  },
};

const terminal: Command = {
  name: 'terminal',
  aliases: ['term'],
  summary: 'Open a new terminal window in what you are in (or name)',
  usage: 'terminal [what] [--print]',
  flags: ['--print'],
  arg: 'place',
  run: ({ args, session }) => {
    const { positional, flags } = parseFlags(args);
    const place = placeOf(session, positional[0]);
    const dir = fs.existsSync(place.path) && fs.statSync(place.path).isFile() ? path.dirname(place.path) : place.path;
    if (flags['print']) return dir;
    const attempts: { command: string; args: string[] }[] = WIN
      ? [
          { command: 'wt.exe', args: ['-d', dir] },
          { command: 'cmd.exe', args: ['/c', 'start', '""', 'cmd.exe'] },
        ]
      : MAC
        ? [{ command: 'open', args: ['-a', 'Terminal', dir] }]
        : [
            { command: 'x-terminal-emulator', args: [] },
            { command: 'gnome-terminal', args: [`--working-directory=${dir}`] },
            { command: 'konsole', args: ['--workdir', dir] },
            { command: 'xterm', args: [] },
          ];
    for (const a of attempts) {
      const probe = spawnSync(WIN ? 'where' : 'which', [a.command], { stdio: 'ignore' });
      if (probe.status !== 0 && !WIN && a.command !== 'open') continue;
      if (probe.status !== 0 && WIN) continue;
      const child = spawn(a.command, a.args, { cwd: dir, detached: true, stdio: 'ignore' });
      child.on('error', () => {});
      child.unref();
      return `✓ A terminal in ${displayPath(dir)}.`;
    }
    throw new Error('No terminal program found to start.');
  },
};

export const systemCommands: Command[] = [browse, reveal, copy, terminal];
