import { generateChangelog } from '@lbdudc/linea-git';
import { getGitProvider } from '../git/index.js';
import { mapLimit } from './recent.js';
import { findVersionRelease } from './versionReleases.js';
import { compareVersions, isVersion, listVersionTags, readVersionTag, tagOf } from './versionTags.js';

// The changelog of a range of versions: the one of each version between `from` (exclusive) and `to` (inclusive), concatenated and grouped
// by section. Each version's changelog is read from the cache (Mongo), else from the host's release (markdown only) and, when the tag has
// no release, generated on the spot (not kept: the release is made by `versionReleases.js`).

const SECTION_ORDER = ['breaking', 'features', 'fixes', 'performance', 'other'];
const SECTION_TITLES = { breaking: 'Breaking changes', features: 'Features', fixes: 'Fixes', performance: 'Performance', other: 'Other' };
export const MAX_RANGE = 50;
// versions read at once from the host (each one is several calls with the person's token)
const CONCURRENCY = 4;
/** What the changelog of a dependency covers: the newest versions of its range, so a wide jump does not read the whole history. */
export const MAX_DEPENDENCY_RANGE = 10;

const withVersion = (version) => (entry) => ({ ...entry, version });

/** One version's changelog as `{ version, source, changelog }`; `changelog` is `null` (and source `none`) when there is nothing to read. */
const changelogOfVersion = async ({ token, projectId, host, version }) => {
  const cached = await findVersionRelease({ host, projectId, version });
  if (cached?.status === 'released' && cached.changelog) return { version, source: 'cache', changelog: cached.changelog };
  const git = getGitProvider({ host });
  const tag = tagOf(version);
  if (!(await git.getTag({ token, id: projectId, tag }))) return { version, source: 'none', changelog: null };
  try {
    const generated = await generateChangelog({ provider: git, token, id: projectId, to: tag });
    const { from, to, truncated, markdown, sections, mergeRequests, issues } = generated;
    return { version, source: 'generated', changelog: { from, to, truncated, markdown, sections, mergeRequests, issues } };
  } catch (error) {
    // the release of the host is still something to show
    const release = await git.getRelease({ token, id: projectId, tag }).catch(() => null);
    if (release?.description) return { version, source: 'release', changelog: { from: null, to: tag, truncated: false, markdown: release.description, sections: [], mergeRequests: [], issues: [] } };
    return { version, source: 'none', changelog: null };
  }
};

/** Puts the versions' sections together: one list per section, each entry with the version it came from, newest version first. */
export const mergeSections = (parts) => {
  const bySection = new Map();
  for (const { version, changelog } of [...parts].sort((a, b) => compareVersions(b.version, a.version))) {
    for (const section of changelog?.sections ?? []) {
      const entries = bySection.get(section.id) ?? [];
      entries.push(...(section.entries ?? []).map(withVersion(version)));
      bySection.set(section.id, entries);
    }
  }
  return SECTION_ORDER.filter((id) => bySection.get(id)?.length).map((id) => ({ id, title: SECTION_TITLES[id], entries: bySection.get(id) }));
};

/**
 * The changes from `from` (exclusive) to `to` (inclusive, the newest version by default). Without `from` the range is `to` alone (what that
 * version brings over the one before it). `versions` says, for each version of the range, where its changelog came from. A range of more
 * than `maxVersions` keeps the newest ones and says so with `truncated`.
 */
