import { generateChangelog } from '@lbdudc/linea-git';
import { getGitProvider } from '../git/index.js';
import VersionRelease from '../entities/versionRelease.js';
import Log from '../entities/log.js';
import Product from '../entities/product.js';
import { compareVersions, isVersion, tagOf } from './versionTags.js';

// The release of each version tag: the notes of the host's release are the changelog generated between the previous version and this one
// (linea-git's generator), and what was generated is kept in Mongo to be read without asking the host. A failure never fails the save that
// caused it: it is recorded (and, for a product, written to its log) so it can be shown and retried.

// What is kept of a host's error, which people other than the one who triggered it can read (and the product log renders as HTML): no
// markup and no addresses. The full text goes to the server log only.
const describe = (error) => {
  const status = Number(error?.status ?? error?.response?.status);
  const text = String(error?.message ?? error)
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[<>&"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return Number.isInteger(status) && status > 0 ? `Host error ${status}: ${text}` : text;
};

// a duplicate key is the same upsert made by a concurrent save: the row is there
const isDuplicateKey = (error) => error?.code === 11000;
const upsert = async (key, update) => {
  try {
    return await VersionRelease.findOneAndUpdate(key, update, { upsert: true });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    return VersionRelease.findOneAndUpdate(key, update);
  }
};

const keyOf = ({ host, projectId, version }) => ({ host: host ?? '', projectId: Number(projectId), version });

// what is kept of a changelog: the commits are the host's to give
const summaryOf = (changelog) => ({
  from: changelog.from, to: changelog.to, truncated: changelog.truncated, markdown: changelog.markdown,
  sections: changelog.sections, mergeRequests: changelog.mergeRequests, issues: changelog.issues,
});

/** The record of a version's release, or `null`. */
export const findVersionRelease = ({ host, projectId, version }) => VersionRelease.findOne(keyOf({ host, projectId, version }));

/** The records of a repository, newest version first. */
export const listVersionReleases = async ({ host, projectId }) =>
  (await VersionRelease.find({ host: host ?? '', projectId: Number(projectId) }).select('-changelog')).sort((a, b) => compareVersions(b.version, a.version));

/** Notes the failure where the operation is: the record of the version and, for a product, its log. Never throws. */
export const recordReleaseFailure = async ({ host, projectId, kind, version, step, error }) => {
  const message = describe(error);
  try {
    await upsert(
      keyOf({ host, projectId, version }),
      { $set: { kind, tag: tagOf(version), status: 'failed', step, error: message, updatedAt: new Date() }, $inc: { attempts: 1 }, $setOnInsert: { createdAt: new Date() } },
    );
    if (kind === 'product') {
      const product = await Product.findOne({ 'repo.id': Number(projectId) });
      if (product) {
        await new Log({
          productId: product._id, lineId: product.lineId, productName: product.spec?.basicData?.name, version,
          type: 'error', message: `The ${step} of version ${version} could not be made: ${message}`,
        }).save();
      }
    }
  } catch (cause) {
    console.warn(`[version-releases] could not record the failure of version ${version} of project ${projectId}: ${cause?.message ?? cause}`);
  }
  console.warn(`[version-releases] ${step} of version ${version} of project ${projectId} failed: ${error?.message ?? error}`);
};

/**
 * Makes the release of the tag of `version`: generates the changelog since the previous version and creates the release with it as its notes.
 * Idempotent: a version with a record of success, or whose tag already has a release, gets nothing new. Never throws; `{ status, ... }`.
 * With `force` the changelog is generated again even when it is cached (a retry).
 */
export const keepVersionRelease = async ({ token, projectId, version, host, kind, name, force = false }) => {
  if (!isVersion(version)) return { status: 'skipped' };
  const key = keyOf({ host, projectId, version });
  const tag = tagOf(version);
  try {
    const cached = await VersionRelease.findOne(key);
    if (!force && cached?.status === 'released') return { status: 'released', created: false, changelog: cached.changelog };
    const git = getGitProvider({ host });
    if (!(await git.getTag({ token, id: projectId, tag }))) {
      await recordReleaseFailure({ host, projectId, kind, version, step: 'tag', error: `the tag ${tag} does not exist` });
      return { status: 'failed', step: 'tag' };
    }

    let changelog;
    try {
      changelog = summaryOf(await generateChangelog({ provider: git, token, id: projectId, to: tag }));
    } catch (error) {
      await recordReleaseFailure({ host, projectId, kind, version, step: 'changelog', error });
      return { status: 'failed', step: 'changelog' };
    }

    let created = false;
    try {
      const existing = await git.getRelease({ token, id: projectId, tag });
      if (!existing) {
        try {
          await git.createRelease({ token, id: projectId, tag, name: name ? `${name} ${version}` : tag, description: changelog.markdown });
          created = true;
        } catch (error) {
          if (!git.isAlreadyExistsError(error)) throw error;
        }
      } else if (force && existing.description !== changelog.markdown) {
        // the host's release is the source of truth: a retry that regenerated the changelog brings it up to date
        await git.updateRelease({ token, id: projectId, tag, changes: { description: changelog.markdown } });
      }
    } catch (error) {
      await recordReleaseFailure({ host, projectId, kind, version, step: 'release', error });
      return { status: 'failed', step: 'release' };
    }

    await upsert(
      key,
      { $set: { kind, tag, status: 'released', changelog, updatedAt: new Date() }, $unset: { step: 1, error: 1 }, $setOnInsert: { createdAt: new Date() } },
    );
    return { status: 'released', created, changelog };
  } catch (error) {
    await recordReleaseFailure({ host, projectId, kind, version, step: 'release', error });
    return { status: 'failed', step: 'release' };
  }
};

export const BACKFILL_LIMIT = 20;

/**
 * Releases the version tags that have none yet, oldest first (each one's range is that between consecutive tags). At most `limit` are made
 * per call, so a request stays short: `remaining` says how many are still to do, and calling again continues.
 */
export const backfillVersionReleases = async ({ token, projectId, host, kind, name, versions, limit = BACKFILL_LIMIT }) => {
  const results = [];
  let made = 0;
  let remaining = 0;
  for (const version of [...versions].reverse()) {
    const existing = await getGitProvider({ host }).getRelease({ token, id: projectId, tag: tagOf(version) }).catch(() => null);
    if (existing && (await findVersionRelease({ host, projectId, version }))?.status === 'released') {
      results.push({ version, status: 'released', created: false });
      continue;
    }
    if (made >= limit) {
      remaining += 1;
      continue;
    }
    made += 1;
    const { status, created = false, step } = await keepVersionRelease({ token, projectId, version, host, kind, name });
    results.push({ version, status, created, ...(step ? { step } : {}) });
  }
  return { results, remaining };
};
