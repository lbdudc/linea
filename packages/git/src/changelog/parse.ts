import type { ChangelogCommit, SectionId } from './types.js'

const HEADER = /^(\w+)(?:\(([^)\r\n]*)\))?(!)?:\s+(\S.*)$/
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:[ \t]*(.*(?:\n(?![A-Za-z-]+(?:: | #)).+)*)/m
/** `#N`, N from 1; a `group/project#N` of another repository is not matched. */
export const ISSUE_REF = /(?<![\w&/])#([1-9]\d*)\b/g
/** `!N`, N from 1; no prefix is allowed (a `group/project!N` is of another repository), which also keeps the match linear. */
export const MR_REF = /(?<![\w/&])!([1-9]\d*)\b/g

/** Most of a message that is read, and most references taken from one commit: a message is data from whoever can push. */
export const MAX_MESSAGE = 10_000
const MAX_REFERENCES = 50

/** Types that are left out of a changelog unless they are asked for. */
export const HIDDEN_TYPES: readonly string[] = ['chore', 'ci', 'test', 'docs']

const SECTION_OF_TYPE: Record<string, SectionId> = { feat: 'features', fix: 'fixes', perf: 'performance' }

/** The languages the notes of a release can be written in. */
export type ChangelogLocale = 'en' | 'es' | 'gl'
export const CHANGELOG_LOCALES: readonly ChangelogLocale[] = ['en', 'es', 'gl']

/** The words of a changelog, by language (English is the default: a release is read by whoever opens the repository). */
export const CHANGELOG_TEXT: Record<ChangelogLocale, { since: string, truncated: string, none: string, sections: Record<SectionId, string> }> = {
  en: {
    since: 'Changes since', truncated: 'Incomplete history: only the most recent commits were read.', none: 'No changes.',
    sections: { breaking: 'Breaking changes', features: 'Features', fixes: 'Fixes', performance: 'Performance', other: 'Other changes' }
  },
  es: {
    since: 'Cambios desde', truncated: 'Historial incompleto: solo se han leído los commits más recientes.', none: 'Sin cambios.',
    sections: { breaking: 'Cambios incompatibles', features: 'Novedades', fixes: 'Correcciones', performance: 'Rendimiento', other: 'Otros cambios' }
  },
  gl: {
    since: 'Cambios desde', truncated: 'Historial incompleto: só se leron os commits máis recentes.', none: 'Sen cambios.',
    sections: { breaking: 'Cambios incompatibles', features: 'Novidades', fixes: 'Correccións', performance: 'Rendemento', other: 'Outros cambios' }
  }
}

/** The titles of the sections in English. */
export const SECTION_TITLES: Record<SectionId, string> = CHANGELOG_TEXT.en.sections

export const SECTION_ORDER: readonly SectionId[] = ['breaking', 'features', 'fixes', 'performance', 'other']

/** Default commits that are not changes of the product: version bumps and what LINEA itself writes (generations, syncs). */
export const DEFAULT_IGNORED: readonly RegExp[] = [
  // `chore(release): 1.2.3`, `chore: release v1.2.3 [skip ci]`, `build: bump version to 1.2.3`
  /^(chore|build)(\([^)]*\))?!?:\s*((release|bump( version)?( to)?|version)\s+)?v?\d+\.\d+\.\d+\s*(\[[^\]]*\])?$/i,
  // `Release 1.2.3`, `Bump version to 1.2.3`
  /^(release|bump( version)?( to)?)\s+v?\d+\.\d+\.\d+\s*(\[[^\]]*\])?$/i,
  /^v?\d+\.\d+\.\d+([-+][\w.]+)?$/,
  // what LINEA writes itself
  /^\[?linea(-bot)?\]?(\([^)]*\))?[:!\]]/i
]

const MERGE = /^Merge (branch|pull request|remote-tracking branch|tag|commit)\b/i

export const isMerge = (title: string): boolean => MERGE.test(title)

/** What is read of a long message: its start and its end, where a `BREAKING CHANGE:` footer is. */
export const capMessage = (message: string): string =>
  message.length <= MAX_MESSAGE ? message : `${message.slice(0, MAX_MESSAGE / 2)}\n${message.slice(-MAX_MESSAGE / 2)}`

/**
 * The merge requests a merge commit names the way GitLab writes them, `See merge request group/project!7`: the ones of `repositoryPath`
 * (those of another project are not this repository's). Bounded, line by line.
 */
export const mergedRequestsOf = (message: string, repositoryPath: string): number[] => {
  const found = new Set<number>()
  for (const match of capMessage(message).matchAll(/^See merge request ([\w./-]{1,200})!([1-9]\d*)[ \t]*$/gm)) {
    if ((match[1] as string).toLowerCase() === repositoryPath.toLowerCase()) found.add(Number(match[2]))
  }
  return [...found].sort((a, b) => a - b)
}

export const referencesIn = (text: string): ChangelogCommit['references'] => {
  text = text.slice(0, MAX_MESSAGE)
  const found = new Map<string, ChangelogCommit['references'][number]>()
  for (const match of text.matchAll(MR_REF)) found.set(`m${match[1]}`, { kind: 'mergeRequest', number: Number(match[1]) })
  for (const match of text.matchAll(ISSUE_REF)) found.set(`i${match[1]}`, { kind: 'issue', number: Number(match[1]) })
  return [...found.values()].slice(0, MAX_REFERENCES).sort((a, b) => (a.kind === b.kind ? a.number - b.number : a.kind === 'issue' ? -1 : 1))
}

export interface ParsedMessage {
  type: string | null
  scope: string | null
  description: string
  breaking: boolean
  breakingNote: string | null
}

/** Reads a commit message as a Conventional Commit. One that does not follow the convention keeps its title as the description. */
export const parseMessage = (title: string, message?: string): ParsedMessage => {
  const full = (message ?? title).replace(/\r\n/g, '\n')
  const header = HEADER.exec(title.trim())
  const body = full.slice(full.startsWith(title) ? title.length : full.indexOf('\n') >= 0 ? full.indexOf('\n') : full.length)
  const note = BREAKING_FOOTER.exec(body)?.[1]?.trim() || null
  const hasFooter = BREAKING_FOOTER.test(body)
  if (!header) return { type: null, scope: null, description: title.trim(), breaking: hasFooter, breakingNote: note }
  return {
    type: (header[1] as string).toLowerCase(),
    scope: header[2]?.trim() || null,
    description: (header[4] as string).trim(),
    breaking: header[3] === '!' || hasFooter,
    breakingNote: note
  }
}

export const sectionOf = (parsed: ParsedMessage, include: readonly string[]): SectionId | null => {
  if (parsed.breaking) return 'breaking'
  if (parsed.type && HIDDEN_TYPES.includes(parsed.type) && !include.includes(parsed.type)) return null
  return (parsed.type && SECTION_OF_TYPE[parsed.type]) || 'other'
}
