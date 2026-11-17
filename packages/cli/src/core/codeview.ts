import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { gitProviderOf, gitSettings } from './git.js';

/**
 * The code of a thing, for the right panel: the files of an SPL, product, module or metamodel, from its folder when it is here
 * and from its repository on the git host when it is not. Read-only: this is for looking, `open` is for working.
 */
export type CodeTarget =
  | { kind: 'local'; title: string; dir: string }
  | { kind: 'remote'; title: string; /** `group/project` on the host */ repo: string; ref: string };

export interface FileText {
  text: string;
  truncated: boolean;
  binary: boolean;
}

const SKIP = new Set(['.git', 'node_modules', 'dist', '.DS_Store']);
// what the tools keep in `.linea` for themselves; its manifests, models and specs are the content (a module's `.linea/module.json`)
const TOOL_FILES = /^\.linea\/(composed-model\.uvl|origin\.json|[^/]*\.code-workspace)$/;
const MAX_FILES = 3000;
const MAX_BYTES = 200_000;

/** The repository path (`group/project`) of a host address or a `gitlab:group/project` location. */
export function repoPathOf(ref: string): string {
  const located = /^(?:gitlab|github):(.+)$/.exec(ref);
  if (located) return located[1]!.replace(/\.git$/, '');
  try {
    return new URL(ref).pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  } catch {
    return ref;
  }
}

/** Every file, relative to the target, with `/`: folders first is the tree's job (`rowsOf`). */
export async function listFilesOf(target: CodeTarget): Promise<string[]> {
  if (target.kind === 'remote') {
    const settings = gitSettings();
    const found = await gitProviderOf(settings).listFiles({ token: settings.token, id: target.repo, ref: target.ref });
    return found.filter((f) => !f.split('/').some((part) => SKIP.has(part)) && !TOOL_FILES.test(f)).slice(0, MAX_FILES);
  }
  const out: string[] = [];
  const walk = (dir: string, prefix: string, depth: number): void => {
    if (out.length >= MAX_FILES || depth > 8) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel, depth + 1);
      else if (e.isFile() && !TOOL_FILES.test(rel)) out.push(rel);
    }
  };
  walk(target.dir, '', 0);
  return out;
}

export interface TreeRow {
  /** the path relative to the target */
  path: string;
  name: string;
  dir: boolean;
  depth: number;
}

/** The rows of the tree: folders before files, and only what is under a folder that is open. `open` holds folder paths. */
export function rowsOf(files: readonly string[], open: ReadonlySet<string>): TreeRow[] {
  interface Node {
    children: Map<string, Node>;
    file: boolean;
  }
  const root: Node = { children: new Map(), file: false };
  for (const f of files) {
    let at = root;
    const parts = f.split('/');
    parts.forEach((part, i) => {
      let next = at.children.get(part);
      if (!next) at.children.set(part, (next = { children: new Map(), file: i === parts.length - 1 }));
      at = next;
    });
  }
  const rows: TreeRow[] = [];
  const emit = (node: Node, prefix: string, depth: number): void => {
    const sorted = [...node.children.entries()].sort(([an, a], [bn, b]) => Number(a.file) - Number(b.file) || an.localeCompare(bn));
    for (const [name, child] of sorted) {
      const p = prefix ? `${prefix}/${name}` : name;
      rows.push({ path: p, name, dir: !child.file, depth });
      if (!child.file && open.has(p)) emit(child, p, depth + 1);
    }
  };
  emit(root, '', 0);
  return rows;
}

/** One file as text: a big one is cut, and one that is not text is said to be so. */
export async function readFileOf(target: CodeTarget, rel: string): Promise<FileText> {
  let bytes: Uint8Array | null;
  if (target.kind === 'remote') {
    const settings = gitSettings();
    const got = await gitProviderOf(settings).readFile({ token: settings.token, id: target.repo, path: rel, ref: target.ref });
    bytes = got === null ? null : new Uint8Array(got);
  } else {
    const file = path.join(target.dir, ...rel.split('/'));
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(MAX_BYTES + 1);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      bytes = buf.subarray(0, n);
    } finally {
      fs.closeSync(fd);
    }
  }
  if (bytes === null) return { text: '', truncated: false, binary: false };
  const truncated = bytes.length > MAX_BYTES;
  const head = truncated ? bytes.subarray(0, MAX_BYTES) : bytes;
  if (head.subarray(0, 4096).includes(0)) return { text: '', truncated: false, binary: true };
  return { text: Buffer.from(head).toString('utf8').replace(/\r\n/g, '\n').replace(/\t/g, '  '), truncated, binary: false };
}