export const rangeChangelog = async ({ token, projectId, host, from, to, maxVersions = MAX_RANGE, listVersions = listVersionTags }) => {
  const known = await listVersions({ token, projectId, host });
  const upper = to ?? known[0] ?? null;
  if (!upper) return { from: from ?? null, to: null, versions: [], sections: [], breaking: false, truncated: false, markdown: '' };
  const inRange = from
    ? known.filter((v) => compareVersions(v, from) > 0 && compareVersions(v, upper) <= 0)
    : [upper];
  // `known` is newest first: the newest ones are kept
  const wanted = inRange.slice(0, maxVersions);
  const ordered = [...wanted].sort(compareVersions);
  const parts = await mapLimit(ordered, CONCURRENCY, (version) => changelogOfVersion({ token, projectId, host, version }));
  const sections = mergeSections(parts);
  const markdown = [...parts].reverse()
    .filter((p) => p.changelog?.markdown)
    .map((p) => p.changelog.markdown)
    .join('\n\n');
  return {
    from: from ?? ordered.map((v) => parts.find((p) => p.version === v)?.changelog?.from).find(Boolean) ?? null,
    to: upper,
    versions: [...parts].reverse().map((p) => ({ version: p.version, source: p.source })),
    sections,
    breaking: sections.some((s) => s.id === 'breaking' && s.entries.length > 0),
    truncated: parts.some((p) => p.changelog?.truncated) || wanted.length < inRange.length,
    markdown,
  };
};

// a snapshot is data read from a repository: what is not a version or a location is left out, so it cannot reach a text people read
const usable = (p) => p && typeof p.location === 'string' && LOCATION.test(p.location) && isVersion(p.version);

/** The packages whose version differs between two resolutions (`packagesOf` of each): `[{ kind, name, location, from, to, change }]`. */
export const changedPackages = (before, after) => {
  const was = new Map((before ?? []).filter(usable).map((p) => [p.location, p]));
  const is = new Map((after ?? []).filter(usable).map((p) => [p.location, p]));
  const changes = [];
  for (const [location, p] of is) {
    const old = was.get(location);
    if (!old) changes.push({ kind: p.kind, name: p.name, location, from: null, to: p.version, change: 'added' });
    else if (old.version !== p.version) changes.push({ kind: p.kind, name: p.name, location, from: old.version, to: p.version, change: compareVersions(p.version, old.version) > 0 ? 'upgraded' : 'downgraded' });
  }
  for (const [location, p] of was) {
    if (!is.has(location)) changes.push({ kind: p.kind, name: p.name, location, from: p.version, to: null, change: 'removed' });
  }
  return changes.sort((a, b) => a.location.localeCompare(b.location));
};

/** The packages a version of a line kept (`packages` of its snapshot), or `null` when it has none. */
export const packagesOfVersion = async ({ token, projectId, host, version }) => {
  if (!isVersion(version)) return null;
  const snapshot = await readVersionTag({ token, projectId, version, host });
  return Array.isArray(snapshot?.packages) ? snapshot.packages : null;
};

const SEGMENT = /^[\w.-]+$/;
/**
 * `gitlab:group/project` as `{ scheme, path }`, or `null` when it is not one: every segment is a plain name (no `.`, `..` or empty ones).
 */
export const parseLocation = (location) => {
  if (typeof location !== 'string') return null;
  const at = location.indexOf(':');
  if (at < 1) return null;
  const scheme = location.slice(0, at);
  const path = location.slice(at + 1);
  const segments = path.split('/');
  if (!/^[a-z]+$/.test(scheme) || segments.length < 2 || !segments.every((x) => SEGMENT.test(x) && x !== '.' && x !== '..')) return null;
  return { scheme, path };
};
const LOCATION = { test: (value) => parseLocation(value) !== null };

