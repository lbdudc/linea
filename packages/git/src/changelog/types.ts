import type { CommitSummary, GitProvider, Id } from '../provider.js'

/** The kinds of change a Conventional Commit can name that LINEA knows about; anything else lands in `other`. */
export type CommitType = 'feat' | 'fix' | 'perf' | 'refactor' | 'docs' | 'chore' | 'ci' | 'test'

export type SectionId = 'breaking' | 'features' | 'fixes' | 'performance' | 'other'

/** A `#N` (issue) or `!N` (merge request) found in a commit, with what the host says about it when it could be resolved. */
export interface ChangelogReference {
  kind: 'issue' | 'mergeRequest'
  number: number
  /** Empty when the host has no such item (or it could not be read). */
  title: string
  /** Empty when it was not resolved. */
  webUrl: string
  resolved: boolean
}

/** One commit of the range, read as a Conventional Commit. */
export interface ChangelogCommit {
  shortId: string
  title: string
  webUrl: string
  authorName: string
  createdAt: string
  /** The type it declares (lower case), or `null` when it does not follow the convention. */
  type: string | null
  scope: string | null
  /** What the change is, without the `type(scope):` prefix. */
  description: string
  breaking: boolean
  /** The text of `BREAKING CHANGE:`, when the commit has one. */
  breakingNote: string | null
  references: { kind: 'issue' | 'mergeRequest', number: number }[]
  section: SectionId | null
}

export interface ChangelogEntry {
  shortId: string
  webUrl: string
  type: string | null
  scope: string | null
  description: string
  breaking: boolean
  breakingNote: string | null
  references: ChangelogReference[]
}

export interface ChangelogSection {
  id: SectionId
  title: string
  entries: ChangelogEntry[]
}

export interface Changelog {
  from: string | null
  to: string
  /** The range was cut: the history has more commits than a host gives (or than the generator reads). */
  truncated: boolean
  markdown: string
  /** Only the sections that have entries, in a fixed order. */
  sections: ChangelogSection[]
  /** Every commit of the range that was kept (hidden types and ignored commits are not here). */
  commits: ChangelogCommit[]
  /** Every merge request mentioned by the kept commits and by the merges that were dropped, sorted by number. */
  mergeRequests: ChangelogReference[]
  /** Every issue mentioned, sorted by number. */
  issues: ChangelogReference[]
}

export interface ChangelogOptions {
  provider: GitProvider
  token: string
  id: Id
  /** Where the range starts (exclusive). Default: the greatest `vX.Y.Z` tag lower than `to`; with none, the first commit. */
  from?: string | null | undefined
  /** A tag or a ref. */
  to: string
  /** Types that are hidden by default (`chore`, `ci`, `test`, `docs`) and that should be shown, under «Otros». */
  include?: string[]
  /** More commits to leave out, on top of the defaults: tested against the title of each commit. */
  ignore?: RegExp[]
  /** Leave out version bumps and the commits LINEA itself makes (generations, syncs). Default `true`. */
  ignoreDefaults?: boolean
  /** Heading of the markdown. Default: `to`. */
  title?: string
  /** The language of the notes (their headings and fixed phrases). Default `en`. */
  locale?: 'en' | 'es' | 'gl'
}

export type { CommitSummary }
