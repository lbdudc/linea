import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'bun:test';
import { initWorkspace } from '../src/core/context.js';
import { checkLocalLine } from '../src/core/workspace.js';
import { getCommand } from '../src/commands/registry.js';
import type { CommandContext, Session } from '../src/commands/types.js';

/**
 * What the tests that drive commands directly share: temporary folders, a session whose `cwd` is where the command acts (there is no
 * active SPL any more: the folder you are in is it), and a guard that makes any network call fail the test.
 */

/** Temporary folders, removed after each test. Call once at the top of a test file. */
export function useTmpDirs(prefix: string, { seed = false }: { seed?: boolean } = {}): () => string {
  const created: string[] = [];
  afterEach(() => {
    while (created.length) fs.rmSync(created.pop()!, { recursive: true, force: true });
  });
  return () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`)));
    created.push(dir);
    if (seed) withFeatureMetamodel(dir);
    return dir;
  };
}

// every SPL is made of the feature metamodel (and what it needs), which a workspace has to hold: the tests' one gets copies of the real ones
// the metamodels repository (linea-metamodels next to this checkout, or LINEA_METAMODELS_DIR)
const METAMODELS = path.join(process.env['LINEA_METAMODELS_DIR'] ?? path.resolve(import.meta.dir, '../../../../linea-metamodels'), 'metamodels');
export const withFeatureMetamodel = (workdir: string): void => {
  if (!fs.existsSync(workdir)) return;
  for (const name of ['common', 'featuremodel']) {
    const target = path.join(workdir, 'metamodels', name);
    if (fs.existsSync(target) || !fs.existsSync(path.join(METAMODELS, name))) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(METAMODELS, name), target, { recursive: true });
  }
};

/** Signed out, in the workspace `workdir`. */
export function makeSession(workdir: string, overrides: Partial<Session> = {}): Session {
  withFeatureMetamodel(workdir);
  return { baseUrl: 'http://unused.invalid', authed: false, workdir, cwd: workdir, ...overrides };
}

export function makeCtx(session: Session, args: string[] = []): CommandContext {
  return {
    args,
    rest: args.join(' '),
    session,
    updateSession: (patch) => Object.assign(session, patch),
    setStatus: () => {},
    print: () => {},
    clear: () => {},
    exit: () => {},
  };
}

/** Runs a command by name, as the window and the shell do. */
export const run = async (session: Session, name: string, ...args: string[]): Promise<string> => String(await getCommand(name)!.run(makeCtx(session, args)));

/** A classic SPL made here: the session is in it afterwards. Returns its folder. */
export async function newPlainLine(session: Session, name: string): Promise<string> {
  await run(session, 'spl new', name, '--plain', '--local');
  return session.cwd!;
}

/** Any network call fails loudly and is counted: a command that works on folders must never reach for the server. */
export function useNoNetwork(): { calls: () => number } {
  const original = globalThis.fetch;
  let calls = 0;
  beforeEach(() => {
    calls = 0;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      calls++;
      throw new Error(`unexpected network call: ${String(args[0])}`);
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = original;
  });
  return { calls: () => calls };
}

const GROUPS = new Set(['mandatory', 'optional', 'or', 'alternative']);

/**
 * A feature model written as the tests always have (tab-indented UVL: the root, then `mandatory` / `optional` / `or` / `alternative` and
 * the features under them) as the model of the feature metamodel an SPL keeps now (`models/featuremodel.featuremodel`).
 */
export function uvlToFeatureModel(uvl: string): string {
  const rows = uvl.split('\n').filter((line) => line.trim() !== '' && line.trim() !== 'features').map((line) => ({ depth: line.length - line.trimStart().length, text: line.trim() }));
  const build = (index: number, depth: number): { text: string; next: number } => {
    const parts: string[] = [];
    let i = index;
    while (i < rows.length && rows[i]!.depth === depth) {
      const row = rows[i]!;
      const child = build(i + 1, depth + 1);
      parts.push(GROUPS.has(row.text) ? `${row.text} {\n${child.text}\n}` : child.text ? `feature ${row.text} {\n${child.text}\n}` : `feature ${row.text}`);
      i = child.next;
    }
    return { text: parts.join('\n'), next: i };
  };
  const root = rows[0]?.text ?? 'Root';
  const body = build(1, (rows[1]?.depth ?? 1));
  return `featuremodel ${root} feature ${root}${body.text ? ` {\n${body.text}\n}` : ''}\n`;
}

/** Sets the feature model of an SPL folder from tab-indented UVL, and composes it (what checking the SPL does): products choose from the composed one. */
export async function setLineModel(lineDir: string, uvl: string): Promise<void> {
  writeLineModel(lineDir, uvl);
  await checkLocalLine(path.dirname(lineDir), lineDir);
}

/** Sets the feature model of an SPL folder from tab-indented UVL (not composed yet). */
export function writeLineModel(lineDir: string, uvl: string): void {
  fs.writeFileSync(path.join(lineDir, 'models', 'featuremodel.featuremodel'), uvlToFeatureModel(uvl));
}

/** `initWorkspace`, with the feature metamodel every SPL needs in it. */
export function seededWorkspace(dir: string): string {
  const made = initWorkspace(dir);
  withFeatureMetamodel(made);
  return made;
}
