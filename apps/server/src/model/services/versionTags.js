import { getGitProvider } from '../git/index.js';

// What each version of a line or a product was, one annotated tag per version (its message is the snapshot): the history compares any
// version with the one before it. Tags, and not files, so the repository keeps one file less per version.
const VERSION_FORMAT = /^\d+\.\d+\.\d+$/;
const TAG_PREFIX = 'v';
export const tagOf = (version) => `${TAG_PREFIX}${version}`;

export const isVersion = (value) => typeof value === 'string' && VERSION_FORMAT.test(value);

// 1.10.0 after 1.9.0
export const compareVersions = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};

// `host` is the git host of the repository (a line's or a product's `gitHost`); unset: the primary one

/** Tags `ref` with the version and `message` as its snapshot, once: a version that already has its tag is not moved. `true` when made. */
export const keepVersionTag = async ({ token, projectId, version, ref, message, host }) => {
  if (!isVersion(version)) return false;
  const git = getGitProvider({ host });
  const tag = tagOf(version);
  if (await git.getTag({ token, id: projectId, tag })) return false;
  try {
    await git.createTag({ token, id: projectId, tag, ref, message });
    return true;
  } catch (error) {
    if (git.isAlreadyExistsError(error)) return false;
    throw error;
  }
};

/** The snapshot of one version, or `null` when it was not kept or is not a JSON object that `isSnapshot` accepts. */
export const readVersionTag = async ({ token, projectId, version, isSnapshot = () => true, host }) => {
  if (!isVersion(version)) return null;
  const found = await getGitProvider({ host }).getTag({ token, id: projectId, tag: tagOf(version) });
  if (!found?.message) return null;
  try {
    const parsed = JSON.parse(found.message);
    return parsed && typeof parsed === 'object' && isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** The versions that have a tag, newest first. */
export const listVersionTags = async ({ token, projectId, host }) => {
  const tags = await getGitProvider({ host }).listTags({ token, id: projectId });
  return tags
    .map((tag) => tag.name)
    .filter((name) => name.startsWith(TAG_PREFIX))
    .map((name) => name.slice(TAG_PREFIX.length))
    .filter(isVersion)
    .sort((a, b) => compareVersions(b, a));
};
