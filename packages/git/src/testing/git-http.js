import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Git over HTTP for the in-memory hosts, so `git clone`, `git pull` and `git push` work against them as against the real thing.
 *
 * The doubles keep a repository as plain maps (commits with their files, branches, tags). Real git needs a real repository, so each
 * project gets a bare one on disk that is kept in step with the map, lazily and in both directions:
 *
 *   - before git is served, whatever the REST API changed since is written into the bare repository (`fromModel`);
 *   - after a push, whatever git received is read back into the map (`toModel`), *before* the answer goes to the client, so a call to
 *     the REST API that follows (open a merge request for the branch just pushed) sees it.
 *
 * What differs between the doubles is behind an adapter:
 *   commits():  [{ id, parents, message, date, authorName, authorEmail, files: Map<path, Buffer> }]
 *   heads(): Map<branch, commitId>        tags(): Map<tag, commitId>        defaultBranch(): string
 *   addCommit({ id, parents, message, date, authorName, authorEmail, files })     setHead(name, id | null)     setTag(name, id | null)
 *
 * The transport is `git http-backend` (the CGI git ships with), so the protocol is git's own. A request without credentials is
 * asked for them (401), as a host does, so a credential helper gets its chance; what they are is not looked at.
 */

const run = (cwd, args, { input, env } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0' }, windowsHide: true });
    const out = [];
    const err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      const stdout = Buffer.concat(out);
      if (code !== 0) return reject(new Error(`git ${args.join(' ')}: ${Buffer.concat(err).toString('utf8').trim() || `exit ${code}`}`));
      resolve(stdout);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });

const text = async (cwd, args, opts) => (await run(cwd, args, opts)).toString('utf8');