// text from a repository is made plain: no markdown, and nothing that mentions people (`@name`), links an item (`#1`, `!1`) or makes an emoji
const plain = (text) => String(text ?? '')
  .replace(/[\\`*_[\]<>|:]/g, (c) => `\\${c}`)
  .replace(/[@#!]/g, (c) => `${c}\u200b`)
  .replace(/\s+/g, ' ').trim();
const MAX_DESCRIPTION = 60_000;
/** What the description of a sync's request starts with: how it is told from one a person wrote. */
export const SYNC_DESCRIPTION_HEADING = '## Changes in dependencies';
export const SPL_CHANGES_HEADING = '## Changes in the SPL';
/** Whether a description is one a sync wrote before (a description a person wrote is never replaced). */
export const isSyncDescription = (text) => String(text ?? '').startsWith(SYNC_DESCRIPTION_HEADING) || String(text ?? '').startsWith(SPL_CHANGES_HEADING);

// the id of a commit, a link to it on the host when the host gave its address
const commitLink = (entry) => {
  const id = plain(entry.shortId);
  if (!id) return '';
  const url = /^https?:\/\//i.test(entry.webUrl ?? '') ? String(entry.webUrl).replace(/[()\s[\]<>"`]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`) : null;
  return url ? `[${id}](${url})` : id;
};

/** The entries of some sections by version, the oldest first: `[{ version, sections: [{ id, title, entries }] }]`. */
export const groupByVersion = (sections) => {
  const versions = new Map();
  for (const section of sections ?? []) {
    for (const entry of section.entries ?? []) {
      const key = isVersion(entry.version) ? entry.version : '';
      if (!versions.has(key)) versions.set(key, new Map());
      const bySection = versions.get(key);
      if (!bySection.has(section.id)) bySection.set(section.id, { id: section.id, title: section.title, entries: [] });
      bySection.get(section.id).entries.push(entry);
    }
  }
  return [...versions.entries()]
    .sort(([a], [b]) => (a && b ? compareVersions(a, b) : a ? 1 : -1))
    .map(([version, bySection]) => ({ version, sections: [...bySection.values()] }));
};

const entryText = (entry, section) => `${section.id === 'breaking' ? '⚠ ' : ''}${entry.scope ? `**${plain(entry.scope)}:** ` : ''}${plain(entry.description)}${commitLink(entry) ? ` (${commitLink(entry)})` : ''}`;

const KIND_ORDER = ['metamodel', 'module'];
const KIND_TITLES = { metamodel: 'Metamodels', module: 'Modules' };

/** The dependencies that changed as the markdown of a request: metamodels and modules apart, each with what its versions bring, oldest first. */
export const dependenciesMarkdown = ({ from, to, dependencies }) => {
  if (!dependencies?.length) return '';
  const lines = [`${SYNC_DESCRIPTION_HEADING} (line v${plain(from)} → v${plain(to)})`, ''];
  const kinds = [...new Set([...KIND_ORDER, ...dependencies.map((d) => d.kind)])].filter((kind) => dependencies.some((d) => d.kind === kind));
  for (const kind of kinds) {
    lines.push(`### ${KIND_TITLES[kind] ?? plain(kind)}`, '');
    for (const d of dependencies.filter((x) => x.kind === kind)) {
      const move = d.change === 'added' ? `added v${plain(d.to)}` : d.change === 'removed' ? `removed (was v${plain(d.from)})` : `v${plain(d.from)} → v${plain(d.to)}`;
      lines.push(`- **${plain(d.name)}**: ${move}${d.changelog?.breaking ? ' — ⚠ breaking changes' : ''}`);
      for (const { version, sections } of groupByVersion(d.changelog?.sections)) {
        if (version) lines.push(`  - **v${plain(version)}**`);
        for (const section of sections) for (const entry of section.entries) lines.push(`    - ${entryText(entry, section)}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd().slice(0, MAX_DESCRIPTION);
};

/** The commits of the SPL itself between two of its versions, by section: what a product that syncs is told besides what its dependencies changed. */
export const splChangesMarkdown = ({ from, to, changelog }) => {
  const groups = groupByVersion((changelog?.sections ?? []).filter((section) => section.entries?.length));
  if (!groups.length) return '';
  const lines = [`${SPL_CHANGES_HEADING} (v${plain(from)} → v${plain(to)})`, ''];
  for (const { version, sections } of groups) {
    if (version) lines.push(`### v${plain(version)}`, '');
    for (const section of sections) {
      lines.push(`**${plain(section.title)}**`, '');
      for (const entry of section.entries) lines.push(`- ${entryText(entry, section)}`);
      lines.push('');
    }
  }
  return lines.join('\n').trimEnd().slice(0, MAX_DESCRIPTION);
};
