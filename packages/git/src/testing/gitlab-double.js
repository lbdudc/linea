import express from 'express';
import crypto from 'crypto';
import JSZip from 'jszip';
import { createGitHttp } from './git-http.js';
import { unifiedDiff } from './diff.js';

const CLIENT_ERROR_JSON = (message) => ({ error: message, message });

const sha1For = (seedText) => crypto.createHash('sha1').update(seedText).digest('hex');

const shortId = (sha) => sha.slice(0, 8);

const slugify = (name) =>
  String(name)
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';

// How long each job of a double pipeline takes, and what makes the next ones fail: `POST /api/v4/__dev/fail-next-pipeline`.
const PIPELINE_STAGES = ['build', 'test', 'deploy'];
const JOB_MS = Number(process.env.GITLAB_DOUBLE_JOB_MS ?? 6000);
const pipelineControl = { failNext: 0 };

class ProjectState {
  constructor({ id, name, namespace, topics, defaultBranch, initializeWithReadme, webBase, description }) {
    this.id = id;
    this.description = description ?? '';
    this.name = name;
    this.path = slugify(name);
    this.namespace = namespace;
    this.path_with_namespace = namespace.full_path ? `${namespace.full_path}/${this.path}` : this.path;
    this.topics = topics ?? [];
    this.default_branch = defaultBranch ?? 'main';
    this.archived = false;
    this.marked_for_deletion_at = null;
    this.web_url = `${webBase}/${this.path_with_namespace}`;
    this.members = [];
    this.hooks = [];
    this.nextHookId = 1;
    this.nextMrIid = 1;
    this.mergeRequests = new Map();
    this.issues = new Map();
    this.nextIssueIid = 1;
    this.milestones = [];
    this.labels = [];
    this.tags = new Map();
    this.releases = new Map();
    this.pipelines = [];
    this.nextPipelineId = 1;
    // the annotation of the tags that were given one
    this.tagMessages = new Map();
    this.commits = new Map();
    this.branches = new Map();

    const initialTree = new Map();
    if (initializeWithReadme) initialTree.set('README.md', Buffer.from(`# ${name}\n`, 'utf8'));
    const initialCommit = this.#newCommit({ tree: initialTree, parent: null, message: 'Initial commit' });
    this.branches.set(this.default_branch, initialCommit.id);
  }

