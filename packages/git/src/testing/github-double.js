import express from 'express';
import crypto from 'crypto';
import JSZip from 'jszip';
import { createGitHttp } from './git-http.js';
import { unifiedDiff } from './diff.js';

/**
 * An in-memory GitHub: just the part of its REST API that LINEA uses, with real git behaviour behind it (content-addressed blobs and
 * trees, commits with parents, branches and tags as refs, pull requests that merge or conflict). It is what the GitHub provider is tested
 * against, and what `dev/fake-github.js` serves so the whole of LINEA can run on a laptop with `GIT_PROVIDER=github`.
 *
 * The user making every call is `dev` (the token is not looked at). A few things behave as on the real thing on purpose: the
 * `mergeable` of a pull request is `null` the first time it is asked for, a ref update that is not a fast forward is refused (422), a
 * file update without the current sha is refused, and a fault can be injected (rate limits) with `double.inject()`.
 */

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');
const blobSha = (buffer) => crypto.createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex');
const ROLES = { admin: 50, maintain: 40, write: 30, triage: 20, read: 20 };
const permissionsOf = (role) => ({
  admin: role === 'admin',
  maintain: role === 'admin' || role === 'maintain',
  push: ['admin', 'maintain', 'write'].includes(role),
  triage: role !== 'read',
  pull: true,
});

const NOT_FOUND = { message: 'Not Found' };

class Repo {
  constructor({ id, name, owner, description = '', topics = [], defaultBranch = 'main', autoInit = true }) {
    this.id = id;
    this.name = name;
    this.owner = owner;
    this.description = description;
    this.topics = topics;
    this.defaultBranch = defaultBranch;
    this.blobs = new Map();
    this.trees = new Map();
    this.commits = new Map();
    this.refs = new Map();
    this.tagObjects = new Map();
    this.pulls = [];
    this.issues = [];
    this.releases = [];
    this.nextRelease = 1;
    this.labels = [];
    this.milestones = [];
    this.hooks = [];
    this.runs = [];
    this.collaborators = [{ login: 'dev', id: 1, role: 'admin' }];
    this.nextPull = 1;
    if (autoInit) {
      const entries = new Map([['README.md', this.putBlob(Buffer.from(`# ${name}\n`))]]);
      this.refs.set(`heads/${defaultBranch}`, this.makeCommit({ tree: this.putTree(entries), parents: [], message: 'Initial commit' }));
    }
  }

  get fullName() { return `${this.owner.login}/${this.name}`; }

  putBlob(buffer) {
    const sha = blobSha(buffer);
    this.blobs.set(sha, buffer);
    return sha;
  }

  putTree(entries) {
    const sorted = [...entries].sort(([a], [b]) => a.localeCompare(b));
    const sha = sha1(`tree ${JSON.stringify(sorted)}`);
    this.trees.set(sha, new Map(sorted));
    return sha;
  }

  makeCommit({ tree, parents, message, date = new Date().toISOString() }) {
    const sha = sha1(`commit ${tree} ${parents.join(',')} ${message} ${date} ${this.commits.size}`);
    this.commits.set(sha, { sha, tree, parents, message, author: { name: 'Dev User', email: 'dev@example.com', date } });
    return sha;
  }

  /** The commit a name points at: a branch, a tag (possibly annotated), or a sha. */
  resolve(ref) {
    let sha = this.refs.get(`heads/${ref}`) ?? this.refs.get(`tags/${ref}`) ?? (this.commits.has(ref) ? ref : undefined);
    if (sha && this.tagObjects.has(sha)) sha = this.tagObjects.get(sha).object.sha;
    return sha;
  }

  treeAt(ref) {
    const sha = this.resolve(ref);
    return sha ? this.trees.get(this.commits.get(sha).tree) : undefined;
  }

  ancestors(sha) {
    const seen = new Set();
    const walk = (current) => {
      if (seen.has(current)) return;
      seen.add(current);
      for (const parent of this.commits.get(current).parents) walk(parent);
    };
    walk(sha);
    return seen;
  }

  mergeBase(a, b) {
    const left = this.ancestors(a);
    const queue = [b];
    const seen = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (seen.has(current)) continue;
      seen.add(current);
      if (left.has(current)) return current;
      queue.push(...this.commits.get(current).parents);
    }
    return undefined;
  }

  /** Three-way merge of `head` into `base` (both branch names): the merged tree, or `null` when the same file changed on both sides. */
  mergeTrees(base, head) {
    const target = this.resolve(base);
    const source = this.resolve(head);
    const ancestor = this.mergeBase(target, source);
    const t = this.trees.get(this.commits.get(target).tree);
    const s = this.trees.get(this.commits.get(source).tree);
    const b = ancestor ? this.trees.get(this.commits.get(ancestor).tree) : new Map();
    const merged = new Map();
    for (const path of new Set([...t.keys(), ...s.keys(), ...b.keys()])) {
      const [tv, sv, bv] = [t.get(path), s.get(path), b.get(path)];
      let value;
      if (tv === sv) value = tv;
      else if (tv === bv) value = sv;
      else if (sv === bv) value = tv;
      else return null;
      if (value !== undefined) merged.set(path, value);
    }
    return { entries: merged, target, source };
  }

  mergeable(pull) {
    return this.mergeTrees(pull.base.ref, pull.head.ref) !== null;
  }

  /** Commits `changes` ([{path, sha | null}]) on top of `branch`. */
  commitOn(branch, changes, message) {
    const parent = this.refs.get(`heads/${branch}`);
    const entries = new Map(this.trees.get(this.commits.get(parent).tree));
    for (const { path, sha } of changes) {
      if (sha === null) entries.delete(path);
      else entries.set(path, sha);
    }
    const sha = this.makeCommit({ tree: this.putTree(entries), parents: [parent], message });
    this.refs.set(`heads/${branch}`, sha);
    return sha;
  }
}