const quote = (p) => `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;

class GitMirror {
  constructor({ dir, adapter }) {
    this.dir = dir;
    this.adapter = adapter;
    this.toGit = new Map(); // model commit id → git sha
    this.toModel = new Map(); // git sha → model commit id
    this.ready = false;
    this.queue = Promise.resolve();
  }

  /** One thing at a time per repository: a push and a fetch must not see each other half done. */
  exclusive(fn) {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  async init() {
    if (this.ready) return;
    fs.mkdirSync(this.dir, { recursive: true });
    await run(this.dir, ['init', '--bare', '--quiet', '.']);
    await run(this.dir, ['config', 'http.receivepack', 'true']);
    await run(this.dir, ['config', 'receive.denyCurrentBranch', 'ignore']);
    await run(this.dir, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);
    this.ready = true;
  }

  /** The model's commits that are not in git yet, parents first. */
  #pending() {
    const byId = new Map(this.adapter.commits().map((c) => [c.id, c]));
    const ordered = [];
    const seen = new Set();
    const visit = (id) => {
      if (seen.has(id) || this.toGit.has(id) || !byId.has(id)) return;
      seen.add(id);
      for (const parent of byId.get(id).parents) visit(parent);
      ordered.push(byId.get(id));
    };
    for (const id of byId.keys()) visit(id);
    return ordered;
  }

  async fromModel() {
    await this.init();
    const batch = this.#pending();
    if (batch.length) {
      const marks = new Map();
      const parts = [];
      const ref = (id) => (marks.has(id) ? `:${marks.get(id)}` : this.toGit.get(id));
      batch.forEach((c, i) => {
        marks.set(c.id, i + 1);
        const message = Buffer.from(`${c.message || '(no message)'}\n`);
        const when = Math.floor(new Date(c.date).getTime() / 1000) || 0;
        const who = `${(c.authorName || 'dev').replace(/[<>\n]/g, '')} <${c.authorEmail || 'dev@example.com'}>`;
        parts.push(Buffer.from(`reset refs/linea/import\ncommit refs/linea/import\nmark :${i + 1}\ncommitter ${who} ${when} +0000\ndata ${message.length}\n`), message);
        c.parents.forEach((parent, n) => parts.push(Buffer.from(`${n === 0 ? 'from' : 'merge'} ${ref(parent)}\n`)));
        parts.push(Buffer.from('deleteall\n'));
        for (const [file, content] of c.files) {
          parts.push(Buffer.from(`M 100644 inline ${quote(file)}\ndata ${content.length}\n`), content, Buffer.from('\n'));
        }
        parts.push(Buffer.from('\n'));
      });
      const marksFile = path.join(this.dir, 'linea-marks');
      await run(this.dir, ['fast-import', '--quiet', `--export-marks=${marksFile}`], { input: Buffer.concat(parts) });
      for (const line of fs.readFileSync(marksFile, 'utf8').split('\n').filter(Boolean)) {
        const [mark, sha] = line.split(' ');
        const commit = batch[Number(mark.slice(1)) - 1];
        this.toGit.set(commit.id, sha);
        this.toModel.set(sha, commit.id);
      }
      await run(this.dir, ['update-ref', '-d', 'refs/linea/import']).catch(() => {});
    }

    const updates = [];
    const want = new Set();
    for (const [name, id] of this.adapter.heads()) {
      const sha = this.toGit.get(id);
      if (!sha) continue;
      want.add(`refs/heads/${name}`);
      updates.push(`update refs/heads/${name} ${sha}\n`);
    }
    for (const [name, id] of this.adapter.tags()) {
      const sha = this.toGit.get(id);
      if (!sha) continue;
      want.add(`refs/tags/${name}`);
      updates.push(`update refs/tags/${name} ${sha}\n`);
    }
    for (const [refname] of await this.refs()) if (!want.has(refname)) updates.push(`delete ${refname}\n`);
    if (updates.length) await run(this.dir, ['update-ref', '--stdin'], { input: updates.join('') });
    const head = this.adapter.defaultBranch();
    if (head) await run(this.dir, ['symbolic-ref', 'HEAD', `refs/heads/${head}`]);
  }

  /** `refs/heads/*` and `refs/tags/*` as they are in git, tags peeled to the commit they point at. */
  async refs() {
    const out = await text(this.dir, ['for-each-ref', '--format=%(refname)\t%(objectname)\t%(*objectname)', 'refs/heads', 'refs/tags']);
    const map = new Map();
    for (const line of out.split('\n').filter(Boolean)) {
      const [name, sha, peeled] = line.split('\t');
      map.set(name, peeled || sha);
    }
    return map;
  }

  /** Reads what a push left in git into the model: the new commits, then the branches and tags. `before` is `refs()` from before the push. */
  async toModelFrom(before) {
    const after = await this.refs();
    const heads = [...after.values()].filter((sha) => !this.toModel.has(sha));
    if (heads.length) {
      const input = [...new Set(heads)].join('\n') + '\n' + [...this.toModel.keys()].map((sha) => `^${sha}`).join('\n') + '\n';
      const shas = (await text(this.dir, ['rev-list', '--reverse', '--topo-order', '--stdin'], { input })).split('\n').filter(Boolean);
      for (const sha of shas) {
        const [parents, name, email, date, message] = (await text(this.dir, ['show', '-s', '--format=%P%x00%an%x00%ae%x00%aI%x00%B', sha])).split('\0');
        const files = new Map();
        const listing = (await run(this.dir, ['ls-tree', '-r', '-z', '--full-tree', sha])).toString('utf8').split('\0').filter(Boolean);
        const entries = listing.map((entry) => {
          const [meta, file] = entry.split('\t');
          const [mode, type, blob] = meta.split(' ');
          return { mode, type, blob, file };
        }).filter((e) => e.type === 'blob');
        if (entries.length) {
          const batch = await run(this.dir, ['cat-file', '--batch'], { input: entries.map((e) => e.blob).join('\n') + '\n' });
          let offset = 0;
          for (const entry of entries) {
            const eol = batch.indexOf(0x0a, offset);
            const [, , size] = batch.subarray(offset, eol).toString('utf8').split(' ');
            files.set(entry.file, Buffer.from(batch.subarray(eol + 1, eol + 1 + Number(size))));
            offset = eol + 1 + Number(size) + 1;
          }
        }
        const id = this.adapter.addCommit({
          id: sha,
          parents: parents.split(' ').filter(Boolean).map((p) => this.toModel.get(p)),
          message: message.replace(/\n+$/, ''),
          date,
          authorName: name,
          authorEmail: email,
          files,
        });
        this.toGit.set(id, sha);
        this.toModel.set(sha, id);
      }
    }
    for (const [refname, sha] of after) {
      if (before.get(refname) === sha) continue;
      const id = this.toModel.get(sha);
      if (refname.startsWith('refs/heads/')) this.adapter.setHead(refname.slice('refs/heads/'.length), id);
      else if (refname.startsWith('refs/tags/')) this.adapter.setTag(refname.slice('refs/tags/'.length), id);
    }
    for (const refname of before.keys()) {
      if (after.has(refname)) continue;
      if (refname.startsWith('refs/heads/')) this.adapter.setHead(refname.slice('refs/heads/'.length), null);
      else if (refname.startsWith('refs/tags/')) this.adapter.setTag(refname.slice('refs/tags/'.length), null);
    }
  }

  /** `git http-backend` for this request; the answer, whole (a push is only answered once the model has it). */
  cgi(req, pathInfo, repoDir) {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        GIT_PROJECT_ROOT: path.dirname(repoDir),
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: `/${path.basename(repoDir)}${pathInfo}`,
        REQUEST_METHOD: req.method,
        QUERY_STRING: req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '',
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        REMOTE_USER: 'dev',
        REMOTE_ADDR: '127.0.0.1',
        ...(req.headers['content-length'] ? { CONTENT_LENGTH: req.headers['content-length'] } : {}),
        ...(req.headers['content-encoding'] ? { HTTP_CONTENT_ENCODING: req.headers['content-encoding'] } : {}),
        ...(req.headers['git-protocol'] ? { GIT_PROTOCOL: req.headers['git-protocol'] } : {}),
      };
      const child = spawn('git', ['http-backend'], { env, windowsHide: true });
      const out = [];
      const err = [];
      child.stdout.on('data', (d) => out.push(d));
      child.stderr.on('data', (d) => err.push(d));
      child.on('error', reject);
      child.stdin.on('error', () => {});
      req.pipe(child.stdin);
      child.on('close', () => {
        const raw = Buffer.concat(out);
        const split = raw.indexOf('\r\n\r\n');
        if (split < 0) return reject(new Error(`git http-backend: ${Buffer.concat(err).toString('utf8') || 'no answer'}`));
        const headers = {};
        let status = 200;
        for (const line of raw.subarray(0, split).toString('utf8').split('\r\n')) {
          const i = line.indexOf(':');
          if (i < 0) continue;
          const key = line.slice(0, i).trim();
          const value = line.slice(i + 1).trim();
          if (key.toLowerCase() === 'status') status = Number.parseInt(value, 10);
          else headers[key] = value;
        }
        resolve({ status, headers, body: raw.subarray(split + 4) });
      });
    });
  }
}