  #newCommit({ tree, parent, message }) {
    const seq = this.commits.size + 1;
    const id = sha1For(`${this.id}|${seq}|${message}`);
    const commit = {
      id,
      short_id: shortId(id),
      title: message.split(/\r?\n/)[0],
      message,
      parent_ids: parent ? [parent] : [],
      created_at: new Date().toISOString(),
      author_name: 'gitlab-double',
      web_url: `${this.web_url}/-/commit/${id}`,
      tree,
    };
    this.commits.set(id, commit);
    return commit;
  }

  headSha(branch) {
    return this.branches.get(branch);
  }

  resolveRef(ref) {
    if (this.branches.has(ref)) return this.branches.get(ref);
    if (this.tags.has(ref)) return this.tags.get(ref);
    if (this.commits.has(ref)) return ref;
    return null;
  }

  treeAt(ref) {
    const sha = this.resolveRef(ref);
    if (!sha) return null;
    return this.commits.get(sha).tree;
  }

  commit({ branch, actions, message, expectedLastCommitId }) {
    const headSha = this.branches.get(branch);
    if (!headSha) throw { status: 404, body: CLIENT_ERROR_JSON(`404 Branch Not Found`) };

    if (expectedLastCommitId !== undefined && expectedLastCommitId !== null && expectedLastCommitId !== headSha) {
      throw {
        status: 400,
        body: CLIENT_ERROR_JSON(
          `last_commit_id (${expectedLastCommitId}) is not HEAD of ${branch} (${headSha}) — someone else committed first`
        ),
      };
    }

    const baseTree = this.commits.get(headSha).tree;
    const newTree = new Map(baseTree);

    for (const action of actions ?? []) {
      const filePath = action.file_path;
      const exists = newTree.has(filePath);

      if (
        ['update', 'move', 'delete'].includes(action.action) &&
        action.last_commit_id !== undefined && action.last_commit_id !== null &&
        action.last_commit_id !== headSha
      ) {
        throw {
          status: 400,
          body: CLIENT_ERROR_JSON(
            `last_commit_id (${action.last_commit_id}) is not HEAD of ${branch} (${headSha}) for ${filePath} — someone else committed first`
          ),
        };
      }

      if (action.action === 'create') {
        if (exists) throw { status: 400, body: CLIENT_ERROR_JSON(`A file with this name already exists (${filePath})`) };
        newTree.set(filePath, decodeActionContent(action));
      } else if (action.action === 'update') {
        if (!exists) throw { status: 400, body: CLIENT_ERROR_JSON(`A file with this name doesn't exist (${filePath})`) };
        newTree.set(filePath, decodeActionContent(action));
      } else if (action.action === 'delete') {
        if (!exists) throw { status: 400, body: CLIENT_ERROR_JSON(`A file with this name doesn't exist (${filePath})`) };
        newTree.delete(filePath);
      } else if (action.action === 'move') {
        if (!exists) throw { status: 400, body: CLIENT_ERROR_JSON(`A file with this name doesn't exist (${filePath})`) };
        const content = action.content !== undefined ? decodeActionContent(action) : newTree.get(filePath);
        newTree.delete(filePath);
        newTree.set(action.previous_path ? filePath : action.file_path, content);
      } else {
        throw { status: 400, body: CLIENT_ERROR_JSON(`Unknown action "${action.action}"`) };
      }
    }

    const commit = this.#newCommit({ tree: newTree, parent: headSha, message });
    this.branches.set(branch, commit.id);
    this.#startPipeline({ ref: branch, sha: commit.id });
    return commit;
  }

  // a pipeline per commit: build, test and deploy, one after the other, JOB_MS each; the clock is the wall clock
  #startPipeline({ ref, sha }) {
    const failing = pipelineControl.failNext > 0 || /fail/i.test(this.name);
    if (pipelineControl.failNext > 0) pipelineControl.failNext--;
    this.pipelines.push({ id: this.nextPipelineId++, ref, sha, createdAt: Date.now(), attemptAt: Date.now(), willFail: failing });
  }

  retryPipeline(id) {
    const pipeline = this.pipelines.find((p) => p.id === Number(id));
    if (!pipeline) return null;
    pipeline.attemptAt = Date.now();
    pipeline.willFail = false;
    return pipeline;
  }

  cancelPipeline(id) {
    const pipeline = this.pipelines.find((p) => p.id === Number(id));
    if (!pipeline) return null;
    pipeline.canceledAt ??= Date.now();
    return pipeline;
  }

  pipelineView(pipeline, now = Date.now()) {
    const jobs = PIPELINE_STAGES.map((stage, index) => {
      const start = pipeline.attemptAt + index * JOB_MS;
      const end = start + JOB_MS;
      const failsHere = pipeline.willFail && stage === 'test';
      const earlierFailed = pipeline.willFail && index > PIPELINE_STAGES.indexOf('test') && now >= pipeline.attemptAt + (PIPELINE_STAGES.indexOf('test') + 1) * JOB_MS;
      let status = 'created';
      if (pipeline.canceledAt && !(now >= end && end <= pipeline.canceledAt)) status = 'canceled';
      else if (earlierFailed) status = 'skipped';
      else if (now >= end) status = failsHere ? 'failed' : 'success';
      else if (now >= start) status = 'running';
      return {
        id: pipeline.id * 100 + index,
        name: stage,
        stage,
        status,
        duration: status === 'created' || status === 'skipped' ? null : Math.max(1, Math.round((Math.min(now, end) - start) / 1000)),
        web_url: `${this.web_url}/-/jobs/${pipeline.id * 100 + index}`,
      };
    });
    const status = jobs.some((j) => j.status === 'canceled') ? 'canceled'
      : jobs.some((j) => j.status === 'failed') ? 'failed'
      : jobs.every((j) => j.status === 'success') ? 'success'
      : jobs.some((j) => j.status === 'running') ? 'running' : 'pending';
    return {
      id: pipeline.id, status, ref: pipeline.ref, sha: pipeline.sha,
      created_at: new Date(pipeline.createdAt).toISOString(),
      web_url: `${this.web_url}/-/pipelines/${pipeline.id}`,
      jobs,
    };
  }

  /** Every commit reachable from `sha` (itself included). */
  ancestorsOf(sha) { return this.#ancestorsOf(sha); }
  #ancestorsOf(sha) {
    const seen = new Set();
    const queue = [sha];
    while (queue.length) {
      const next = queue.shift();
      if (!next || seen.has(next)) continue;
      seen.add(next);
      queue.push(...(this.commits.get(next)?.parent_ids ?? []));
    }
    return seen;
  }

  /**
   * Merges the commit `sourceSha` into `targetBranch` the way a merge does: what the source changed since the two last had a
   * commit in common is applied to the target, and what only the target has stays. (A change both made goes to the source's side:
   * there are no conflicts here.)
   */
  mergeInto(targetBranch, sourceSha, message, { squash = false } = {}) {
    const targetSha = this.branches.get(targetBranch);
    const inTarget = this.#ancestorsOf(targetSha);
    if (inTarget.has(sourceSha)) return this.commits.get(targetSha); // nothing new in the source
    // the nearest commit of the source's history that is also in the target's
    let base = null;
    const queue = [sourceSha];
    const seen = new Set();
    while (queue.length) {
      const next = queue.shift();
      if (seen.has(next)) continue;
      seen.add(next);
      if (inTarget.has(next)) { base = next; break; }
      queue.push(...(this.commits.get(next)?.parent_ids ?? []));
    }
    const baseTree = base ? this.commits.get(base).tree : new Map();
    const sourceTree = this.commits.get(sourceSha).tree;
    const tree = new Map(this.commits.get(targetSha).tree);
    for (const [filePath, content] of sourceTree) {
      if (!baseTree.has(filePath) || !baseTree.get(filePath).equals(content)) tree.set(filePath, content);
    }
    for (const filePath of baseTree.keys()) if (!sourceTree.has(filePath)) tree.delete(filePath);
    const commit = this.#newCommit({ tree, parent: targetSha, message: message ?? `Merge ${sourceSha.slice(0, 8)} into ${targetBranch}` });
    // a squash leaves one commit whose only parent is the target
    if (!squash) commit.parent_ids.push(sourceSha);
    this.branches.set(targetBranch, commit.id);
    return commit;
  }

  /** The files the source brought since it left the target: each as GitLab's `changes` has it. */
  changesOf(targetBranch, sourceSha) {
    const targetSha = this.branches.get(targetBranch);
    const inTarget = this.#ancestorsOf(targetSha);
    let base = null;
    const queue = [sourceSha];
    const seen = new Set();
    while (queue.length) {
      const next = queue.shift();
      if (seen.has(next)) continue;
      seen.add(next);
      if (inTarget.has(next)) { base = next; break; }
      queue.push(...(this.commits.get(next)?.parent_ids ?? []));
    }
    const baseTree = base ? this.commits.get(base).tree : new Map();
    const sourceTree = this.commits.get(sourceSha).tree;
    const out = [];
    for (const filePath of [...new Set([...baseTree.keys(), ...sourceTree.keys()])].sort()) {
      const [before, after] = [baseTree.get(filePath), sourceTree.get(filePath)];
      if (before && after && before.equals(after)) continue;
      out.push({
        old_path: filePath, new_path: filePath, new_file: !before, deleted_file: !after, renamed_file: false,
        diff: unifiedDiff(before?.toString('utf8') ?? '', after?.toString('utf8') ?? ''),
      });
    }
    return out;
  }

  /** Whether merging `sourceSha` into `targetBranch` has a conflict: a file both sides changed since their common commit, differently. */
  conflictsWith(targetBranch, sourceSha) {
    const targetSha = this.branches.get(targetBranch);
    if (!targetSha || !sourceSha) return false;
    const inTarget = this.#ancestorsOf(targetSha);
    if (inTarget.has(sourceSha)) return false;
    let base = null;
    const queue = [sourceSha];
    const seen = new Set();
    while (queue.length) {
      const next = queue.shift();
      if (seen.has(next)) continue;
      seen.add(next);
      if (inTarget.has(next)) { base = next; break; }
      queue.push(...(this.commits.get(next)?.parent_ids ?? []));
    }
    const baseTree = base ? this.commits.get(base).tree : new Map();
    const sourceTree = this.commits.get(sourceSha).tree;
    const targetTree = this.commits.get(targetSha).tree;
    const changed = (tree, filePath) => {
      const before = baseTree.get(filePath);
      const after = tree.get(filePath);
      return !(before === undefined ? after === undefined : after !== undefined && before.equals(after));
    };
    for (const filePath of new Set([...sourceTree.keys(), ...targetTree.keys()])) {
      if (!changed(sourceTree, filePath) || !changed(targetTree, filePath)) continue;
      const [a, b] = [sourceTree.get(filePath), targetTree.get(filePath)];
      if (!(a !== undefined && b !== undefined && a.equals(b)) && !(a === undefined && b === undefined)) return true;
    }
    return false;
  }

  createBranch(name, ref) {
    if (this.branches.has(name)) {
      throw { status: 400, body: CLIENT_ERROR_JSON(`Branch already exists`) };
    }
    const sha = this.resolveRef(ref);
    if (!sha) throw { status: 404, body: CLIENT_ERROR_JSON(`404 Ref Not Found`) };
    this.branches.set(name, sha);
    return { name, commit: this.commits.get(sha) };
  }
}

const decodeActionContent = (action) => {
  if (action.encoding === 'base64') return Buffer.from(action.content ?? '', 'base64');
  return Buffer.from(action.content ?? '', 'utf8');
};

class GitLabDoubleState {
  constructor(webBase) {
    this.webBase = webBase;
    this.groups = new Map();
    this.projects = new Map();
    this.nextGroupId = 1;
    this.nextProjectId = 1;
    this.requestLog = [];
    this.graphqlAnswer = null;
  }

  createGroup({ name, path, parent_id }) {
    const id = this.nextGroupId++;
    const parent = parent_id ? this.groups.get(parent_id) : null;
    const groupPath = path || slugify(name);
    const full_path = parent ? `${parent.full_path}/${groupPath}` : groupPath;
    const group = {
      id, name, path: groupPath, full_path,
      parent_id: parent_id ?? null,
      web_url: `${this.webBase}/${full_path}`,
      members: [],
    };
    this.groups.set(id, group);
    return group;
  }

  createProject({ name, namespace_id, topics, default_branch, initialize_with_readme, description }) {
    const namespaceGroup = namespace_id === undefined || namespace_id === null
      ? ([...this.groups.values()].find((g) => g.path === 'root') ?? this.createGroup({ name: 'root' }))
      : this.groups.get(namespace_id);
    if (!namespaceGroup) throw { status: 404, body: CLIENT_ERROR_JSON('404 Group Not Found') };
    const id = this.nextProjectId++;
    const project = new ProjectState({
      id, name,
      namespace: { id: namespaceGroup.id, full_path: namespaceGroup.full_path, parent_id: namespaceGroup.parent_id },
      topics, defaultBranch: default_branch, initializeWithReadme: initialize_with_readme,
      webBase: this.webBase, description,
    });
    this.projects.set(id, project);
    return project;
  }

