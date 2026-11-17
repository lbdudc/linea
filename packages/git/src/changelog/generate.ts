import semver from 'semver'
import type { CommitSummary, GitProvider, Id } from '../provider.js'
import type { ChangelogLocale } from './parse.js'
import { DEFAULT_IGNORED, ISSUE_REF, MR_REF, SECTION_ORDER, CHANGELOG_TEXT, capMessage, isMerge, mergedRequestsOf, parseMessage, referencesIn, sectionOf } from './parse.js'
import type { Changelog, ChangelogCommit, ChangelogEntry, ChangelogOptions, ChangelogReference, ChangelogSection } from './types.js'

const VERSION_TAG = /^v?(\d+\.\d+\.\d+)$/
/** Most a host gives in one page of commits: what a range with no previous tag reads. */
const FIRST_PAGE = 100
/** Most commits read from a range, and most references resolved against the host (each is a call with the user's token). */
const MAX_COMMITS = 1000
const MAX_RESOLVED = 200
const CONCURRENCY = 5

/** The greatest `vX.Y.Z` tag lower than `to` (any, when `to` is not itself a version), or `null`. */
export const previousTag = (tags: { name: string }[], to: string): string | null => {
  // `to` may be a prerelease (`v1.2.0-rc.1`): it comes before `1.2.0`, so tags are compared with it as semver does
  const limit = semver.valid(to.replace(/^v/, '')) ?? undefined
  const versions = tags
    .map((tag) => ({ name: tag.name, version: VERSION_TAG.exec(tag.name)?.[1] }))
    .filter((tag): tag is { name: string, version: string } => Boolean(tag.version) && (!limit || semver.lt(tag.version as string, limit)))
    .sort((a, b) => semver.rcompare(a.version, b.version) || a.name.localeCompare(b.name))
  return versions[0]?.name ?? null
}

const statusOf = (error: unknown): number | undefined => (error as { status?: number }).status

const resolveReference = async ({ provider, token, id, kind, number }: { provider: GitProvider, token: string, id: Id, kind: 'issue' | 'mergeRequest', number: number }): Promise<ChangelogReference> => {
  const missing: ChangelogReference = { kind, number, title: '', webUrl: '', resolved: false }
  const tryRead = async (read: () => Promise<{ title: string, webUrl: string }>): Promise<ChangelogReference | null> => {
    try {
      const found = await read()
      return { kind, number, title: found.title, webUrl: found.webUrl, resolved: true }
    } catch (error) {
      // only "it is not there" (or not for us) is an unresolved reference; a host that fails is a failure
      if (statusOf(error) === 404 || statusOf(error) === 403) return null
      throw error
    }
  }
  if (kind === 'mergeRequest') return await tryRead(() => provider.getMergeRequest({ token, id, number })) ?? missing
  const issue = await tryRead(() => provider.getIssue({ token, id, number }))
  if (issue) return issue
  // only on GitHub does `#N` also name a pull request; elsewhere an unknown issue stays unresolved rather than link to an unrelated `!N`
  if (provider.kind !== 'github') return missing
  const mr = await tryRead(() => provider.getMergeRequest({ token, id, number }))
  return mr ? { ...mr, kind: 'mergeRequest' } : missing
}

