import { vi } from 'vitest';
import { GitLabProvider } from '@lbdudc/linea-git';

// What the untracked commits wrote, by project and path: the spec of a product now lives only in GitLab, so a read has to
// give back what a save wrote.
const committedFiles = new Map();
const fileKey = (id, path) => `${id}:${path}`;

/** Commits that are made without being remembered for rollback (the spec file, the products index) are kept in memory: they answer with a sha. */
export const stubUntrackedCommits = () => {
  const original = GitLabProvider.prototype.commit;
  return vi.spyOn(GitLabProvider.prototype, 'commit').mockImplementation(function (args) {
    if (args.track !== false) return original.call(this, args);
    for (const action of args.actions ?? []) {
      if (action.action === 'delete') committedFiles.delete(fileKey(args.id, action.path));
      else committedFiles.set(fileKey(args.id, action.path), action.content);
    }
    return Promise.resolve({ id: 'mock-commit-sha' });
  });
};

/** Nothing is stored in `path` unless a commit wrote it: reading it answers 404, as a repository that has no such file does. */
export const stubMissingFileRevisions = () => {
  committedFiles.clear();
  return vi.spyOn(GitLabProvider.prototype, 'getFileRevision').mockImplementation(async ({ id, path }) => {
    const content = committedFiles.get(fileKey(id, path));
    if (content === undefined) throw Object.assign(new Error('404 Not Found'), { status: 404 });
    return { content: Buffer.from(content, 'utf8').toString('base64'), revision: 'mock-revision' };
  });
};

const createdTags = new Map();

/**
 * The branches and tags a generation asks the host about, for tests that stub the host by hand: the head of a branch is a fixed
 * commit, and tags are kept in memory (an annotated one gives back its message).
 */
export const stubBranchesAndTags = () => {
  createdTags.clear();
  vi.spyOn(GitLabProvider.prototype, 'getBranch').mockImplementation(async ({ branch }) => ({ name: branch, lastCommit: { id: 'branch-head' } }));
  vi.spyOn(GitLabProvider.prototype, 'getTag').mockImplementation(async ({ id, tag }) => (
    createdTags.has(`${id}:${tag}`) ? { name: tag, commitId: 'branch-head', message: createdTags.get(`${id}:${tag}`) } : null
  ));
  vi.spyOn(GitLabProvider.prototype, 'createTag').mockImplementation(async ({ id, tag, message }) => {
    createdTags.set(`${id}:${tag}`, message ?? null);
    return {};
  });
  vi.spyOn(GitLabProvider.prototype, 'listTags').mockImplementation(async ({ id }) => (
    [...createdTags.keys()].filter((key) => key.startsWith(`${id}:`)).map((key) => ({ name: key.slice(`${id}:`.length) }))
  ));
  // the release of a tag (with its changelog) is made on the host too: here there is no history to read and releases are kept in memory
  const releases = new Map();
  vi.spyOn(GitLabProvider.prototype, 'getCommits').mockResolvedValue([]);
  vi.spyOn(GitLabProvider.prototype, 'compare').mockResolvedValue({ commits: [], files: [] });
  vi.spyOn(GitLabProvider.prototype, 'getRelease').mockImplementation(async ({ id, tag }) => releases.get(`${id}:${tag}`) ?? null);
  vi.spyOn(GitLabProvider.prototype, 'createRelease').mockImplementation(async ({ id, tag, name, description }) => {
    const release = { tag, name: name ?? tag, description: description ?? '' };
    releases.set(`${id}:${tag}`, release);
    return release;
  });
};

/** A project as GitLab's REST API describes it, as the neutral repository the provider gives for it. */
export const repositoryOfGitLabProject = (project) => ({
  id: project.id,
  name: project.name,
  path: project.path_with_namespace,
  description: project.description ?? '',
  webUrl: project.web_url,
  webIdeUrl: `http://gitlab.example/-/ide/project/${project.path_with_namespace}/edit/main/-/`,
  namespaceId: project.namespace?.id,
  parentNamespaceId: project.namespace?.parent_id,
  defaultBranch: project.default_branch,
  topics: project.topics ?? [],
});