  reset() {
    this.groups.clear();
    this.projects.clear();
    this.nextGroupId = 1;
    this.nextProjectId = 1;
    this.requestLog = [];
    this.graphqlAnswer = null;
  }
}

const projectJson = (p) => ({
  id: p.id,
  name: p.name,
  path: p.path,
  path_with_namespace: p.path_with_namespace,
  namespace: { id: p.namespace.id, full_path: p.namespace.full_path, parent_id: p.namespace.parent_id ?? null },
  topics: p.topics,
  tag_list: p.topics,
  shared_runners_enabled: p.shared_runners_enabled ?? true,
  builds_access_level: p.builds_access_level ?? 'enabled',
  default_branch: p.default_branch,
  archived: p.archived,
  marked_for_deletion_at: p.marked_for_deletion_at,
  ...(p.marked_for_deletion_on ? { marked_for_deletion_on: p.marked_for_deletion_on } : {}),
  ...(p.created_at ? { created_at: p.created_at } : {}),
  web_url: p.web_url,
  description: p.description ?? '',
});

const mrJson = (project, mr) => ({
  id: mr.iid,
  iid: mr.iid,
  project_id: project.id,
  title: mr.title,
  source_branch: mr.source_branch,
  target_branch: mr.target_branch,
  state: mr.state,
  merge_status: mr.state === 'merged' ? 'merged' : 'can_be_merged',
  detailed_merge_status: mr.detailed_merge_status,
  has_conflicts: mr.state === 'opened' && project.conflictsWith(mr.target_branch, project.branches.get(mr.source_branch) ?? mr.sha),
  web_url: `${project.web_url}/-/merge_requests/${mr.iid}`,
  sha: mr.sha,
  description: mr.description ?? '',
  author: { id: 1, username: mr.author ?? 'dev', name: mr.author ?? 'dev' },
  labels: mr.labels ?? [],
  reviewers: (mr.reviewers ?? []).map((username) => ({ username })),
  assignees: [],
  created_at: mr.created_at ?? new Date(0).toISOString(),
  updated_at: mr.updated_at ?? mr.created_at ?? new Date(0).toISOString(),
  merged_at: mr.merged_at ?? null,
  user_notes_count: (mr.discussions ?? []).reduce((sum, d) => sum + d.notes.filter((n) => !n.system).length, 0),
  diff_refs: { base_sha: mr.sha, start_sha: mr.sha, head_sha: mr.sha },
});

const fileJson = (project, branchOrRef, filePath, sha, content) => ({
  file_name: filePath.split('/').pop(),
  file_path: filePath,
  size: content.length,
  encoding: 'base64',
  content_sha256: sha1For(content),
  ref: branchOrRef,
  blob_id: sha1For(`${filePath}@${sha}`),
  commit_id: sha,
  last_commit_id: sha,
  content: content.toString('base64'),
});

/** How git over HTTP (git-http.js) reads and writes a project's commits, branches and tags. */
const gitlabAdapter = (project) => ({
  defaultBranch: () => project.default_branch,
  commits: () => [...project.commits.values()].map((c) => ({
    id: c.id, parents: c.parent_ids, message: c.message, date: c.created_at, authorName: c.author_name, authorEmail: 'gitlab-double@example.com', files: c.tree,
  })),
  heads: () => new Map(project.branches),
  tags: () => new Map(project.tags),
  addCommit: ({ id, parents, message, date, authorName, files }) => {
    project.commits.set(id, {
      id, short_id: shortId(id), title: message.split(/\r?\n/)[0], message, parent_ids: parents, created_at: date,
      author_name: authorName, web_url: `${project.web_url}/-/commit/${id}`, tree: files,
    });
    return id;
  },
  setHead: (name, id) => (id ? project.branches.set(name, id) : project.branches.delete(name)),
  setTag: (name, id) => (id ? project.tags.set(name, id) : project.tags.delete(name)),
});