/**
 * The router that serves `<full path>.git/...` for a double. `find(fullPath)` gives the project (or nothing), `adapterOf(project)` how
 * to read and write its model. Returns the router, and `dispose()` to remove what was written to disk.
 */
export function createGitHttp({ find, adapterOf }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-git-double-'));
  const mirrors = new Map();
  let counter = 0;

  const mirrorOf = (project) => {
    let mirror = mirrors.get(project);
    if (!mirror) {
      mirror = new GitMirror({ dir: path.join(root, `repo${++counter}.git`), adapter: adapterOf(project) });
      mirrors.set(project, mirror);
    }
    return mirror;
  };

  const router = express.Router();
  router.use(async (req, res, next) => {
    const m = /^\/(.+?)\.git(\/.*)$/.exec(req.path);
    if (!m) return next();
    if (!req.headers.authorization) {
      res.set('WWW-Authenticate', 'Basic realm="git"');
      return res.status(401).send('Authentication required');
    }
    const project = find(decodeURIComponent(m[1]));
    if (!project) return res.status(404).send('Repository not found');
    const mirror = mirrorOf(project);
    try {
      const answer = await mirror.exclusive(async () => {
        await mirror.fromModel();
        const pushes = m[2].endsWith('git-receive-pack') && req.method === 'POST';
        const before = pushes ? await mirror.refs() : undefined;
        const result = await mirror.cgi(req, m[2], mirror.dir);
        if (before) await mirror.toModelFrom(before);
        return result;
      });
      res.status(answer.status);
      for (const [name, value] of Object.entries(answer.headers)) res.set(name, value);
      res.send(answer.body);
    } catch (error) {
      res.status(500).send(String(error.message ?? error));
    }
  });

  return {
    router,
    reset: () => mirrors.clear(),
    dispose: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