/**
 * The files whose path has the characters of `query` in order (`spjs` finds `spl.json`), those that have it whole first and shorter
 * paths before longer ones. Case does not matter.
 */
export function matchFiles(files: readonly string[], query: string, limit = 80): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { file: string; score: number }[] = [];
  for (const file of files) {
    const lower = file.toLowerCase();
    const at = lower.indexOf(q);
    if (at >= 0) {
      // a hit in the name itself is worth more than one in a folder
      const inName = at >= lower.lastIndexOf('/') + 1;
      scored.push({ file, score: (inName ? 0 : 1000) + at + file.length / 100 });
      continue;
    }
    let i = 0;
    for (const ch of lower) if (ch === q[i]) i++;
    if (i === q.length) scored.push({ file, score: 5000 + file.length });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((s) => s.file);
}

export interface Hit {
  path: string;
  /** 1-based */
  line: number;
  text: string;
}

/**
 * Where `query` is in the text of the files of a folder (a plain, case-insensitive search). It gives the thread back now and then so
 * the window stays alive, and stops when `alive()` says the question has changed. Only what is here: the host's files are not read
 * one by one.
 */
export async function grepLocal(dir: string, files: readonly string[], query: string, alive: () => boolean, limit = 60): Promise<Hit[]> {
  const q = query.toLowerCase();
  const hits: Hit[] = [];
  let looked = 0;
  for (const rel of files) {
    if (hits.length >= limit || !alive()) break;
    if (++looked % 20 === 0) await new Promise((resolve) => setImmediate(resolve));
    let text: string;
    try {
      const file = path.join(dir, ...rel.split('/'));
      if (fs.statSync(file).size > MAX_BYTES) continue;
      const buf = fs.readFileSync(file);
      if (buf.subarray(0, 4096).includes(0)) continue;
      text = buf.toString('utf8');
    } catch {
      continue;
    }
    if (!text.toLowerCase().includes(q)) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && hits.length < limit; i++) {
      if (lines[i]!.toLowerCase().includes(q)) hits.push({ path: rel, line: i + 1, text: lines[i]!.trim().slice(0, 200) });
    }
  }
  return hits;
}

/** What git says of a file of a folder: changed, new (not tracked yet) or deleted. */
export type FileChange = 'modified' | 'new' | 'deleted';

function gitIn(dir: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: dir, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/**
 * The files of `dir` that are not as the last commit has them, by path relative to `dir`. Nothing (an empty map) when the folder is
 * not a git repository or git is not there: the tree then simply shows no marks.
 */
export async function changedFilesOf(dir: string): Promise<Map<string, FileChange>> {
  const out = new Map<string, FileChange>();
  try {
    const prefix = (await gitIn(dir, ['rev-parse', '--show-prefix'])).trim();
    const raw = await gitIn(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']);
    const parts = raw.split('\0');
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i]!;
      if (entry.length < 4) continue;
      const code = entry.slice(0, 2);
      let file = entry.slice(3);
      // a rename lists the old name next
      if (code[0] === 'R' || code[0] === 'C') i++;
      if (prefix && file.startsWith(prefix)) file = file.slice(prefix.length);
      out.set(file, code === '??' || code.includes('A') ? 'new' : code.includes('D') ? 'deleted' : 'modified');
    }
  } catch {
    /* not a repository */
  }
  return out;
}

/** The change of one file, as lines of a unified diff; a file that is new is all additions. Empty when there is nothing to show. */
export async function diffOf(dir: string, rel: string, change: FileChange): Promise<string> {
  try {
    if (change === 'new') {
      const full = path.join(dir, ...rel.split('/'));
      const buf = fs.readFileSync(full);
      if (buf.subarray(0, 4096).includes(0)) return '(not a text file)';
      const lines = buf.toString('utf8').replace(/\r\n/g, '\n').split('\n');
      if (lines.at(-1) === '') lines.pop();
      return [`@@ new file, ${lines.length} line(s) @@`, ...lines.slice(0, 1500).map((l) => `+${l}`)].join('\n');
    }
    const text = await gitIn(dir, ['diff', '--no-color', '--no-ext-diff', 'HEAD', '--', rel]);
    // the header (diff --git, index, ---, +++) is what the title already says
    const at = text.indexOf('\n@@');
    return (at >= 0 ? text.slice(at + 1) : text).replace(/\r\n/g, '\n').replace(/\t/g, '  ').replace(/\n$/, '');
  } catch (e) {
    return `(${(e as Error).message.split('\n')[0]})`;
  }
}
