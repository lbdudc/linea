import userService from 'src/services/userService'

/**
 * The messages of the interface are written with GitLab's words. When the git host people use is another one (and only that one), they
 * are rewritten once: "GitLab" becomes the host's name, a merge request its change request, a group an account or an organization.
 * With several hosts on, the words are those of the profile in use (`setProfileWords`), once a person is signed in and has one.
 */
const WORDS = {
  github: {
    name: 'GitHub',
    patterns: [
      [/\bMerge requests\b/g, 'Pull requests'],
      [/\bmerge requests\b/g, 'pull requests'],
      [/\bMerge request\b/g, 'Pull request'],
      [/\bmerge request\b/g, 'pull request'],
      [/\bsolicitud de fusión\b/g, 'pull request'],
      [/\bsolicitude de fusión\b/g, 'pull request'],
      [/\bMRs\b/g, 'PRs'],
      [/\bMR\b/g, 'PR'],
    ],
    // what a "group" is changes, so these say it whole
    labels: {
      en: {
        gitlab_namespace: 'GitHub account or organization',
        gitlab_namespace_hint: 'Where the line will be created: your account or an organization you can create repositories in.',
        gitlab_namespace_empty: 'No accounts available for your GitHub user',
      },
      es: {
        gitlab_namespace: 'Cuenta u organización de GitHub',
        gitlab_namespace_hint: 'Dónde se creará la línea: tu cuenta o una organización en la que puedas crear repositorios.',
        gitlab_namespace_empty: 'No hay cuentas disponibles para tu usuario de GitHub',
      },
      gl: {
        gitlab_namespace: 'Conta ou organización de GitHub',
        gitlab_namespace_hint: 'Onde se creará a liña: a túa conta ou unha organización na que poidas crear repositorios.',
        gitlab_namespace_empty: 'Non hai contas dispoñibles para o teu usuario de GitHub',
      },
    },
  },
  // the repositories on this server: no GitLab to name, and a change is asked for, not "merged" by a request
  local: {
    name: 'LINEA',
    patterns: [
      [/\bMerge requests\b/g, 'Change requests'],
      [/\bmerge requests\b/g, 'change requests'],
      [/\bMerge request\b/g, 'Change request'],
      [/\bmerge request\b/g, 'change request'],
      [/\bsolicitud de fusión\b/g, 'solicitud de cambios'],
      [/\bsolicitude de fusión\b/g, 'solicitude de cambios'],
      [/\bMRs\b/g, 'CRs'],
      [/\bMR\b/g, 'CR'],
    ],
    labels: {},
  },
}

const rewrite = (value, patterns) => {
  if (typeof value === 'string') return patterns.reduce((text, [pattern, to]) => text.replace(pattern, to), value)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, rewrite(inner, patterns)]))
  return value
}

/** The messages of one language in the words of the host `kind` (unchanged for GitLab). */
export const inHostWords = (kind) => (messages, locale) => {
  const words = WORDS[kind]
  if (!words) return messages
  // the page that describes each host keeps every host's own name: "GitLab" there is GitLab, whichever is in use
  const { git_hosts: hostPage, ...rest } = messages
  const out = rewrite(rest, [[/GitLab/g, words.name], ...words.patterns])
  if (hostPage) out.git_hosts = hostPage
  out.labels = { ...(out.labels ?? {}), ...(words.labels[locale] ?? {}) }
  return out
}

// the messages as they were written (GitLab's words), kept the first time they are rewritten so another host's words can replace them later
const originals = new WeakMap() // i18n -> { kept: Map(locale -> messages), kind }

const merge = (base = {}, over = {}) => {
  const out = { ...base }
  for (const [key, value] of Object.entries(over)) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object' ? merge(out[key], value) : value
  }
  return out
}

/** Puts the interface in the words of the host `kind` (GitLab's when it has none): the profile in use, which can change while the page is open. */
export const setProfileWords = ({ i18n, kind }) => {
  const rewriteAll = inHostWords(kind)
  if (!originals.has(i18n)) originals.set(i18n, { kept: new Map(), kind })
  const entry = originals.get(i18n)
  entry.kind = kind
  for (const locale of i18n.global.availableLocales) {
    if (!entry.kept.has(locale)) entry.kept.set(locale, rewrite(i18n.global.getLocaleMessage(locale), []))
    i18n.global.setLocaleMessage(locale, rewriteAll(rewrite(entry.kept.get(locale), []), locale))
  }
}

/**
 * Messages that arrive after the words were set (a plugin's, when it registers): they are written in GitLab's words like the rest, so
 * they join the originals and the host's words are put over everything again. Without it the next switch of profile would drop them.
 */
export const noteMessages = ({ i18n, locale, tree, keepExisting = false }) => {
  const entry = originals.get(i18n)
  if (!entry) return
  const kept = entry.kept.get(locale) ?? {}
  entry.kept.set(locale, keepExisting ? merge(tree, kept) : merge(kept, tree))
  setProfileWords({ i18n, kind: entry.kind })
}

/** Asks which hosts are on and, when there is one and it is not GitLab, puts the interface in its words. */
export const applyHostWords = async ({ i18n, fetchConfig = () => userService.getConfig() } = {}) => {
  let hosts = []
  try {
    const config = await fetchConfig()
    hosts = config.hosts ?? []
  } catch {
    return false // no server to ask: GitLab's words stay
  }
  if (hosts.length !== 1 || !WORDS[hosts[0].id]) return false
  setProfileWords({ i18n, kind: hosts[0].id })
  return true
}