/** Only a web address goes into a link, with what would end it early encoded. */
const safeUrl = (url: string): string => (/^https?:\/\//i.test(url) ? url.replace(/[()\s]/g, (char) => encodeURIComponent(char).replace(/[()]/g, (paren) => (paren === '(' ? '%28' : '%29'))) : '')

const link = (text: string, url: string): string => (safeUrl(url) ? `[${text}](${safeUrl(url)})` : text)

/** Text of a commit is data from whoever can push: its markdown and HTML are made plain, so it cannot add links, images or sections. */
const plain = (text: string): string => text.replace(/[\\`*_[\]<>|]/g, (char) => `\\${char}`).replace(/\s+/g, ' ').trim()

const referenceMarkdown = (reference: ChangelogReference): string => link(`${reference.kind === 'issue' ? '#' : '!'}${reference.number}`, reference.webUrl)

/** The description with the `#N` and `!N` it mentions turned into links (when they were resolved). */
const linked = (description: string, references: ChangelogReference[]): string => {
  // a `#N` can have turned out to be a merge request: it is looked for by number, the kind it was written with first
  const urlOf = (kind: ChangelogReference['kind'], number: number): string =>
    (references.find((r) => r.kind === kind && r.number === number) ?? references.find((r) => r.number === number))?.webUrl ?? ''
  return plain(description)
    .replace(MR_REF, (match, number: string) => link(match, urlOf('mergeRequest', Number(number))))
    .replace(ISSUE_REF, (match, number: string) => link(match, urlOf('issue', Number(number))))
}

const entryMarkdown = (entry: ChangelogEntry, section: ChangelogSection['id']): string => {
  const scope = entry.scope ? `**${plain(entry.scope)}:** ` : ''
  const note = entry.breakingNote && entry.breakingNote !== entry.description ? ` — ${plain(entry.breakingNote)}` : ''
  const inText = new Set(referencesIn(entry.description).map((reference) => `${reference.kind}:${reference.number}`))
  const tail = [link(plain(entry.shortId), entry.webUrl), ...entry.references.filter((reference) => !inText.has(`${reference.kind}:${reference.number}`)).map(referenceMarkdown)].join(', ')
  // a hidden type that was asked for keeps its name, so «Otros» says what each line is
  const prefix = section === 'other' && entry.type ? `${entry.type}: ` : ''
  return `- ${scope}${prefix}${linked(entry.description, entry.references)}${note} (${tail})`
}

export const renderMarkdown = ({ title, from, sections, truncated = false, locale = 'en' }: { title: string, from: string | null, sections: ChangelogSection[], truncated?: boolean, locale?: ChangelogLocale }): string => {
  const text = CHANGELOG_TEXT[locale] ?? CHANGELOG_TEXT.en
  const lines = [`## ${plain(title)}`, '']
  if (from) lines.push(`${text.since} \`${from.replace(/[`\s]+/g, ' ')}\`.`, '')
  if (truncated) lines.push(`> ${text.truncated}`, '')
  if (sections.length === 0) lines.push(`_${text.none}_`, '')
  for (const section of sections) {
    lines.push(`### ${section.title}`, '', ...section.entries.map((entry) => entryMarkdown(entry, section.id)), '')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

const byReference = (a: ChangelogReference, b: ChangelogReference): number => a.number - b.number

/**
 * The release notes of a range, from the commits alone: `from` (exclusive) to `to`. Pure over what the provider answers (`listTags`,
 * `compare` or `getCommits`, `getIssue`, `getMergeRequest`), so the same input gives the same changelog.
 */
export const generateChangelog = async (options: ChangelogOptions): Promise<Changelog> => {
  const { provider, token, id, to, include = [], ignore = [], ignoreDefaults = true } = options
  // a ref that starts with `-` would be read as an option by git
  for (const ref of [to, options.from]) if (typeof ref === 'string' && (ref === '' || ref.startsWith('-'))) throw Object.assign(new Error(`Not a valid ref: "${ref}"`), { status: 400 })
  const from = options.from === undefined
    ? previousTag(await provider.listTags({ token, id }), to)
    : options.from
  const read: CommitSummary[] = from
    ? (await provider.compare({ token, id, from, to })).commits
    : await provider.getCommits({ token, id, ref: to, perPage: FIRST_PAGE })
  // a host answers one page of the whole history when there is no `from`; and a range is not read without end
  const truncated = (!from && read.length >= FIRST_PAGE) || read.length > MAX_COMMITS
  // the same history in the same order on every host (they answer oldest first or newest first)
  // timestamps come with different offsets on different hosts, and a bad one counts as the oldest
  const time = (value: string): number => Date.parse(value) || 0
  const raw = [...read].sort((a, b) => time(b.createdAt) - time(a.createdAt) || a.shortId.localeCompare(b.shortId)).slice(0, MAX_COMMITS)

  let path: string | undefined
  const repositoryPath = async (): Promise<string> => path ??= (await provider.getRepository({ token, id })).path
  const patterns = [...(ignoreDefaults ? DEFAULT_IGNORED : []), ...ignore]
  const kept: ChangelogCommit[] = []
  const mentioned: ChangelogCommit['references'] = []
  for (const commit of raw) {
    const message = capMessage(commit.message ?? commit.title)
    const references = referencesIn(message)
    if (isMerge(commit.title)) {
      // GitLab names the merge request of a merge as `See merge request group/project!7`, with this repository's path
      const own = /^See merge request /m.test(message) ? await repositoryPath() : ''
      mentioned.push(...references, ...mergedRequestsOf(message, own).map((number) => ({ kind: 'mergeRequest' as const, number })))
      continue
    }
    if (patterns.some((pattern) => pattern.test(commit.title))) continue
    const parsed = parseMessage(commit.title, message)
    const section = sectionOf(parsed, include)
    if (!section) continue
    kept.push({
      shortId: commit.shortId, title: commit.title, webUrl: commit.webUrl ?? '', authorName: commit.authorName, createdAt: commit.createdAt,
      ...parsed, references, section
    })
  }

  const wanted = new Map<string, ChangelogCommit['references'][number]>()
  for (const reference of [...kept.flatMap((commit) => commit.references), ...mentioned]) wanted.set(`${reference.kind}:${reference.number}`, reference)
  const resolved = new Map<string, ChangelogReference>()
  const ordered = [...wanted.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.number - b.number)
  // the first ones resolve, in a few calls at a time; the rest stay plain text
  for (const reference of ordered.slice(MAX_RESOLVED)) resolved.set(`${reference.kind}:${reference.number}`, { ...reference, title: '', webUrl: '', resolved: false })
  const toResolve = ordered.slice(0, MAX_RESOLVED)
  for (let start = 0; start < toResolve.length; start += CONCURRENCY) {
    await Promise.all(toResolve.slice(start, start + CONCURRENCY).map(async (reference) => {
      resolved.set(`${reference.kind}:${reference.number}`, await resolveReference({ provider, token, id, ...reference }))
    }))
  }
  // `#N` that turned out to be a merge request counts as one
  const all = [...resolved.values()]

  const sections: ChangelogSection[] = []
  for (const sectionId of SECTION_ORDER) {
    const entries = kept.filter((commit) => commit.section === sectionId).map((commit): ChangelogEntry => ({
      shortId: commit.shortId, webUrl: commit.webUrl, type: commit.type, scope: commit.scope, description: commit.description,
      breaking: commit.breaking, breakingNote: commit.breakingNote,
      references: commit.references.map((reference) => resolved.get(`${reference.kind}:${reference.number}`) as ChangelogReference)
    }))
    if (entries.length > 0) sections.push({ id: sectionId, title: (CHANGELOG_TEXT[options.locale ?? 'en'] ?? CHANGELOG_TEXT.en).sections[sectionId], entries })
  }

  return {
    from, to, truncated,
    markdown: renderMarkdown({ title: options.title ?? to, from, sections, truncated, locale: options.locale }),
    sections,
    commits: kept,
    mergeRequests: all.filter((reference) => reference.kind === 'mergeRequest').sort(byReference),
    issues: all.filter((reference) => reference.kind === 'issue').sort(byReference)
  }
}