/** How git over HTTP (git-http.js) reads and writes a repository's commits, branches and tags. */
const githubAdapter = (repo) => {
  const refsOf = (prefix) => new Map([...repo.refs].filter(([name]) => name.startsWith(prefix)).map(([name, sha]) => [name.slice(prefix.length), repo.tagObjects.get(sha)?.object.sha ?? sha]));
  return {
    defaultBranch: () => repo.defaultBranch,
    commits: () => [...repo.commits.values()].map((c) => ({
      id: c.sha, parents: c.parents, message: c.message, date: c.author.date, authorName: c.author.name, authorEmail: c.author.email,
      files: new Map([...repo.trees.get(c.tree)].map(([path, blob]) => [path, repo.blobs.get(blob)])),
    })),
    heads: () => refsOf('heads/'),
    tags: () => refsOf('tags/'),
    addCommit: ({ id, parents, message, date, authorName, authorEmail, files }) => {
      const entries = new Map([...files].map(([path, content]) => [path, repo.putBlob(content)]));
      repo.commits.set(id, { sha: id, tree: repo.putTree(entries), parents, message, author: { name: authorName, email: authorEmail, date } });
      return id;
    },
    setHead: (name, id) => (id ? repo.refs.set(`heads/${name}`, id) : repo.refs.delete(`heads/${name}`)),
    setTag: (name, id) => (id ? repo.refs.set(`tags/${name}`, id) : repo.refs.delete(`tags/${name}`)),
  };
};