export function createGitlabDoubleApp(webBase = 'http://gitlab-double.local') {
  const state = new GitLabDoubleState(webBase);
  const app = express();
  // `git clone/push` against `<web url>/<group>/<project>.git`: served before anything reads a body
  const gitHttp = createGitHttp({
    find: (fullPath) => [...state.projects.values()].find((p) => p.path_with_namespace === fullPath),
    adapterOf: gitlabAdapter,
  });
  app.use(gitHttp.router);
  app.use(express.json({ limit: '20mb' }));

  app.use((req, res, next) => {
    state.requestLog.push({
      method: req.method,
      path: req.originalUrl.replace(/^\/api\/v4\//, ''),
      body: req.body && Object.keys(req.body).length > 0 ? req.body : undefined,
    });
    next();
  });

  const router = express.Router();

  const sendError = (res, status, message) => res.status(status).json(CLIENT_ERROR_JSON(message));
  const projectOr404 = (req, res) => {
    const key = String(req.params.id);
    // GitLab takes either the numeric id or the URL-encoded `path_with_namespace`
    const project = /^\d+$/.test(key)
      ? state.projects.get(Number(key))
      : [...state.projects.values()].find((p) => p.path_with_namespace === key);
    if (!project) { sendError(res, 404, '404 Project Not Found'); return null; }
    return project;
  };
  const groupOr404 = (req, res) => {
    const key = String(req.params.id);
    // by numeric id, or by (URL-decoded) full path, as GitLab takes either
    const group = /^\d+$/.test(key) ? state.groups.get(Number(key)) : [...state.groups.values()].find((g) => g.full_path === key);
    if (!group) { sendError(res, 404, '404 Group Not Found'); return null; }
    return group;
  };

  router.post('/groups', (req, res) => {
    const group = state.createGroup(req.body ?? {});
    res.status(201).json(group);
  });
  router.get('/groups/:id', (req, res) => {
    const group = groupOr404(req, res);
    if (group) res.status(200).json(group);
  });
  router.put('/groups/:id', (req, res) => {
    const group = groupOr404(req, res);
    if (!group) return;
    if (req.body?.name !== undefined) group.name = req.body.name;
    res.status(200).json(group);
  });
  router.delete('/groups/:id', (req, res) => {
    const group = groupOr404(req, res);
    if (!group) return;
    // a group goes with its subgroups, and everything in them
    const doomed = new Set([group.id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const other of state.groups.values()) {
        if (!doomed.has(other.id) && doomed.has(other.parent_id)) { doomed.add(other.id); grew = true; }
      }
    }
    for (const id of doomed) state.groups.delete(id);
    for (const [id, project] of state.projects) {
      if (doomed.has(project.namespace.id)) state.projects.delete(id);
    }
    res.status(202).json({ message: '202 Accepted' });
  });
  // who the token is: the one user of the double (the token is not looked at)
  router.get('/user', (_req, res) => res.json({ id: 1, username: 'dev', name: 'Dev User', avatar_url: '' }));

  router.get('/groups', (req, res) => {
    const minAccessLevel = Number(req.query.min_access_level ?? 0);
    const perPage = Number(req.query.per_page ?? 20);
    const page = Number(req.query.page ?? 1);
    void minAccessLevel;
    const all = [...state.groups.values()];
    const start = (page - 1) * perPage;
    res.status(200).json(all.slice(start, start + perPage));
  });
  router.get('/groups/:id/members/all', (req, res) => {
    const group = groupOr404(req, res);
    if (group) res.status(200).json(group.members);
  });

  router.post('/projects', (req, res) => {
    try {
      const project = state.createProject(req.body ?? {});
      res.status(201).json(projectJson(project));
    } catch (err) {
      res.status(err.status ?? 400).json(err.body ?? CLIENT_ERROR_JSON('create project failed'));
    }
  });
  router.get('/projects/:id', (req, res) => {
    const project = projectOr404(req, res);
    if (project) res.status(200).json(projectJson(project));
  });
  router.put('/projects/:id', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    if (req.body?.name !== undefined) project.name = req.body.name;
    if (req.body?.default_branch !== undefined) project.default_branch = req.body.default_branch;
    if (Array.isArray(req.body?.topics)) { project.topics = [...req.body.topics]; project.tag_list = project.topics; }
    if (req.body?.shared_runners_enabled !== undefined) project.shared_runners_enabled = Boolean(req.body.shared_runners_enabled);
    if (req.body?.builds_access_level !== undefined) project.builds_access_level = req.body.builds_access_level;
    res.status(200).json(projectJson(project));
  });
  router.delete('/projects/:id', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    state.projects.delete(project.id);
    res.status(202).json({ message: 'Accepted' });
  });
  router.get('/projects/:id/members/all', (req, res) => {
    const project = projectOr404(req, res);
    if (project) res.status(200).json(project.members.map(({ inherited, ...member }) => member));
  });
  // the members set on the project itself (a member with `inherited: true` comes from its group: only `/members/all` lists it)
  router.get('/projects/:id/members', (req, res) => {
    const project = projectOr404(req, res);
    if (project) res.status(200).json(project.members.filter((member) => !member.inherited).map(({ inherited, ...member }) => member));
  });
  router.post('/projects/:id/members', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const username = usernameOf(Number(req.body?.user_id));
    if (project.members.some((member) => member.id === Number(req.body?.user_id) && !member.inherited)) return sendError(res, 409, 'Member already exists');
    project.members = project.members.filter((member) => member.id !== Number(req.body?.user_id));
    const member = { id: Number(req.body.user_id), username, access_level: Number(req.body.access_level) };
    project.members.push(member);
    res.status(201).json(member);
  });
  router.put('/projects/:id/members/:userId', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const member = project.members.find((candidate) => candidate.id === Number(req.params.userId) && !candidate.inherited);
    if (!member) return sendError(res, 404, '404 Not found');
    member.access_level = Number(req.body.access_level);
    res.status(200).json(member);
  });
  router.delete('/projects/:id/members/:userId', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const at = project.members.findIndex((candidate) => candidate.id === Number(req.params.userId) && !candidate.inherited);
    if (at < 0) return sendError(res, 404, '404 Not found');
    project.members.splice(at, 1);
    res.status(204).end();
  });
  router.get('/projects', (req, res) => {
    const perPageRaw = req.query.per_page;
    const perPage = perPageRaw !== undefined ? Number(perPageRaw) : null;
    const page = Number(req.query.page ?? 1);
    let results = [...state.projects.values()];

    if (req.query.topics) {
      const wanted = String(req.query.topics).split(',').map((t) => t.trim()).filter(Boolean);
      results = results.filter((p) => wanted.every((t) => p.topics.includes(t)));
    }
    if (req.query.topic) {
      results = results.filter((p) => p.topics.includes(String(req.query.topic)));
    }
    results = results.filter((p) => !p.archived);

    if (perPage === null) {
      res.status(200).json(results.map(projectJson));
      return;
    }
    const start = (page - 1) * perPage;
    res.status(200).json(results.slice(start, start + perPage).map(projectJson));
  });

  router.get('/projects/:id/repository/files/:path', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const filePath = decodeURIComponent(req.params.path);
    const ref = req.query.ref ?? project.default_branch;
    const sha = project.resolveRef(ref);
    if (!sha) return sendError(res, 404, '404 Commit Not Found');
    const tree = project.commits.get(sha).tree;
    if (!tree.has(filePath)) return sendError(res, 404, '404 File Not Found');
    res.status(200).json(fileJson(project, ref, filePath, sha, tree.get(filePath)));
  });
  router.get('/projects/:id/repository/files/:path/raw', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const filePath = decodeURIComponent(req.params.path);
    const sha = project.resolveRef(req.query.ref ?? project.default_branch) ?? project.tags.get(String(req.query.ref));
    if (!sha) return sendError(res, 404, '404 Commit Not Found');
    const tree = project.commits.get(sha).tree;
    if (!tree.has(filePath)) return sendError(res, 404, '404 File Not Found');
    res.status(200).set('Content-Type', 'application/octet-stream').send(tree.get(filePath));
  });
  router.post('/projects/:id/repository/files/:path', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const filePath = decodeURIComponent(req.params.path);
    const { branch, content, commit_message, encoding } = req.body ?? {};
    try {
      const commit = project.commit({
        branch,
        actions: [{ action: 'create', file_path: filePath, content, encoding }],
        message: commit_message ?? `Added ${filePath}`,
      });
      res.status(201).json({ file_path: filePath, branch, ...fileJson(project, branch, filePath, commit.id, project.commits.get(commit.id).tree.get(filePath)) });
    } catch (err) {
      res.status(err.status ?? 400).json(err.body ?? CLIENT_ERROR_JSON('create file failed'));
    }
  });
  router.put('/projects/:id/repository/files/:path', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const filePath = decodeURIComponent(req.params.path);
    const { branch, content, commit_message, encoding, last_commit_id } = req.body ?? {};
    try {
      const commit = project.commit({
        branch,
        actions: [{ action: 'update', file_path: filePath, content, encoding }],
        message: commit_message ?? `Updated ${filePath}`,
        expectedLastCommitId: last_commit_id,
      });
      res.status(200).json({ file_path: filePath, branch, ...fileJson(project, branch, filePath, commit.id, project.commits.get(commit.id).tree.get(filePath)) });
    } catch (err) {
      res.status(err.status ?? 400).json(err.body ?? CLIENT_ERROR_JSON('update file failed'));
    }
  });

  router.post('/projects/:id/repository/commits', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const { branch, commit_message, actions, last_commit_id } = req.body ?? {};
    try {
      const commit = project.commit({ branch, actions, message: commit_message, expectedLastCommitId: last_commit_id });
      res.status(201).json({
        id: commit.id, short_id: commit.short_id, title: commit.title, message: commit.message,
        created_at: commit.created_at, web_url: commit.web_url, parent_ids: commit.parent_ids,
      });
    } catch (err) {
      res.status(err.status ?? 400).json(err.body ?? CLIENT_ERROR_JSON('commit failed'));
    }
  });
  router.get('/projects/:id/repository/commits', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const refName = req.query.ref_name ?? project.default_branch;
    const perPage = Number(req.query.per_page ?? 20);
    let sha = project.resolveRef(refName);
    const out = [];
    while (sha && out.length < perPage) {
      const commit = project.commits.get(sha);
      out.push(commit);
      sha = commit.parent_ids[0] ?? null;
    }
    res.status(200).json(out.map((c) => ({
      id: c.id, short_id: c.short_id, title: c.title, message: c.message,
      author_name: c.author_name, created_at: c.created_at, web_url: c.web_url,
    })));
  });
  router.get('/projects/:id/repository/compare', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const [from, to] = [project.resolveRef(req.query.from), project.resolveRef(req.query.to)];
    if (!from || !to) return sendError(res, 404, '404 Ref Not Found');
    const inFrom = project.ancestorsOf(from);
    const commits = [];
    for (let sha = to; sha && !inFrom.has(sha); sha = project.commits.get(sha).parent_ids[0] ?? null) commits.unshift(project.commits.get(sha));
    const branch = [...project.branches.entries()].find(([, tip]) => tip === from)?.[0];
    res.status(200).json({
      commits: commits.map((c) => ({ id: c.id, short_id: c.short_id, title: c.title, message: c.message, author_name: c.author_name, created_at: c.created_at, web_url: c.web_url })),
      diffs: branch ? project.changesOf(branch, to) : [],
    });
  });
  router.post('/projects/:id/repository/commits/:sha/revert', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const target = project.commits.get(req.params.sha);
    if (!target) return sendError(res, 404, '404 Commit Not Found');
    const { branch, dry_run } = req.body ?? {};
    if (dry_run) {
      res.status(200).json({ dry_run: 'success' });
      return;
    }
    const parentSha = target.parent_ids[0] ?? null;
    const parentTree = parentSha ? project.commits.get(parentSha).tree : new Map();
    const headSha = project.branches.get(branch);
    if (!headSha) return sendError(res, 404, '404 Branch Not Found');
    const headTree = project.commits.get(headSha).tree;
    const revertedTree = new Map(headTree);
    for (const [path, content] of target.tree) {
      if (parentTree.has(path)) revertedTree.set(path, parentTree.get(path));
      else revertedTree.delete(path);
    }
    for (const path of parentTree.keys()) {
      if (!target.tree.has(path) && !revertedTree.has(path)) revertedTree.set(path, parentTree.get(path));
    }
    const seq = project.commits.size + 1;
    const id = sha1For(`${project.id}|revert|${seq}`);
    const revertCommit = {
      id, short_id: shortId(id), title: `Revert "${target.title}"`, message: `Revert "${target.title}"`,
      parent_ids: [headSha], created_at: new Date().toISOString(), author_name: 'gitlab-double',
      web_url: `${project.web_url}/-/commit/${id}`, tree: revertedTree,
    };
    project.commits.set(id, revertCommit);
    project.branches.set(branch, id);
    res.status(200).json({ id, short_id: shortId(id) });
  });

  router.get('/projects/:id/repository/tree', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const ref = req.query.ref || project.default_branch;
    const tree = project.treeAt(ref);
    if (!tree) return sendError(res, 404, '404 Tree Not Found');
    const prefix = req.query.path ? `${req.query.path}/` : '';
    const perPage = Number(req.query.per_page ?? 100);
    const page = Number(req.query.page ?? 1);
    const entries = [...tree.keys()]
      .filter((p) => p.startsWith(prefix))
      .sort()
      .slice((page - 1) * perPage, page * perPage)
      .map((p) => ({
        id: sha1For(`${project.id}:${p}`),
        name: p.split('/').pop(),
        type: 'blob',
        path: p,
        mode: '100644',
      }));
    res.status(200).json(entries);
  });

  router.get('/projects/:id/repository/archive.zip', async (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const ref = req.query.sha || project.default_branch;
    const tree = project.treeAt(ref);
    if (!tree) return sendError(res, 404, '404 Tree Not Found');
    const sha = project.resolveRef(ref);
    const rootFolder = `${project.path}-${shortId(sha)}`;
    const zip = new JSZip();
    for (const [filePath, content] of tree) {
      zip.file(`${rootFolder}/${filePath}`, content);
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    res.status(200).set('Content-Type', 'application/zip').send(buffer);
  });

  router.get('/projects/:id/repository/branches', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    res.json([...project.branches.keys()].map((name) => ({ name })));
  });
  router.post('/projects/:id/repository/branches', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const { branch, ref } = req.body ?? {};
    try {
      const created = project.createBranch(branch, ref);
      res.status(201).json({
        name: created.name,
        commit: { id: created.commit.id, short_id: created.commit.short_id },
        default: false, protected: false, merged: false,
        web_url: `${project.web_url}/-/tree/${created.name}`,
      });
    } catch (err) {
      res.status(err.status ?? 400).json(err.body ?? CLIENT_ERROR_JSON('create branch failed'));
    }
  });
  router.delete('/projects/:id/repository/branches/:name', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    if (!project.branches.has(req.params.name)) return sendError(res, 404, '404 Branch Not Found');
    project.branches.delete(req.params.name);
    res.status(204).send();
  });
  router.get('/projects/:id/repository/branches/:name', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const sha = project.branches.get(req.params.name);
    if (!sha) return sendError(res, 404, '404 Branch Not Found');
    const commit = project.commits.get(sha);
    res.status(200).json({
      name: req.params.name, commit: { id: commit.id, short_id: commit.short_id, title: commit.title },
      default: req.params.name === project.default_branch, protected: false, merged: false,
      web_url: `${project.web_url}/-/tree/${req.params.name}`,
    });
  });
  router.get('/projects/:id/repository/branches', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const search = req.query.search ? String(req.query.search) : null;
    const perPage = Number(req.query.per_page ?? 30);
    let names = [...project.branches.keys()];
    if (search) names = names.filter((n) => n.includes(search));
    res.status(200).json(names.slice(0, perPage).map((name) => {
      const commit = project.commits.get(project.branches.get(name));
      return {
        name, commit: { id: commit.id, short_id: commit.short_id },
        default: name === project.default_branch, protected: false, merged: false,
        web_url: `${project.web_url}/-/tree/${name}`,
      };
    }));
  });

  router.get('/projects/:id/repository/compare', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const fromSha = project.resolveRef(req.query.from);
    const toSha = project.resolveRef(req.query.to);
    if (!fromSha || !toSha) return sendError(res, 404, '404 Ref Not Found');
    const commits = [];
    let sha = toSha;
    while (sha && sha !== fromSha && commits.length < 200) {
      const commit = project.commits.get(sha);
      commits.push(commit);
      sha = commit.parent_ids[0] ?? null;
    }
    res.status(200).json({
      commits: commits.reverse().map((c) => ({
        id: c.id, short_id: c.short_id, title: c.title, author_name: c.author_name, created_at: c.created_at,
      })),
      diffs: [],
      compare_same_ref: fromSha === toSha,
    });
  });

  const createMr = (project, { title, source_branch, target_branch }, extra = {}) => {
    if (!project.branches.has(source_branch)) throw { status: 400, body: CLIENT_ERROR_JSON('source branch does not exist') };
    if (!project.branches.has(target_branch)) throw { status: 400, body: CLIENT_ERROR_JSON('target branch does not exist') };
    const iid = project.nextMrIid++;
    const now = new Date().toISOString();
    const mr = {
      iid, title, source_branch, target_branch,
      state: 'opened', detailed_merge_status: 'mergeable',
      sha: project.branches.get(source_branch),
      description: extra.description ?? '', author: 'dev', labels: extra.labels ?? [], reviewers: extra.reviewers ?? [],
      created_at: now, updated_at: now, merged_at: null, discussions: [], nextDiscussion: 1, nextNote: 1, approvedBy: [],
    };
    project.mergeRequests.set(iid, mr);
    return mr;
  };

  router.post('/projects/:id/merge_requests', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const { title, source_branch, target_branch, description, labels, reviewer_ids } = req.body ?? {};
    const existing = [...project.mergeRequests.values()].find(
      (m) => m.state === 'opened' && m.source_branch === source_branch && m.target_branch === target_branch
    );
    if (existing) return sendError(res, 409, 'Another open merge request already exists for this source branch');
    try {
      const mr = createMr(project, { title, source_branch, target_branch }, {
        description, labels: labels ? String(labels).split(',').filter(Boolean) : [], reviewers: (reviewer_ids ?? []).map((id) => usernameOf(id)),
      });
      res.status(201).json(mrJson(project, mr));
    } catch (err) {
      res.status(err.status ?? 400).json(err.body ?? CLIENT_ERROR_JSON('create MR failed'));
    }
  });
  router.get('/projects/:id/merge_requests/:iid', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const mr = project.mergeRequests.get(Number(req.params.iid));
    if (!mr) return sendError(res, 404, '404 Merge Request Not Found');
    res.status(200).json(mrJson(project, mr));
  });
  router.get('/projects/:id/merge_requests', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const { state, target_branch, source_branch, author_username, reviewer_username, labels, search, per_page, page } = req.query;
    let mrs = [...project.mergeRequests.values()].sort((a, b) => b.iid - a.iid);
    if (state && state !== 'all') mrs = mrs.filter((m) => m.state === state);
    if (target_branch) mrs = mrs.filter((m) => m.target_branch === target_branch);
    if (source_branch) mrs = mrs.filter((m) => m.source_branch === source_branch);
    if (author_username) mrs = mrs.filter((m) => (m.author ?? 'dev') === author_username);
    if (reviewer_username) mrs = mrs.filter((m) => (m.reviewers ?? []).includes(reviewer_username));
    if (labels) mrs = mrs.filter((m) => String(labels).split(',').every((l) => (m.labels ?? []).includes(l)));
    if (search) mrs = mrs.filter((m) => `${m.title} ${m.description ?? ''}`.toLowerCase().includes(String(search).toLowerCase()));
    if (per_page) mrs = mrs.slice((Number(page ?? 1) - 1) * Number(per_page), Number(page ?? 1) * Number(per_page));
    res.status(200).json(mrs.map((m) => mrJson(project, m)));
  });
  router.put('/projects/:id/merge_requests/:iid', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const mr = project.mergeRequests.get(Number(req.params.iid));
    if (!mr) return sendError(res, 404, '404 Merge Request Not Found');
    const body = req.body ?? {};
    if (req.query.title !== undefined) mr.title = req.query.title;
    if (body.title !== undefined) mr.title = body.title;
    if (body.description !== undefined) mr.description = body.description;
    if (body.labels !== undefined) mr.labels = String(body.labels).split(',').filter(Boolean);
    if (body.reviewer_ids !== undefined) mr.reviewers = body.reviewer_ids.map((id) => usernameOf(id));
    if (req.query.state_event === 'close' || body.state_event === 'close') mr.state = 'closed';
    if (req.query.state_event === 'reopen' || body.state_event === 'reopen') mr.state = 'opened';
    mr.updated_at = new Date().toISOString();
    res.status(200).json(mrJson(project, mr));
  });
  router.put('/projects/:id/merge_requests/:iid/merge', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const mr = project.mergeRequests.get(Number(req.params.iid));
    if (!mr) return sendError(res, 404, '404 Merge Request Not Found');
    if (mr.state !== 'opened') {
      res.status(406).json(CLIENT_ERROR_JSON('Branch cannot be merged'));
      return;
    }
    const sourceSha = project.branches.get(mr.source_branch) ?? mr.sha;
    if (project.conflictsWith(mr.target_branch, sourceSha)) {
      mr.detailed_merge_status = 'conflict';
      res.status(405).json(CLIENT_ERROR_JSON('Branch cannot be merged: conflicts'));
      return;
    }
    const squash = String(req.body?.squash ?? req.query.squash) === 'true';
    project.mergeInto(mr.target_branch, sourceSha, req.body?.squash_commit_message ?? req.body?.merge_commit_message ?? (squash ? `${mr.title} (!${mr.iid})` : `Merge branch '${mr.source_branch}' into '${mr.target_branch}'`), { squash });
    mr.state = 'merged';
    mr.merged_at = new Date().toISOString();
    mr.detailed_merge_status = 'not_open';
    if (String(req.body?.should_remove_source_branch ?? req.query.should_remove_source_branch) === 'true') {
      project.branches.delete(mr.source_branch);
    }
    res.status(200).json(mrJson(project, mr));
  });
  router.delete('/projects/:id/merge_requests/:iid', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    if (!project.mergeRequests.has(Number(req.params.iid))) return sendError(res, 404, '404 Merge Request Not Found');
    project.mergeRequests.delete(Number(req.params.iid));
    res.status(204).send();
  });

  router.post('/projects/:id/repository/tags', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const tagName = req.query.tag_name ?? req.body?.tag_name ?? req.body?.tag;
    const ref = req.query.ref ?? req.body?.ref;
    if (project.tags.has(tagName)) return sendError(res, 400, 'Tag already exists');
    const sha = project.resolveRef(ref);
    if (!sha) return sendError(res, 404, '404 Ref Not Found');
    project.tags.set(tagName, sha);
    const message = req.body?.message ?? req.query.message;
    if (message) project.tagMessages.set(tagName, String(message));
    res.status(201).json({ name: tagName, target: sha, message: project.tagMessages.get(tagName) ?? null, commit: { id: sha } });
  });
  router.get('/projects/:id/repository/tags', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const perPage = Number(req.query.per_page ?? 20);
    const page = Number(req.query.page ?? 1);
    const tags = [...project.tags].map(([name, sha]) => ({ name, target: sha, message: project.tagMessages.get(name) ?? null, commit: { id: sha, short_id: shortId(sha) } }));
    res.status(200).json(tags.slice((page - 1) * perPage, page * perPage));
  });
  router.get('/projects/:id/repository/tags/:name', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const sha = project.tags.get(req.params.name);
    if (!sha) return sendError(res, 404, '404 Tag Not Found');
    res.status(200).json({ name: req.params.name, target: sha, message: project.tagMessages.get(req.params.name) ?? null, commit: { id: sha, short_id: shortId(sha) } });
  });
  router.delete('/projects/:id/repository/tags/:name', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    if (!project.tags.has(req.params.name)) return sendError(res, 404, '404 Tag Not Found');
    project.tags.delete(req.params.name);
    res.status(204).send();
  });

  // ── releases ─────────────────────────────────────────────────────────────
  const releaseJson = (project, release) => ({
    tag_name: release.tag_name,
    name: release.name,
    description: release.description,
    created_at: release.created_at,
    released_at: release.created_at,
    upcoming_release: false,
    _links: { self: `${project.web_url}/-/releases/${release.tag_name}` },
  });
  router.post('/projects/:id/releases', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const { tag_name: tag, name, description } = req.body ?? {};
    if (!tag) return sendError(res, 400, 'tag_name is missing');
    if (project.releases.has(tag)) return sendError(res, 409, 'Release already exists');
    // (real GitLab would make the tag from `ref`; the provider never asks for that)
    if (!project.tags.has(tag)) return sendError(res, 404, '404 Tag Not Found');
    const release = { tag_name: tag, name: name || tag, description: description ?? '', created_at: new Date().toISOString() };
    project.releases.set(tag, release);
    res.status(201).json(releaseJson(project, release));
  });
  router.get('/projects/:id/releases', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const perPage = Number(req.query.per_page ?? 20);
    const page = Number(req.query.page ?? 1);
    const all = [...project.releases.values()].reverse().map((release) => releaseJson(project, release));
    res.status(200).json(all.slice((page - 1) * perPage, page * perPage));
  });
  router.get('/projects/:id/releases/:tag', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const release = project.releases.get(req.params.tag);
    if (!release) return sendError(res, 404, '404 Not Found');
    res.status(200).json(releaseJson(project, release));
  });
  router.put('/projects/:id/releases/:tag', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const release = project.releases.get(req.params.tag);
    if (!release) return sendError(res, 404, '404 Not Found');
    for (const key of ['name', 'description']) if (req.body?.[key] !== undefined) release[key] = req.body[key];
    res.status(200).json(releaseJson(project, release));
  });
  router.delete('/projects/:id/releases/:tag', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const release = project.releases.get(req.params.tag);
    if (!release) return sendError(res, 404, '404 Not Found');
    project.releases.delete(req.params.tag);
    res.status(200).json(releaseJson(project, release));
  });

  router.get('/projects/:id/hooks', (req, res) => {
    const project = projectOr404(req, res);
    if (project) res.status(200).json(project.hooks);
  });
  router.post('/projects/:id/hooks', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const hook = { id: project.nextHookId++, ...req.body };
    project.hooks.push(hook);
    res.status(201).json(hook);
  });

  // a project with CI/CD off answers for its pipelines as GitLab does
  router.use(['/projects/:id/pipelines', '/projects/:id/merge_requests/:iid/pipelines'], (req, res, next) => {
    const project = state.projects.get(Number(req.params.id));
    if (project?.builds_access_level === 'disabled') {
      res.status(403).json({ message: '403 Forbidden' });
      return;
    }
    next();
  });
  router.get('/projects/:id/pipelines', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const { ref } = req.query;
    const perPage = Number(req.query.per_page ?? 20);
    const found = project.pipelines.filter((p) => !ref || p.ref === ref).slice(-perPage).reverse();
    res.status(200).json(found.map((p) => { const { jobs, ...view } = project.pipelineView(p); return view; }));
  });
  // the pipelines of a merge request: the ones that ran for the commit at the tip of its source branch
  router.get('/projects/:id/merge_requests/:iid/pipelines', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const mr = project.mergeRequests.get(Number(req.params.iid));
    if (!mr) return sendError(res, 404, '404 Merge Request Not Found');
    const found = project.pipelines.filter((p) => p.ref === mr.source_branch).reverse();
    res.status(200).json(found.map((p) => { const { jobs, ...view } = project.pipelineView(p); return view; }));
  });
  // the one instance runner of the double: it takes the jobs of a project that has the instance runners turned on
  router.get('/projects/:id/runners', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    res.status(200).json(project.shared_runners_enabled === false ? [] : [{ id: 1, description: 'double-runner', online: true, paused: false, is_shared: true }]);
  });
  router.get('/runners/:rid', (req, res) => {
    res.status(200).json({ id: Number(req.params.rid), description: 'double-runner', tag_list: ['deploy'], run_untagged: false });
  });
  router.get('/projects/:id/pipelines/:pid/jobs', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const pipeline = project.pipelines.find((p) => p.id === Number(req.params.pid));
    if (!pipeline) return sendError(res, 404, '404 Pipeline Not Found');
    // newest first, as GitLab lists them
    res.status(200).json([...project.pipelineView(pipeline).jobs].reverse());
  });
  router.post('/projects/:id/pipelines/:pid/retry', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const pipeline = project.retryPipeline(req.params.pid);
    if (!pipeline) return sendError(res, 404, '404 Pipeline Not Found');
    const { jobs, ...view } = project.pipelineView(pipeline);
    res.status(201).json(view);
  });
  router.post('/projects/:id/pipelines/:pid/cancel', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const pipeline = project.cancelPipeline(req.params.pid);
    if (!pipeline) return sendError(res, 404, '404 Pipeline Not Found');
    const { jobs, ...view } = project.pipelineView(pipeline);
    res.status(200).json(view);
  });
  router.post('/projects/:id/jobs/:jid/cancel', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const pipeline = project.cancelPipeline(Math.floor(Number(req.params.jid) / 100));
    if (!pipeline) return sendError(res, 404, '404 Job Not Found');
    res.status(200).json({ id: Number(req.params.jid), status: 'canceled' });
  });
  router.get('/projects/:id/jobs/:jid/trace', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const jid = Number(req.params.jid);
    const pipeline = project.pipelines.find((p) => p.id === Math.floor(jid / 100));
    const job = pipeline && project.pipelineView(pipeline).jobs.find((j) => j.id === jid);
    if (!job) return sendError(res, 404, '404 Job Not Found');
    const lines = [`Running with gitlab-runner (double) on ${project.path}`, `$ npm ci`, 'added 412 packages in 9s', `$ npm run ${job.name}`];
    if (job.status === 'failed') {
      lines.push('', ' FAIL  src/__tests__/products.test.js', '  ● products › builds the feature model', '', '    expected 3 features, received 2', '', 'Tests: 1 failed, 14 passed, 15 total', 'ERROR: Job failed: exit code 1');
    } else if (job.status === 'success') {
      lines.push('All good', 'Job succeeded');
    }
    res.status(200).type('text/plain').send(lines.join('\n'));
  });
  // dev only: the next `count` pipelines to start fail their test job
  router.post('/__dev/fail-next-pipeline', (req, res) => {
    pipelineControl.failNext = Number(req.body?.count ?? 1);
    res.status(200).json({ failNext: pipelineControl.failNext });
  });

  router.get('/projects/:id/merge_requests/:iid/changes', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const mr = project.mergeRequests.get(Number(req.params.iid));
    if (!mr) return sendError(res, 404, '404 Merge Request Not Found');
    const sourceSha = project.branches.get(mr.source_branch) ?? mr.sha;
    res.status(200).json({ ...mrJson(project, mr), changes: project.changesOf(mr.target_branch, sourceSha) });
  });
  router.post('/projects/:id/merge_requests/:iid/notes', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    if (!project.mergeRequests.has(Number(req.params.iid))) return sendError(res, 404, '404 Merge Request Not Found');
    res.status(201).json({ id: 1, body: req.body?.body ?? '' });
  });
  // discussions: a thread is a discussion; one about a line of the code has a position and can be resolved
  const mrOr404 = (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return [];
    const mr = project.mergeRequests.get(Number(req.params.iid));
    if (!mr) { sendError(res, 404, '404 Merge Request Not Found'); return []; }
    return [project, mr];
  };
  const noteJson = (note) => ({ ...note, author: userJson(note.author) });
  const discussionJson = (d) => ({ id: d.id, individual_note: !d.position, notes: d.notes.map(noteJson) });
  const addNote = (mr, d, body, system = false) => {
    const now = new Date().toISOString();
    const note = {
      id: mr.nextNote++, body, author: 'dev', system, created_at: now, updated_at: now,
      resolvable: Boolean(d.position), resolved: false,
      ...(d.position ? { position: d.position } : {}),
    };
    d.notes.push(note);
    mr.updated_at = now;
    return note;
  };
  router.get('/projects/:id/merge_requests/:iid/discussions', (req, res) => {
    const [, mr] = mrOr404(req, res);
    if (!mr) return;
    const perPage = Number(req.query.per_page ?? 20);
    const page = Number(req.query.page ?? 1);
    res.json(mr.discussions.slice((page - 1) * perPage, page * perPage).map(discussionJson));
  });
  router.get('/projects/:id/merge_requests/:iid/discussions/:did', (req, res) => {
    const [, mr] = mrOr404(req, res);
    if (!mr) return;
    const d = mr.discussions.find((candidate) => candidate.id === req.params.did);
    if (!d) return sendError(res, 404, '404 Discussion Not Found');
    res.json(discussionJson(d));
  });
  router.post('/projects/:id/merge_requests/:iid/discussions', (req, res) => {
    const [, mr] = mrOr404(req, res);
    if (!mr) return;
    const { body, position } = req.body ?? {};
    if (!body) return sendError(res, 400, 'body is missing');
    const d = { id: `d${mr.nextDiscussion++}`, notes: [], ...(position ? { position: { new_path: position.new_path, old_path: position.old_path, new_line: position.new_line, old_line: position.old_line } } : {}) };
    mr.discussions.push(d);
    addNote(mr, d, body);
    res.status(201).json(discussionJson(d));
  });
  router.post('/projects/:id/merge_requests/:iid/discussions/:did/notes', (req, res) => {
    const [, mr] = mrOr404(req, res);
    if (!mr) return;
    const d = mr.discussions.find((candidate) => candidate.id === req.params.did);
    if (!d) return sendError(res, 404, '404 Discussion Not Found');
    res.status(201).json(noteJson(addNote(mr, d, req.body?.body ?? '')));
  });
  router.put('/projects/:id/merge_requests/:iid/discussions/:did', (req, res) => {
    const [, mr] = mrOr404(req, res);
    if (!mr) return;
    const d = mr.discussions.find((candidate) => candidate.id === req.params.did);
    if (!d) return sendError(res, 404, '404 Discussion Not Found');
    for (const note of d.notes) if (note.resolvable) note.resolved = Boolean(req.body?.resolved);
    res.json(discussionJson(d));
  });
  router.get('/projects/:id/merge_requests/:iid/approvals', (req, res) => {
    const [, mr] = mrOr404(req, res);
    if (!mr) return;
    res.json({ approvals_required: 1, approved_by: mr.approvedBy.map((username) => ({ user: userJson(username) })) });
  });
  router.post('/projects/:id/merge_requests/:iid/approve', (req, res) => {
    const [, mr] = mrOr404(req, res);
    if (!mr) return;
    if (!mr.approvedBy.includes('dev')) mr.approvedBy.push('dev');
    res.status(201).json({ id: mr.iid });
  });

  // ── issues, labels, milestones ───────────────────────────────────────────
  const knownUsers = new Map();
  const userJson = (username) => {
    const id = 1000 + [...username].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    knownUsers.set(id, username);
    return { id, username, name: username };
  };
  const usernameOf = (id) => knownUsers.get(id) ?? `user-${id}`;
  const issueJson = (project, issue) => ({
    id: issue.iid,
    iid: issue.iid,
    project_id: project.id,
    title: issue.title,
    description: issue.description,
    state: issue.state,
    author: userJson(issue.author),
    assignees: issue.assignees.map(userJson),
    labels: issue.labels,
    milestone: issue.milestone ? { id: issue.milestone.id, title: issue.milestone.title } : null,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    closed_at: issue.closed_at,
    web_url: `${project.web_url}/-/issues/${issue.iid}`,
    user_notes_count: issue.notes.filter((note) => !note.system).length,
  });
  const issueOr404 = (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return [];
    const issue = project.issues.get(Number(req.params.iid));
    if (!issue) { sendError(res, 404, '404 Not found'); return []; }
    return [project, issue];
  };
  // a user is any name: the double knows no accounts but `dev`
  router.get('/users', (req, res) => res.json(req.query.username ? [userJson(String(req.query.username))] : req.query.search ? [userJson(String(req.query.search))] : []));
  router.get('/projects/:id/labels', (req, res) => { const project = projectOr404(req, res); if (project) res.json(project.labels); });
  router.post('/projects/:id/labels', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const label = { id: project.labels.length + 1, name: req.body?.name, color: req.body?.color ?? '#428BCA' };
    project.labels.push(label);
    res.status(201).json(label);
  });
  router.get('/projects/:id/milestones', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    res.json(project.milestones.filter((m) => !req.query.title || m.title === req.query.title));
  });
  router.post('/projects/:id/milestones', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const milestone = { id: project.milestones.length + 1, title: req.body?.title, state: 'active', due_date: null };
    project.milestones.push(milestone);
    res.status(201).json(milestone);
  });
  router.post('/projects/:id/issues', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const { title, description, labels, assignee_ids, milestone_id } = req.body ?? {};
    if (!title) return sendError(res, 400, 'title is missing');
    const now = new Date().toISOString();
    const issue = {
      iid: project.nextIssueIid++, title, description: description ?? '', state: 'opened', author: 'dev', created_at: now, updated_at: now, closed_at: null,
      labels: labels ? String(labels).split(',').filter(Boolean) : [],
      assignees: (assignee_ids ?? []).map(usernameOf),
      milestone: project.milestones.find((m) => m.id === milestone_id) ?? null,
      notes: [],
    };
    project.issues.set(issue.iid, issue);
    res.status(201).json(issueJson(project, issue));
  });
  router.get('/projects/:id/issues', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const { state = 'opened', author_username, assignee_username, labels, milestone, search } = req.query;
    const wanted = labels ? String(labels).split(',') : [];
    const found = [...project.issues.values()]
      .filter((i) => (state === 'all' || i.state === state)
        && (!author_username || i.author === author_username)
        && (!assignee_username || i.assignees.includes(assignee_username))
        && wanted.every((l) => i.labels.includes(l))
        && (!milestone || i.milestone?.title === milestone)
        && (!search || `${i.title} ${i.description}`.toLowerCase().includes(String(search).toLowerCase())))
      .sort((a, b) => b.iid - a.iid);
    const perPage = Number(req.query.per_page ?? 20);
    const page = Number(req.query.page ?? 1);
    res.json(found.slice((page - 1) * perPage, page * perPage).map((i) => issueJson(project, i)));
  });
  router.get('/projects/:id/issues/:iid', (req, res) => {
    const [project, issue] = issueOr404(req, res);
    if (issue) res.json(issueJson(project, issue));
  });
  router.put('/projects/:id/issues/:iid', (req, res) => {
    const [project, issue] = issueOr404(req, res);
    if (!issue) return;
    const body = req.body ?? {};
    if (body.title !== undefined) issue.title = body.title;
    if (body.description !== undefined) issue.description = body.description;
    if (body.labels !== undefined) issue.labels = String(body.labels).split(',').filter(Boolean);
    if (body.assignee_ids !== undefined) issue.assignees = body.assignee_ids.map(usernameOf);
    if (body.milestone_id !== undefined) issue.milestone = project.milestones.find((m) => m.id === body.milestone_id) ?? null;
    if (body.state_event === 'close') { issue.state = 'closed'; issue.closed_at = new Date().toISOString(); }
    if (body.state_event === 'reopen') { issue.state = 'opened'; issue.closed_at = null; }
    issue.updated_at = new Date().toISOString();
    res.json(issueJson(project, issue));
  });
  router.get('/projects/:id/issues/:iid/notes', (req, res) => {
    const [, issue] = issueOr404(req, res);
    if (issue) res.json(issue.notes.map((note) => ({ ...note, author: userJson(note.author) })));
  });
  router.post('/projects/:id/issues/:iid/notes', (req, res) => {
    const [, issue] = issueOr404(req, res);
    if (!issue) return;
    // GitLab writes a note of its own when a label or the state changes: the provider has to leave those out
    const note = { id: issue.notes.length + 1, body: req.body?.body ?? '', author: 'dev', system: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    issue.notes.push(note);
    res.status(201).json({ ...note, author: userJson('dev') });
  });

  // GraphQL is not served: a test says what it answers (`state.graphqlAnswer`, with `errors` as the real one does for a field it lacks)
  app.post('/api/graphql', (req, res) => {
    res.status(200).json(state.graphqlAnswer ?? { errors: [{ message: 'gitlabDouble: no answer set' }] });
  });
  app.use('/api/v4', router);

  app.use((req, res) => {
    res.status(501).json(CLIENT_ERROR_JSON(`gitlabDouble: no handler for ${req.method} ${req.originalUrl}`));
  });

  return { app, state, gitHttp };
}

export async function startGitlabDouble() {
  // the app has to know its own address (the web urls it gives out are what `git clone` is pointed at): it is only known once it listens
  const holder = {};
  const server = await new Promise((resolve, reject) => {
    const placeholder = express();
    placeholder.use((req, res, next) => holder.app(req, res, next));
    const s = placeholder.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;
  const { app, state, gitHttp } = createGitlabDoubleApp(url);
  holder.app = app;

  return {
    url,
    state,
    getProject: (id) => state.projects.get(id),
    /** @param {{ name: string, groupName?: string, topics?: string[], defaultBranch?: string, initializeWithReadme?: boolean }} options */
    seedProject: ({ name, groupName, topics, defaultBranch, initializeWithReadme = true }) => {
      const group = state.createGroup({ name: groupName ?? name });
      return state.createProject({
        name, namespace_id: group.id, topics, default_branch: defaultBranch,
        initialize_with_readme: initializeWithReadme,
      });
    },
    getLog: () => [...state.requestLog],
    clearLog: () => { state.requestLog = []; },
    reset: () => { state.reset(); gitHttp.reset(); },
    close: () => new Promise((resolve) => server.close(() => { gitHttp.dispose(); resolve(); })),
  };
}
