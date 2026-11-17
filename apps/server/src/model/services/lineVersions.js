import { keepVersionTag, readVersionTag, listVersionTags } from './versionTags.js';
import { keepVersionRelease, recordReleaseFailure } from './versionReleases.js';

// The snapshot of a version of a line is `{ version, savedAt, modular, featureModel: { type, content }, modules }`; `modules` is the manifest
// of a line made of modules and `featureModel` what it composed (or the model it had).
const MAX_LISTED = 40;

/**
 * Keeps the version a line just reached: its tag (with the snapshot) and the release of that tag with its changelog. The history is a
 * convenience of the save, so a failure here never fails the save that caused it: it is recorded (see `versionReleases.js`), shown to the
 * person and can be retried.
 */
export const keepLineVersion = async ({ token, projectId, version, snapshot, ref = 'main', host, name }) => {
  let tagged = false;
  try {
    const message = JSON.stringify({ version, savedAt: new Date().toISOString(), ...snapshot });
    tagged = await keepVersionTag({ token, projectId, version, ref, message, host });
  } catch (error) {
    await recordReleaseFailure({ host, projectId, kind: 'line', version, step: 'tag', error });
    return false;
  }
  await keepVersionRelease({ token, projectId, version, host, kind: 'line', name });
  return tagged;
};

/** The packages a resolution gave, as the history keeps them: `[{ kind, name, location, version }]`, in a stable order. */
export const packagesOf = (packages) => (Array.isArray(packages) ? packages : [])
  .map((p) => ({ kind: p.kind, name: p.name, location: p.location, version: p.version }))
  .sort((a, b) => a.location.localeCompare(b.location));

/** The snapshot of one version, or `null` when it was not kept (lines older than the history have none). */
export const readLineVersion = ({ token, projectId, version, host }) => readVersionTag({ token, projectId, version, host });

/** The versions that have a tag, newest first. */
export const listLineVersionNames = async ({ token, projectId, host }) => (await listVersionTags({ token, projectId, host })).slice(0, MAX_LISTED);