export function createGithubDoubleApp(baseUrl = 'http://github.double') {
  const state = {
    user: { login: 'dev', id: 1, type: 'User' },
    orgs: new Map(),
    repos: new Map(),
    nextRepo: 1000,
    nextAccount: 10,
    faults: [],
    log: [],
    reset() {
      this.orgs.clear();
      this.repos.clear();
      this.nextRepo = 1000;
      this.faults = [];
      this.log = [];
    },
    addOrg(login, role = 'admin') {
      const org = { login, id: this.nextAccount++, type: 'Organization', role };
      this.orgs.set(login, org);
      return org;
    },
    ownerOf(login) {
      if (login === this.user.login) return this.user;
      return this.orgs.get(login);
    },
    createRepo({ owner, name, description, topics, defaultBranch, autoInit }) {
      const repo = new Repo({ id: this.nextRepo++, name, owner, description, topics, defaultBranch, autoInit });
      this.repos.set(repo.id, repo);
      return repo;
    },
    find(fullName) {
      return [...this.repos.values()].find((repo) => repo.fullName.toLowerCase() === String(fullName).toLowerCase());
    },
  };

  const web = (repo) => `${baseUrl}/${repo.fullName}`;
  const repoJson = (repo) => {
    const mine = repo.collaborators.find((c) => c.login === state.user.login)?.role ?? 'read';
    return {
      id: repo.id,
      name: repo.name,
      full_name: repo.fullName,
      owner: { login: repo.owner.login, id: repo.owner.id, type: repo.owner.type },
      description: repo.description,
      html_url: web(repo),
      topics: repo.topics,
      archived: false,
      private: false,
      default_branch: repo.defaultBranch,
      permissions: permissionsOf(mine),
    };
  };
  const commitJson = (repo, sha) => {
    const commit = repo.commits.get(sha);
    return { sha, html_url: `${web(repo)}/commit/${sha}`, commit: { message: commit.message, author: commit.author, tree: { sha: commit.tree } }, parents: commit.parents.map((p) => ({ sha: p })) };
  };
  const pullJson = (repo, pull, { withMergeable = false } = {}) => {
    const out = {
      number: pull.number,
      title: pull.title,
      state: pull.state,
      merged_at: pull.merged_at,
      html_url: `${web(repo)}/pull/${pull.number}`,
      head: { ...pull.head, sha: repo.resolve(pull.head.ref) },
      base: pull.base,
      body: pull.body ?? '',
      user: userJson(pull.author ?? 'dev'),
      labels: (pull.labels ?? []).map((name) => ({ name, color: repo.labels.find((l) => l.name === name)?.color ?? 'ededed' })),
      requested_reviewers: (pull.reviewers ?? []).map(userJson),
      assignees: [],
      created_at: pull.created_at ?? new Date(0).toISOString(),
      updated_at: pull.updated_at ?? pull.created_at ?? new Date(0).toISOString(),
      comments: (pull.comments ?? []).length,
      review_comments: (pull.reviewComments ?? []).length,
    };
    if (withMergeable) {
      // GitHub works it out in the background: the first ask has no answer yet
      if (!pull.computed) { pull.computed = true; out.mergeable = null; out.mergeable_state = 'unknown'; }
      else if (pull.state !== 'open') { out.mergeable = null; out.mergeable_state = 'unknown'; }
      else { const ok = repo.mergeable(pull); out.mergeable = ok; out.mergeable_state = ok ? 'clean' : 'dirty'; }
    }
    return out;
  };

  const app = express();
  // `git clone/push` against `<web url>/<owner>/<repo>.git`
  const gitHttp = createGitHttp({ find: (fullName) => state.find(fullName), adapterOf: githubAdapter });
  app.use(gitHttp.router);
  const router = express.Router();
  router.use(express.json({ limit: '50mb' }));
  router.use((req, res, next) => {
    state.log.push({ method: req.method, path: req.path });
    const index = state.faults.findIndex((fault) => !fault.match || fault.match.test(req.path));
    const fault = index < 0 ? undefined : state.faults.splice(index, 1)[0];
    if (!fault) return next();
    for (const [name, value] of Object.entries(fault.headers ?? {})) res.set(name, value);
    return res.status(fault.status).json(fault.body ?? { message: 'fault' });
  });

  const notFound = (res) => res.status(404).json(NOT_FOUND);
  const repoOr404 = (req, res) => {
    const repo = state.find(`${req.params.owner}/${req.params.repo}`);
    if (!repo) notFound(res);
    return repo;
  };

  // ── account ──────────────────────────────────────────────────────────────
  router.get('/user', (_req, res) => res.json({ login: state.user.login, id: state.user.id, avatar_url: '', type: 'User' }));
  router.get('/search/users', (req, res) => {
    const q = String(req.query.q ?? '');
    res.json({ total_count: 1, items: q ? [{ login: q, avatar_url: null }] : [] });
  });
  router.get('/users/:login', (req, res) => {
    const account = state.ownerOf(req.params.login);
    if (!account) return notFound(res);
    res.json({ login: account.login, id: account.id, type: account.type });
  });
  router.get('/user/memberships/orgs', (_req, res) =>
    res.json([...state.orgs.values()].map((org) => ({ state: 'active', role: org.role, organization: { login: org.login, id: org.id } }))));
  router.get('/orgs/:org', (req, res) => {
    const org = state.orgs.get(req.params.org);
    if (!org) return notFound(res);
    res.json({ login: org.login, id: org.id, members_can_create_repositories: true });
  });
  router.get('/user/repos', (req, res) => {
    const perPage = Number(req.query.per_page ?? 30);
    const page = Number(req.query.page ?? 1);
    const mine = [...state.repos.values()].filter((repo) => repo.collaborators.some((c) => c.login === state.user.login));
    res.json(mine.slice((page - 1) * perPage, page * perPage).map(repoJson));
  });
  router.get('/orgs/:org/repos', (req, res) => {
    const perPage = Number(req.query.per_page ?? 30);
    const page = Number(req.query.page ?? 1);
    const all = [...state.repos.values()].filter((repo) => repo.owner.login === req.params.org);
    res.json(all.slice((page - 1) * perPage, page * perPage).map(repoJson));
  });

  // ── repositories ─────────────────────────────────────────────────────────
  const create = (owner, req, res) => {
    const { name, description, auto_init: autoInit } = req.body ?? {};
    if (!name || !/^[A-Za-z0-9._-]+$/.test(name)) return res.status(422).json({ message: 'Repository creation failed.', errors: [{ message: 'name is invalid' }] });
    if (state.find(`${owner.login}/${name}`)) {
      return res.status(422).json({ message: 'Repository creation failed.', errors: [{ field: 'name', message: 'name already exists on this account' }] });
    }
    const repo = state.createRepo({ owner, name, description, autoInit: autoInit !== false });
    res.status(201).json(repoJson(repo));
  };
  router.post('/user/repos', (req, res) => create(state.user, req, res));
  router.post('/orgs/:org/repos', (req, res) => {
    const org = state.orgs.get(req.params.org);
    if (!org) return notFound(res);
    create(org, req, res);
  });
  router.get('/repositories/:id', (req, res) => {
    const repo = state.repos.get(Number(req.params.id));
    if (!repo) return notFound(res);
    res.json(repoJson(repo));
  });

  const R = '/repos/:owner/:repo';
  router.get(R, (req, res) => { const repo = repoOr404(req, res); if (repo) res.json(repoJson(repo)); });
  router.patch(R, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const { name, default_branch: defaultBranch, description } = req.body ?? {};
    if (name !== undefined && name !== repo.name) {
      if (state.find(`${repo.owner.login}/${name}`)) return res.status(422).json({ message: 'Repository creation failed.', errors: [{ message: 'name already exists on this account' }] });
      repo.name = name;
    }
    if (defaultBranch !== undefined) {
      if (!repo.refs.has(`heads/${defaultBranch}`)) return res.status(422).json({ message: 'Validation Failed' });
      repo.defaultBranch = defaultBranch;
    }
    if (description !== undefined) repo.description = description;
    res.json(repoJson(repo));
  });
  router.delete(R, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    state.repos.delete(repo.id);
    res.status(204).end();
  });
  router.get(`${R}/topics`, (req, res) => { const repo = repoOr404(req, res); if (repo) res.json({ names: repo.topics }); });
  router.put(`${R}/topics`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    repo.topics = [...(req.body?.names ?? [])];
    res.json({ names: repo.topics });
  });
  router.get(`${R}/collaborators`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    // `affiliation=direct` leaves out what comes from the organization (a collaborator marked `inherited`)
    const list = req.query.affiliation === 'direct' ? repo.collaborators.filter((c) => !c.inherited) : repo.collaborators;
    res.json(list.map((c) => ({ login: c.login, id: c.id, role_name: c.role, permissions: permissionsOf(c.role) })));
  });
  router.put(`${R}/collaborators/:user`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const role = { pull: 'read', push: 'write', maintain: 'maintain', admin: 'admin' }[req.body?.permission] ?? 'read';
    const found = repo.collaborators.find((c) => c.login === req.params.user && !c.inherited);
    if (found) { found.role = role; return res.status(204).end(); }
    repo.collaborators.push({ login: req.params.user, id: 100 + repo.collaborators.length, role });
    res.status(201).json({ id: 1, permissions: permissionsOf(role) });
  });
  router.delete(`${R}/collaborators/:user`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    repo.collaborators = repo.collaborators.filter((c) => c.login !== req.params.user || c.inherited);
    res.status(204).end();
  });
  router.get(`${R}/collaborators/:user/permission`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const found = repo.collaborators.find((c) => c.login === req.params.user);
    if (!found) return res.json({ permission: 'none', role_name: 'none', user: { login: req.params.user } });
    res.json({ permission: found.role === 'maintain' || found.role === 'triage' ? 'write' : found.role, role_name: found.role, user: { login: found.login } });
  });

  // ── contents ─────────────────────────────────────────────────────────────
  const wantsRaw = (req) => /raw/.test(req.get('accept') ?? '');
  router.get(`${R}/contents/*`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const path = req.params[0];
    const tree = repo.treeAt(req.query.ref ?? repo.defaultBranch);
    const sha = tree?.get(path);
    if (!sha) return notFound(res);
    const bytes = repo.blobs.get(sha);
    if (wantsRaw(req)) return res.status(200).type('application/octet-stream').send(bytes);
    res.json({ type: 'file', name: path.split('/').pop(), path, sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64').replace(/(.{60})/g, '$1\n') });
  });
  const writeContents = (req, res, { remove }) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const path = req.params[0];
    const branch = req.body?.branch ?? repo.defaultBranch;
    if (!repo.refs.has(`heads/${branch}`)) return notFound(res);
    const current = repo.treeAt(branch).get(path);
    const given = req.body?.sha;
    if (remove && !current) return notFound(res);
    if (current && given === undefined) return res.status(422).json({ message: "Invalid request.\n\n\"sha\" wasn't supplied." });
    if (current && given !== current) return res.status(409).json({ message: `${path} does not match ${given}` });
    if (!current && given !== undefined && !remove) return res.status(422).json({ message: 'Invalid request: sha' });
    const sha = remove ? null : repo.putBlob(Buffer.from(req.body?.content ?? '', 'base64'));
    const commit = repo.commitOn(branch, [{ path, sha }], req.body?.message ?? `Update ${path}`);
    res.status(remove ? 200 : current ? 200 : 201).json({ content: remove ? null : { path, sha }, commit: { sha: commit } });
  };
  router.put(`${R}/contents/*`, (req, res) => writeContents(req, res, { remove: false }));
  router.delete(`${R}/contents/*`, (req, res) => writeContents(req, res, { remove: true }));

  // ── git data ─────────────────────────────────────────────────────────────
  router.post(`${R}/git/blobs`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const { content = '', encoding = 'utf-8' } = req.body ?? {};
    res.status(201).json({ sha: repo.putBlob(Buffer.from(content, encoding === 'base64' ? 'base64' : 'utf8')) });
  });
  router.get(`${R}/git/blobs/:sha`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const bytes = repo.blobs.get(req.params.sha);
    if (!bytes) return notFound(res);
    res.json({ sha: req.params.sha, encoding: 'base64', content: bytes.toString('base64'), size: bytes.length });
  });
  router.post(`${R}/git/trees`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const base = req.body?.base_tree ? repo.trees.get(req.body.base_tree) : new Map();
    if (!base) return res.status(422).json({ message: 'base_tree not found' });
    const entries = new Map(base);
    for (const item of req.body?.tree ?? []) {
      if (item.sha === null) entries.delete(item.path);
      else if (!repo.blobs.has(item.sha)) return res.status(422).json({ message: `GitRPC::BadObjectState: ${item.path}` });
      else entries.set(item.path, item.sha);
    }
    res.status(201).json({ sha: repo.putTree(entries) });
  });
  router.get(`${R}/git/trees/:ref`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const ref = req.params.ref;
    const tree = repo.trees.get(ref) ?? (repo.commits.has(ref) ? repo.trees.get(repo.commits.get(ref).tree) : undefined) ?? repo.treeAt(ref);
    if (!tree) return notFound(res);
    res.json({ sha: ref, truncated: false, tree: [...tree].map(([path, sha]) => ({ path, mode: '100644', type: 'blob', sha })) });
  });
  router.post(`${R}/git/commits`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const { message, tree, parents = [] } = req.body ?? {};
    if (!repo.trees.has(tree)) return res.status(422).json({ message: 'Tree SHA does not exist' });
    res.status(201).json({ sha: repo.makeCommit({ tree, parents, message }) });
  });
  router.get(`${R}/git/commits/:sha`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    if (!repo.commits.has(req.params.sha)) return notFound(res);
    const commit = repo.commits.get(req.params.sha);
    res.json({ sha: commit.sha, message: commit.message, tree: { sha: commit.tree }, parents: commit.parents.map((p) => ({ sha: p })), author: commit.author });
  });
  router.post(`${R}/git/tags`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const { tag, message, object } = req.body ?? {};
    const sha = sha1(`tag ${tag} ${object} ${message}`);
    repo.tagObjects.set(sha, { sha, tag, message, object: { sha: object, type: 'commit' } });
    res.status(201).json({ sha });
  });
  router.get(`${R}/git/tags/:sha`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const found = repo.tagObjects.get(req.params.sha);
    if (!found) return notFound(res);
    res.json(found);
  });
  router.get(`${R}/git/ref/*`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const sha = repo.refs.get(req.params[0]);
    if (!sha) return notFound(res);
    res.json({ ref: `refs/${req.params[0]}`, object: { sha, type: repo.tagObjects.has(sha) ? 'tag' : 'commit' } });
  });
  router.post(`${R}/git/refs`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const { ref, sha } = req.body ?? {};
    const name = String(ref).replace(/^refs\//, '');
    if (repo.refs.has(name)) return res.status(422).json({ message: 'Reference already exists' });
    if (!repo.commits.has(sha) && !repo.tagObjects.has(sha)) return res.status(422).json({ message: 'Object does not exist' });
    repo.refs.set(name, sha);
    res.status(201).json({ ref, object: { sha } });
  });
  router.patch(`${R}/git/refs/*`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const name = req.params[0];
    const current = repo.refs.get(name);
    if (!current) return notFound(res);
    const { sha, force } = req.body ?? {};
    if (!repo.commits.has(sha)) return res.status(422).json({ message: 'Object does not exist' });
    if (!force && !repo.ancestors(sha).has(current)) return res.status(422).json({ message: 'Update is not a fast forward' });
    repo.refs.set(name, sha);
    res.json({ ref: `refs/${name}`, object: { sha } });
  });
  router.delete(`${R}/git/refs/*`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    if (!repo.refs.delete(req.params[0])) return res.status(422).json({ message: 'Reference does not exist' });
    res.status(204).end();
  });

  // ── commits, branches, tags ──────────────────────────────────────────────
  router.get(`${R}/commits`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    let sha = repo.resolve(req.query.sha ?? repo.defaultBranch);
    if (!sha) return res.status(409).json({ message: 'Git Repository is empty.' });
    const out = [];
    const perPage = Number(req.query.per_page ?? 30);
    while (sha && out.length < perPage) {
      out.push(commitJson(repo, sha));
      sha = repo.commits.get(sha).parents[0];
    }
    res.json(out);
  });
  router.get(`${R}/compare/:range`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const [from, to] = req.params.range.split('...').map((ref) => repo.resolve(decodeURIComponent(ref)));
    if (!from || !to) return notFound(res);
    const base = repo.mergeBase(from, to);
    const commits = [];
    for (let sha = to; sha && sha !== base; sha = repo.commits.get(sha).parents[0]) commits.unshift(commitJson(repo, sha));
    const before = base ? repo.trees.get(repo.commits.get(base).tree) : new Map();
    const after = repo.trees.get(repo.commits.get(to).tree);
    const files = [];
    for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const [b, a] = [before.get(path), after.get(path)];
      if (b === a) continue;
      const patch = unifiedDiff(b ? repo.blobs.get(b).toString('utf8') : '', a ? repo.blobs.get(a).toString('utf8') : '');
      files.push({
        filename: path, status: !b ? 'added' : !a ? 'removed' : 'modified',
        additions: patch.split('\n').filter((l) => l.startsWith('+')).length, deletions: patch.split('\n').filter((l) => l.startsWith('-')).length, patch,
      });
    }
    res.json({ commits, files });
  });
  router.get(`${R}/commits/:ref`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const sha = repo.resolve(req.params.ref);
    if (!sha) return notFound(res);
    res.json(commitJson(repo, sha));
  });
  router.get(`${R}/branches`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    res.json([...repo.refs.keys()].filter((name) => name.startsWith('heads/')).map((name) => ({ name: name.slice(6) })));
  });
  router.get(`${R}/branches/:name`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const sha = repo.refs.get(`heads/${req.params.name}`);
    if (!sha) return notFound(res);
    res.json({ name: req.params.name, commit: commitJson(repo, sha) });
  });
  router.post(`${R}/branches/:name/rename`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const sha = repo.refs.get(`heads/${req.params.name}`);
    if (!sha) return notFound(res);
    repo.refs.delete(`heads/${req.params.name}`);
    repo.refs.set(`heads/${req.body.new_name}`, sha);
    if (repo.defaultBranch === req.params.name) repo.defaultBranch = req.body.new_name;
    res.status(201).json({ name: req.body.new_name, commit: commitJson(repo, sha) });
  });
  router.get(`${R}/tags`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const perPage = Number(req.query.per_page ?? 30);
    const page = Number(req.query.page ?? 1);
    const tags = [...repo.refs].filter(([name]) => name.startsWith('tags/')).map(([name, sha]) => ({ name: name.slice(5), commit: { sha: repo.tagObjects.get(sha)?.object.sha ?? sha } }));
    res.json(tags.slice((page - 1) * perPage, page * perPage));
  });

  // ── releases ─────────────────────────────────────────────────────────────
  const releaseJson = (repo, release) => ({
    id: release.id,
    tag_name: release.tag_name,
    name: release.name,
    body: release.body,
    prerelease: release.prerelease,
    draft: Boolean(release.draft),
    created_at: release.created_at,
    html_url: `${web(repo)}/releases/tag/${release.tag_name}`,
  });
  router.post(`${R}/releases`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const { tag_name: tag, name, body, prerelease } = req.body ?? {};
    if (!tag) return res.status(422).json({ message: 'Validation Failed', errors: [{ resource: 'Release', code: 'missing_field', field: 'tag_name' }] });
    if (repo.releases.some((r) => r.tag_name === tag)) return res.status(422).json({ message: 'Validation Failed', errors: [{ resource: 'Release', code: 'already_exists', field: 'tag_name' }] });
    // (real GitHub would make the tag from the default branch; the provider never asks for that)
    if (!repo.refs.has(`tags/${tag}`)) return res.status(422).json({ message: 'Validation Failed', errors: [{ resource: 'Release', code: 'invalid', field: 'tag_name' }] });
    const release = { id: repo.nextRelease++, tag_name: tag, name: name ?? null, body: body ?? '', prerelease: Boolean(prerelease), created_at: new Date().toISOString() };
    repo.releases.push(release);
    res.status(201).json(releaseJson(repo, release));
  });
  router.get(`${R}/releases`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const perPage = Number(req.query.per_page ?? 30);
    const page = Number(req.query.page ?? 1);
    const all = [...repo.releases].reverse().map((release) => releaseJson(repo, release));
    res.json(all.slice((page - 1) * perPage, page * perPage));
  });
  router.get(`${R}/releases/tags/*`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const release = repo.releases.find((r) => r.tag_name === req.params[0]);
    if (!release) return notFound(res);
    res.json(releaseJson(repo, release));
  });
  router.patch(`${R}/releases/:rid`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const release = repo.releases.find((r) => r.id === Number(req.params.rid));
    if (!release) return notFound(res);
    const { name, body, prerelease } = req.body ?? {};
    if (name !== undefined) release.name = name;
    if (body !== undefined) release.body = body;
    if (prerelease !== undefined) release.prerelease = Boolean(prerelease);
    res.json(releaseJson(repo, release));
  });
  router.delete(`${R}/releases/:rid`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const index = repo.releases.findIndex((r) => r.id === Number(req.params.rid));
    if (index < 0) return notFound(res);
    repo.releases.splice(index, 1);
    res.status(204).send();
  });

  // ── pull requests ────────────────────────────────────────────────────────
  router.post(`${R}/pulls`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const { title, head, base } = req.body ?? {};
    if (!repo.refs.has(`heads/${head}`) || !repo.refs.has(`heads/${base}`)) return res.status(422).json({ message: 'Validation Failed', errors: [{ message: 'branch does not exist' }] });
    if (repo.pulls.some((p) => p.state === 'open' && p.head.ref === head && p.base.ref === base)) {
      return res.status(422).json({ message: 'Validation Failed', errors: [{ message: `A pull request already exists for ${repo.owner.login}:${head}.` }] });
    }
    const now = new Date().toISOString();
    const pull = {
      number: repo.nextPull++, title, state: 'open', merged_at: null, head: { ref: head }, base: { ref: base },
      body: req.body?.body ?? '', author: 'dev', labels: [], reviewers: [], created_at: now, updated_at: now,
      comments: [], reviewComments: [], reviews: [], nextComment: 1,
    };
    repo.pulls.push(pull);
    res.status(201).json(pullJson(repo, pull));
  });
  router.get(`${R}/pulls`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const { state = 'open', base, head } = req.query;
    const found = repo.pulls.filter((p) => (state === 'all' || (state === 'open' ? p.state === 'open' : p.state === 'closed')) && (!base || p.base.ref === base) && (!head || p.head.ref === String(head).split(':').pop()));
    const perPage = Number(req.query.per_page ?? 30);
    const page = Number(req.query.page ?? 1);
    res.json(found.sort((a, b) => b.number - a.number).slice((page - 1) * perPage, page * perPage).map((p) => pullJson(repo, p)));
  });
  const pullOr404 = (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return [];
    const pull = repo.pulls.find((p) => p.number === Number(req.params.n));
    if (!pull) { notFound(res); return []; }
    return [repo, pull];
  };
  router.get(`${R}/pulls/:n`, (req, res) => {
    const [repo, pull] = pullOr404(req, res);
    if (pull) res.json(pullJson(repo, pull, { withMergeable: true }));
  });
  router.patch(`${R}/pulls/:n`, (req, res) => {
    const [repo, pull] = pullOr404(req, res);
    if (!pull) return;
    if (req.body?.title !== undefined) pull.title = req.body.title;
    if (req.body?.body !== undefined) pull.body = req.body.body;
    if (req.body?.state !== undefined) pull.state = req.body.state;
    pull.updated_at = new Date().toISOString();
    res.json(pullJson(repo, pull));
  });
  router.put(`${R}/pulls/:n/merge`, (req, res) => {
    const [repo, pull] = pullOr404(req, res);
    if (!pull) return;
    if (pull.state !== 'open') return res.status(405).json({ message: 'Pull Request is not mergeable' });
    const merged = repo.mergeTrees(pull.base.ref, pull.head.ref);
    if (!merged) return res.status(405).json({ message: 'Pull Request is not mergeable' });
    const squash = req.body?.merge_method === 'squash';
    const fastForward = repo.ancestors(merged.source).has(merged.target) && !squash;
    // a squash leaves one commit whose only parent is the target
    const sha = fastForward
      ? merged.source
      : repo.makeCommit({ tree: repo.putTree(merged.entries), parents: squash ? [merged.target] : [merged.target, merged.source], message: req.body?.commit_message ?? `${squash ? 'Squash' : 'Merge'} pull request #${pull.number}` });
    repo.refs.set(`heads/${pull.base.ref}`, sha);
    pull.state = 'closed';
    pull.merged_at = new Date().toISOString();
    pull.updated_at = pull.merged_at;
    res.json({ merged: true, sha, message: 'Pull Request successfully merged' });
  });

  // ── hooks, actions, archives ─────────────────────────────────────────────
  router.get(`${R}/hooks`, (req, res) => { const repo = repoOr404(req, res); if (repo) res.json(repo.hooks); });
  router.post(`${R}/hooks`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const hook = { id: repo.hooks.length + 1, name: 'web', active: true, events: req.body?.events ?? [], config: req.body?.config ?? {} };
    repo.hooks.push(hook);
    res.status(201).json(hook);
  });
  router.get(`${R}/actions/runs`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const runs = repo.runs.filter((run) => !req.query.branch || run.head_branch === req.query.branch).slice(0, Number(req.query.per_page ?? 30));
    res.json({ total_count: runs.length, workflow_runs: runs });
  });
  router.get(`${R}/zipball/:ref`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    if (!repo.resolve(req.params.ref)) return notFound(res);
    res.redirect(302, `${baseUrl}/__codeload/${repo.id}/${encodeURIComponent(req.params.ref)}`);
  });
  app.get('/__codeload/:id/:ref', async (req, res) => {
    const repo = state.repos.get(Number(req.params.id));
    const tree = repo?.treeAt(req.params.ref);
    if (!tree) return notFound(res);
    const root = `${repo.owner.login}-${repo.name}-${repo.resolve(req.params.ref).slice(0, 7)}`;
    const zip = new JSZip();
    for (const [path, sha] of tree) zip.file(`${root}/${path}`, repo.blobs.get(sha));
    res.status(200).type('application/zip').send(await zip.generateAsync({ type: 'nodebuffer' }));
  });

  // ── issues, labels, milestones ───────────────────────────────────────────
  // (an issue and a pull request share the numbers of a repository, as on GitHub)
  const userJson = (login) => ({ login, id: 1000 + login.length, type: 'User' });
  const issueJson = (repo, issue) => ({
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    user: userJson(issue.author),
    assignees: issue.assignees.map(userJson),
    labels: issue.labels.map((name) => ({ name, color: repo.labels.find((l) => l.name === name)?.color ?? 'ededed' })),
    milestone: issue.milestone ? { number: issue.milestone.number, title: issue.milestone.title } : null,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    closed_at: issue.closed_at,
    html_url: `${web(repo)}/issues/${issue.number}`,
    comments: issue.comments.length,
  });
  const issueOr404 = (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return [];
    const issue = repo.issues.find((i) => i.number === Number(req.params.n));
    // a pull request answers on the path of an issue as well
    const pull = repo.pulls.find((p) => p.number === Number(req.params.n));
    if (!issue && !pull) { notFound(res); return []; }
    return [repo, issue ?? { pullRequest: pull }];
  };
  const filterIssues = (repo, { state = 'open', creator, assignee, labels, milestone, text } = {}) => repo.issues
    .filter((i) => (state === 'all' || i.state === state)
      && (!creator || i.author === creator)
      && (!assignee || i.assignees.includes(assignee))
      && (!labels || String(labels).split(',').every((l) => i.labels.includes(l)))
      && (!milestone || i.milestone?.number === Number(milestone))
      && (!text || `${i.title} ${i.body}`.toLowerCase().includes(text.toLowerCase())))
    .sort((a, b) => b.number - a.number);
  const paged = (req, list) => {
    const perPage = Number(req.query.per_page ?? 30);
    const page = Number(req.query.page ?? 1);
    return list.slice((page - 1) * perPage, page * perPage);
  };
  router.get(`${R}/labels`, (req, res) => { const repo = repoOr404(req, res); if (repo) res.json(paged(req, repo.labels)); });
  router.post(`${R}/labels`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const label = { name: req.body?.name, color: req.body?.color ?? 'ededed' };
    repo.labels.push(label);
    res.status(201).json(label);
  });
  router.get(`${R}/milestones`, (req, res) => { const repo = repoOr404(req, res); if (repo) res.json(paged(req, repo.milestones)); });
  router.post(`${R}/milestones`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const milestone = { number: repo.milestones.length + 1, title: req.body?.title, state: 'open', due_on: null };
    repo.milestones.push(milestone);
    res.status(201).json(milestone);
  });
  router.post(`${R}/issues`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    const { title, body, labels, assignees, milestone } = req.body ?? {};
    if (!title) return res.status(422).json({ message: 'Validation Failed', errors: [{ message: 'title is missing' }] });
    const now = new Date().toISOString();
    const issue = {
      number: repo.nextPull++, title, body: body ?? '', state: 'open', author: 'dev', created_at: now, updated_at: now, closed_at: null,
      labels: labels ?? [], assignees: assignees ?? [], milestone: repo.milestones.find((m) => m.number === milestone) ?? null, comments: [],
    };
    repo.issues.push(issue);
    res.status(201).json(issueJson(repo, issue));
  });
  router.get(`${R}/issues`, (req, res) => {
    const repo = repoOr404(req, res);
    if (!repo) return;
    res.json(paged(req, filterIssues(repo, req.query)).map((i) => issueJson(repo, i)));
  });
  router.get(`${R}/issues/:n`, (req, res) => {
    const [repo, issue] = issueOr404(req, res);
    if (!issue) return;
    if (issue.pullRequest) return res.json({ ...pullJson(repo, issue.pullRequest), pull_request: {} });
    res.json(issueJson(repo, issue));
  });
  router.patch(`${R}/issues/:n`, (req, res) => {
    const [repo, issue] = issueOr404(req, res);
    if (!issue || issue.pullRequest) return;
    const body = req.body ?? {};
    if (body.title !== undefined) issue.title = body.title;
    if (body.body !== undefined) issue.body = body.body;
    if (body.labels !== undefined) issue.labels = body.labels;
    if (body.assignees !== undefined) issue.assignees = body.assignees;
    if (body.milestone !== undefined) issue.milestone = repo.milestones.find((m) => m.number === body.milestone) ?? null;
    if (body.state !== undefined && body.state !== issue.state) {
      issue.state = body.state;
      issue.closed_at = body.state === 'closed' ? new Date().toISOString() : null;
    }
    issue.updated_at = new Date().toISOString();
    res.json(issueJson(repo, issue));
  });
  router.get(`${R}/issues/:n/comments`, (req, res) => {
    const [, issue] = issueOr404(req, res);
    if (issue) res.json(paged(req, (issue.pullRequest ? issue.pullRequest.comments : issue.comments).map((c) => ({ ...c, user: userJson(c.author) }))));
  });
  router.post(`${R}/issues/:n/comments`, (req, res) => {
    const [, issue] = issueOr404(req, res);
    if (!issue) return;
    const list = issue.pullRequest ? issue.pullRequest.comments : issue.comments;
    const comment = { id: Math.floor(Math.random() * 1e9),  body: req.body?.body ?? '', author: 'dev', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    list.push(comment);
    res.status(201).json({ ...comment, user: userJson('dev') });
  });
  // labels of an issue or a pull request: they live on the issue of that number
  const labelled = (req, res) => {
    const [repo, item] = issueOr404(req, res);
    if (!item) return [];
    return [repo, item.pullRequest ?? item];
  };
  const labelsJson = (repo, item) => (item.labels ?? []).map((name) => ({ name, color: repo.labels.find((l) => l.name === name)?.color ?? 'ededed' }));
  router.post(`${R}/issues/:n/labels`, (req, res) => {
    const [repo, item] = labelled(req, res);
    if (!item) return;
    item.labels = [...new Set([...(item.labels ?? []), ...(req.body?.labels ?? [])])];
    res.json(labelsJson(repo, item));
  });
  router.put(`${R}/issues/:n/labels`, (req, res) => {
    const [repo, item] = labelled(req, res);
    if (!item) return;
    item.labels = req.body?.labels ?? [];
    res.json(labelsJson(repo, item));
  });
  // the code of a pull request, line by line, and what people said about it
  router.get(`${R}/pulls/:n/files`, (req, res) => {
    const [repo, pull] = pullOr404(req, res);
    if (!pull) return;
    const target = repo.resolve(pull.base.ref);
    const source = repo.resolve(pull.head.ref);
    const base = repo.mergeBase(target, source);
    const before = base ? repo.trees.get(repo.commits.get(base).tree) : new Map();
    const after = repo.trees.get(repo.commits.get(source).tree);
    const files = [];
    for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const [b, a] = [before.get(path), after.get(path)];
      if (b === a) continue;
      const patch = unifiedDiff(b ? repo.blobs.get(b).toString('utf8') : '', a ? repo.blobs.get(a).toString('utf8') : '');
      files.push({
        filename: path, status: !b ? 'added' : !a ? 'removed' : 'modified',
        additions: patch.split('\n').filter((l) => l.startsWith('+')).length, deletions: patch.split('\n').filter((l) => l.startsWith('-')).length, patch,
      });
    }
    res.json(paged(req, files));
  });
  router.get(`${R}/pulls/:n/comments`, (req, res) => {
    const [, pull] = pullOr404(req, res);
    if (pull) res.json(paged(req, pull.reviewComments.map((c) => ({ ...c, user: userJson(c.author) }))));
  });
  router.post(`${R}/pulls/:n/comments`, (req, res) => {
    const [, pull] = pullOr404(req, res);
    if (!pull) return;
    const { body, path, line, side, in_reply_to, commit_id } = req.body ?? {};
    if (!body) return res.status(422).json({ message: 'Validation Failed', errors: [{ message: 'body is missing' }] });
    const root = in_reply_to ? pull.reviewComments.find((c) => c.id === in_reply_to) : null;
    if (in_reply_to && !root) return notFound(res);
    const now = new Date().toISOString();
    const comment = {
      id: Math.floor(Math.random() * 1e9), body, author: 'dev', created_at: now, updated_at: now,
      path: root?.path ?? path, line: root?.line ?? line, side: root?.side ?? side ?? 'RIGHT', commit_id: commit_id ?? repoSha(pull),
      ...(in_reply_to ? { in_reply_to_id: in_reply_to } : {}),
    };
    pull.reviewComments.push(comment);
    pull.updated_at = now;
    res.status(201).json({ ...comment, user: userJson('dev') });
  });
  const repoSha = (pull) => pull.head.ref;
  router.get(`${R}/pulls/:n/reviews`, (req, res) => {
    const [, pull] = pullOr404(req, res);
    if (pull) res.json(paged(req, pull.reviews.map((r) => ({ ...r, user: userJson(r.author) }))));
  });
  router.post(`${R}/pulls/:n/reviews`, (req, res) => {
    const [, pull] = pullOr404(req, res);
    if (!pull) return;
    const review = { id: pull.reviews.length + 1, author: 'dev', state: req.body?.event === 'APPROVE' ? 'APPROVED' : 'COMMENTED', body: req.body?.body ?? '' };
    pull.reviews.push(review);
    res.status(200).json({ ...review, user: userJson('dev') });
  });
  router.post(`${R}/pulls/:n/requested_reviewers`, (req, res) => {
    const [repo, pull] = pullOr404(req, res);
    if (!pull) return;
    pull.reviewers = [...new Set([...(pull.reviewers ?? []), ...(req.body?.reviewers ?? [])])];
    res.status(201).json(pullJson(repo, pull));
  });
  router.delete(`${R}/pulls/:n/requested_reviewers`, (req, res) => {
    const [repo, pull] = pullOr404(req, res);
    if (!pull) return;
    pull.reviewers = (pull.reviewers ?? []).filter((login) => !(req.body?.reviewers ?? []).includes(login));
    res.json(pullJson(repo, pull));
  });
  // The search of issues: the qualifiers LINEA sends (`repo:`, `state:`, `author:`, `assignee:`, `label:`, `milestone:`) and the free text.
  router.get('/search/issues', (req, res) => {
    const q = String(req.query.q ?? '');
    const qualifiers = {};
    const flags = [];
    const text = q.replace(/(\w+):("[^"]*"|\S+)/g, (_all, key, value) => { const clean = value.replace(/^"|"$/g, ''); if (key === 'is') flags.push(clean); else qualifiers[key] = clean; return ''; }).trim();
    const repo = [...state.repos.values()].find((r) => r.fullName === qualifiers.repo);
    if (!repo) return res.json({ total_count: 0, items: [] });
    if (flags.includes('pr')) {
      const wantOpen = flags.includes('open');
      const found = repo.pulls
        .filter((p) => (flags.includes('merged') ? Boolean(p.merged_at) : flags.includes('unmerged') ? !p.merged_at : true)
          && (wantOpen ? p.state === 'open' : flags.includes('closed') || flags.includes('merged') ? p.state === 'closed' : true)
          && (!qualifiers.author || (p.author ?? 'dev') === qualifiers.author)
          && (!qualifiers['review-requested'] || (p.reviewers ?? []).includes(qualifiers['review-requested']))
          && (!qualifiers.label || (p.labels ?? []).includes(qualifiers.label))
          && (!qualifiers.base || p.base.ref === qualifiers.base)
          && (!text || `${p.title} ${p.body ?? ''}`.toLowerCase().includes(text.toLowerCase())))
        .sort((a, b) => b.number - a.number);
      return res.json({ total_count: found.length, items: paged(req, found).map((p) => ({ number: p.number, title: p.title, pull_request: {} })) });
    }
    const milestone = qualifiers.milestone ? repo.milestones.find((m) => m.title === qualifiers.milestone)?.number ?? -1 : undefined;
    const found = filterIssues(repo, { state: qualifiers.state ?? 'all', creator: qualifiers.author, assignee: qualifiers.assignee, labels: qualifiers.label, milestone, text });
    res.json({ total_count: found.length, items: paged(req, found).map((i) => issueJson(repo, i)) });
  });

  app.use(router);
  app.use((req, res) => res.status(501).json({ message: `githubDouble: no handler for ${req.method} ${req.originalUrl}` }));
  return { app, state, gitHttp };
}

export async function startGithubDouble() {
  const holder = {};
  const server = await new Promise((resolve, reject) => {
    // the app has to know its own address (links, redirects): it is only known once the server listens
    const placeholder = express();
    placeholder.use((req, res, next) => holder.app(req, res, next));
    const s = placeholder.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const { app, state, gitHttp } = createGithubDoubleApp(url);
  holder.app = app;

  return {
    url,
    state,
    roles: ROLES,
    addOrg: (login, role) => state.addOrg(login, role),
    setCollaborator: (repoId, login, role) => {
      const repo = state.repos.get(repoId);
      const found = repo.collaborators.find((c) => c.login === login);
      if (found) found.role = role;
      else repo.collaborators.push({ login, id: 99, role });
    },
    addRun: (repoId, run) => state.repos.get(repoId).runs.unshift(run),
    /** The next request (the next one whose path matches `fault.match`, when given) gets this answer instead of being handled: a rate limit, an outage. */
    inject: (fault) => state.faults.push(fault),
    getLog: () => [...state.log],
    reset: () => { state.reset(); gitHttp.reset(); },
    close: () => new Promise((resolve) => server.close(() => { gitHttp.dispose(); resolve(); })),
  };
}
