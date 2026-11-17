import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { GitHubClient, GitHubProvider, GitLabProvider, LocalProvider, clearGitHubCache, generateChangelog, parseMessage, previousTag, referencesIn } from '../src/index.js'
import type { CommitSummary, GitProvider } from '../src/index.js'
import { startGithubDouble, startGitlabDouble } from '../src/testing/index.js'

const token = 't'

const commit = (title: string, body = '', n = 0): CommitSummary => ({
  shortId: `abc000${n}`.slice(-8), title, authorName: 'ana', createdAt: '2026-01-01T00:00:00Z', webUrl: `http://h/c/${n}`,
  message: body ? `${title}\n\n${body}` : title
})

/** A provider that answers only what the generator reads. */
const fake = ({ tags = [] as string[], commits = [] as CommitSummary[], issues = {} as Record<number, string>, mrs = {} as Record<number, string> } = {}) => {
  const calls: string[] = []
  const notFound = () => Object.assign(new Error('not found'), { status: 404 })
  const provider = {
    kind: 'local',
    getRepository: async () => ({ path: 'linea/git' }),
    listTags: async () => tags.map((name) => ({ name })),
    compare: async ({ from, to }: { from: string, to: string }) => { calls.push(`compare ${from}..${to}`); return { commits, files: [] } },
    getCommits: async ({ ref }: { ref: string }) => { calls.push(`commits ${ref}`); return commits },
    getIssue: async ({ number }: { number: number }) => { if (!issues[number]) throw notFound(); return { title: issues[number], webUrl: `http://h/issues/${number}` } },
    getMergeRequest: async ({ number }: { number: number }) => { if (!mrs[number]) throw notFound(); return { title: mrs[number], webUrl: `http://h/mrs/${number}` } }
  } as unknown as GitProvider
  return { provider, calls }
}

describe('parseMessage', () => {
  it('reads type, scope, description and the breaking mark', () => {
    expect(parseMessage('feat(ui): add a button')).toMatchObject({ type: 'feat', scope: 'ui', description: 'add a button', breaking: false })
    expect(parseMessage('fix!: drop the old api')).toMatchObject({ type: 'fix', scope: null, breaking: true })
  })

  it('reads BREAKING CHANGE: from the body', () => {
    const parsed = parseMessage('feat: new config', 'feat: new config\n\nBREAKING CHANGE: the file is now yaml\nand lives in .linea')
    expect(parsed.breaking).toBe(true)
    expect(parsed.breakingNote).toBe('the file is now yaml\nand lives in .linea')
  })

  it('keeps what does not follow the convention', () => {
    expect(parseMessage('Fixed the thing')).toMatchObject({ type: null, description: 'Fixed the thing', breaking: false })
  })
})

describe('referencesIn', () => {
  it('finds issues and merge requests once each, sorted', () => {
    expect(referencesIn('Closes #12, #3 and #12. Also !7')).toEqual([
      { kind: 'issue', number: 3 }, { kind: 'issue', number: 12 }, { kind: 'mergeRequest', number: 7 }
    ])
    expect(referencesIn('colour #fff and a#1 and &#12 and #0')).toEqual([])
  })

  it('leaves out references of another project, and is not slow on a long run of separators', () => {
    expect(referencesIn('see group/proj!5 and group/proj#6')).toEqual([])
    const started = Date.now()
    referencesIn(`${'-'.repeat(200_000)}x ${'./'.repeat(100_000)}`)
    expect(Date.now() - started).toBeLessThan(500)
  })
})

describe('previousTag', () => {
  const tags = ['v1.0.0', 'v1.2.0', 'v1.10.0', '2.0.0', 'v2.0.0-rc.1', 'nightly'].map((name) => ({ name }))
  it('is the greatest version lower than `to`', () => {
    expect(previousTag(tags, 'v1.10.0')).toBe('v1.2.0')
    expect(previousTag(tags, 'v1.2.0')).toBe('v1.0.0')
    expect(previousTag(tags, '2.0.0')).toBe('v1.10.0')
  })
  it('is the greatest version when `to` is not a version, and null when there is none before', () => {
    expect(previousTag(tags, 'main')).toBe('2.0.0')
    expect(previousTag(tags, 'v1.0.0')).toBeNull()
    expect(previousTag([], 'main')).toBeNull()
  })
  it('takes a prerelease `to` as lower than its release', () => {
    expect(previousTag(tags, 'v1.10.0-rc.1')).toBe('v1.2.0')
    expect(previousTag(tags, 'v2.0.0-rc.2')).toBe('v1.10.0')
  })
})

describe('generateChangelog', () => {
  it('groups conventional commits in sections, in a fixed order', async () => {
    const { provider, calls } = fake({
      tags: ['v1.0.0'],
      commits: [
        commit('fix(api): a crash #4', '', 1), commit('feat: search', '', 2), commit('perf: faster list', '', 3),
        commit('refactor: tidy up', '', 4), commit('feat(ui)!: new layout', '', 5)
      ],
      issues: { 4: 'It crashes' }
    })
    const result = await generateChangelog({ provider, token, id: 1, to: 'v1.1.0' })
    expect(calls).toEqual(['compare v1.0.0..v1.1.0'])
    expect(result.from).toBe('v1.0.0')
    expect(result.sections.map((section) => section.id)).toEqual(['breaking', 'features', 'fixes', 'performance', 'other'])
    expect(result.sections.map((section) => section.entries.length)).toEqual([1, 1, 1, 1, 1])
    expect(result.markdown).toContain('### Breaking changes')
    expect(result.markdown).toContain('- **ui:** new layout ([abc0005](http://h/c/5))')
    expect(result.markdown).toContain('- **api:** a crash [#4](http://h/issues/4) ([abc0001](http://h/c/1))')
    expect(result.issues).toEqual([{ kind: 'issue', number: 4, title: 'It crashes', webUrl: 'http://h/issues/4', resolved: true }])
    expect(result.commits).toHaveLength(5)
  })

  it('writes the notes in the language asked for, English by default', async () => {
    const { provider } = fake({ tags: ['v1.0.0'], commits: [commit('feat: a', '', 1)] })
    const es = await generateChangelog({ provider, token, id: 1, to: 'v1.0.1', locale: 'es' })
    expect(es.markdown).toContain('Cambios desde `v1.0.0`')
    expect((await generateChangelog({ provider, token, id: 1, to: 'v1.0.1' })).markdown).toContain('Changes since `v1.0.0`')
  })

  it('puts commits that do not follow the convention under «Other changes» and never loses them', async () => {
    const { provider } = fake({ commits: [commit('Fixed things', '', 1), commit('wip', '', 2), commit('feat: ok', '', 3)] })
    const result = await generateChangelog({ provider, token, id: 1, to: 'main' })
    const other = result.sections.find((section) => section.id === 'other')
    expect(other?.entries.map((entry) => entry.description)).toEqual(['Fixed things', 'wip'])
    expect(result.commits).toHaveLength(3)
  })

  it('hides chore, ci, test and docs unless asked, but a breaking one always shows', async () => {
    const commits = [commit('chore: deps', '', 1), commit('ci: pipeline', '', 2), commit('test: more', '', 3), commit('docs: readme', '', 4), commit('chore!: drop node 18', '', 5)]
    const { provider } = fake({ commits })
    const hidden = await generateChangelog({ provider, token, id: 1, to: 'main' })
    expect(hidden.commits.map((c) => c.shortId)).toEqual(['abc0005'])
    expect(hidden.sections.map((section) => section.id)).toEqual(['breaking'])
    const shown = await generateChangelog({ provider, token, id: 1, to: 'main', include: ['docs', 'ci'] })
    expect(shown.sections.find((section) => section.id === 'other')?.entries.map((entry) => entry.description)).toEqual(['pipeline', 'readme'])
  })

  it('treats a BREAKING CHANGE footer as incompatible and shows its note', async () => {
    const { provider } = fake({ commits: [commit('feat: new config', 'BREAKING CHANGE: now yaml', 1)] })
    const result = await generateChangelog({ provider, token, id: 1, to: 'main' })
    expect(result.sections[0]).toMatchObject({ id: 'breaking' })
    expect(result.markdown).toContain('new config — now yaml')
  })

  it('reads from the first commit when there is no previous tag', async () => {
    const { provider, calls } = fake({ tags: ['v2.0.0'], commits: [commit('feat: first', '', 1)] })
    const result = await generateChangelog({ provider, token, id: 1, to: 'v1.0.0' })
    expect(calls).toEqual(['commits v1.0.0'])
    expect(result.from).toBeNull()
    expect(result.markdown).not.toContain('Changes since')
  })

  it('uses `from` when it is given, even null', async () => {
    const { provider, calls } = fake({ tags: ['v1.0.0'], commits: [] })
    await generateChangelog({ provider, token, id: 1, to: 'v1.1.0', from: 'v0.9.0' })
    await generateChangelog({ provider, token, id: 1, to: 'v1.1.0', from: null })
    expect(calls).toEqual(['compare v0.9.0..v1.1.0', 'commits v1.1.0'])
  })

  it('has an empty range with no sections', async () => {
    const { provider } = fake({ tags: ['v1.0.0'], commits: [] })
    const result = await generateChangelog({ provider, token, id: 1, to: 'v1.0.1' })
    expect(result).toMatchObject({ sections: [], commits: [], issues: [], mergeRequests: [] })
    expect(result.markdown).toBe('## v1.0.1\n\nChanges since `v1.0.0`.\n\n_No changes._\n')
  })

  it('ignores merges, version bumps and what LINEA generates, by default', async () => {
    const { provider } = fake({
      commits: [
        commit("Merge branch 'x' into 'main'", 'See merge request !9', 1), commit('chore(release): 1.2.0', '', 2), commit('Bump version to 1.2.0', '', 3),
        commit('1.2.0', '', 4), commit('linea: generate product', '', 5), commit('feat: kept', '', 7)
      ],
      mrs: { 9: 'The merge' }
    })
    const result = await generateChangelog({ provider, token, id: 1, to: 'main' })
    expect(result.commits.map((c) => c.title)).toEqual(['feat: kept'])
    // the merge request of a dropped merge is still reported
    expect(result.mergeRequests.map((mr) => mr.number)).toEqual([9])
    const all = await generateChangelog({ provider, token, id: 1, to: 'main', ignoreDefaults: false })
    // (the release bump is a chore, hidden anyway)
    expect(all.commits.length).toBe(4)
  })

  it('keeps real commits whose title starts like a bump or a sync', async () => {
    const { provider } = fake({
      commits: [
        commit('Release the lock on failure', '', 1), commit('Version selector shows wrong value', '', 2), commit('sync: fix race in queue', '', 3),
        commit('chore(release): 1.2.3', '', 4), commit('chore: release v1.2.3 [skip ci]', '', 5), commit('Release 1.2.3', '', 6), commit('Bump version to 1.2.3', '', 7)
      ]
    })
    const result = await generateChangelog({ provider, token, id: 1, to: 'main', include: ['chore'] })
    expect(result.commits.map((c) => c.title)).toEqual(['Release the lock on failure', 'Version selector shows wrong value', 'sync: fix race in queue'])
  })

  it('reports the merge requests that GitLab merges name, only those of this repository', async () => {
    const { provider } = fake({
      commits: [
        commit("Merge branch 'a' into 'main'", "Fix it\n\nSee merge request linea/git!7", 1),
        commit("Merge branch 'b' into 'main'", 'See merge request other/project!8', 2)
      ],
      mrs: { 7: 'Seven', 8: 'Eight' }
    })
    const result = await generateChangelog({ provider, token, id: 1, to: 'main' })
    expect(result.mergeRequests.map((m) => [m.number, m.resolved])).toEqual([[7, true]])
  })

  it('finds a BREAKING CHANGE footer at the end of a very long message', async () => {
    const { provider } = fake({ commits: [commit('feat: big', `${'x'.repeat(50_000)}\n\nBREAKING CHANGE: it moved`, 1)] })
    const result = await generateChangelog({ provider, token, id: 1, to: 'main' })
    expect(result.sections[0]).toMatchObject({ id: 'breaking' })
  })

  it('keeps "Release 1.2.3 notes page redesign" and orders by instant, not by text', async () => {
    const { provider } = fake({
      commits: [
        { ...commit('fix: late in Madrid', '', 1), createdAt: '2026-01-01T00:30:00+02:00' },
        { ...commit('fix: earlier in UTC', '', 2), createdAt: '2025-12-31T23:00:00Z' },
        commit('Release 1.2.3 notes page redesign', '', 3), commit('Release 1.2.3 [skip ci]', '', 4)
      ]
    })
    const result = await generateChangelog({ provider, token, id: 1, to: 'main' })
    expect(result.commits.map((c) => c.title)).toEqual(['Release 1.2.3 notes page redesign', 'fix: earlier in UTC', 'fix: late in Madrid'])
  })

  it('only links web addresses, with parentheses and spaces encoded', async () => {
    const { provider } = fake({ commits: [{ ...commit('fix: a', '', 1), webUrl: 'http://h/c/(1) x' }, { ...commit('fix: b', '', 2), webUrl: 'javascript:alert(1)' }] })
    const { markdown } = await generateChangelog({ provider, token, id: 1, to: 'main' })
    expect(markdown).toContain('(http://h/c/%281%29%20x)')
    expect(markdown).not.toContain('javascript')
  })

  it('takes extra ignore patterns', async () => {
    const { provider } = fake({ commits: [commit('feat: a', '', 1), commit('feat: skip me', '', 2)] })
    const result = await generateChangelog({ provider, token, id: 1, to: 'main', ignore: [/skip me/] })
    expect(result.commits.map((c) => c.title)).toEqual(['feat: a'])
  })

  it('resolves #N to an issue or to a merge request, and leaves a missing one plain', async () => {
    const { provider } = fake({
      commits: [commit('fix: a #1 #2 #3 !5', '', 1)],
      issues: { 1: 'Issue one' }, mrs: { 2: 'Pull two', 5: 'MR five' }
    })
    const result = await generateChangelog({ provider, token, id: 1, to: 'main' })
    // «local» keeps issue and merge request numbers apart: an unknown #2 stays an issue, plain
    expect(result.issues.map((i) => i.number)).toEqual([1, 2, 3])
    expect(result.mergeRequests.map((m) => m.number)).toEqual([5])
    expect(result.issues.find((i) => i.number === 3)).toMatchObject({ resolved: false, webUrl: '' })
    expect(result.markdown).toContain('a [#1](http://h/issues/1) #2 #3 [!5](http://h/mrs/5) (')
  })

  it('does not turn an unknown #N into a merge request unless the host shares the numbers (GitHub)', async () => {
    const { provider } = fake({ commits: [commit('fix: a #2', '', 1)], mrs: { 2: 'Unrelated MR' } })
    const result = await generateChangelog({ provider, token, id: 1, to: 'main' })
    expect(result.mergeRequests).toEqual([])
    expect(result.issues).toMatchObject([{ number: 2, resolved: false }])
    ;(provider as unknown as { kind: string }).kind = 'github'
    const github = await generateChangelog({ provider, token, id: 1, to: 'main' })
    expect(github.mergeRequests).toMatchObject([{ number: 2, title: 'Unrelated MR', resolved: true }])
  })

  it('orders entries the same whatever order the host answers', async () => {
    const commits = [commit('fix: a', '', 1), commit('fix: b', '', 2), commit('fix: c', '', 3)].map((c, i) => ({ ...c, createdAt: `2026-01-0${i + 1}T00:00:00Z` }))
    const [asc, desc] = [fake({ commits }).provider, fake({ commits: [...commits].reverse() }).provider]
    const [a, b] = [await generateChangelog({ provider: asc, token, id: 1, to: 'main' }), await generateChangelog({ provider: desc, token, id: 1, to: 'main' })]
    expect(a.markdown).toBe(b.markdown)
    expect(a.commits.map((c) => c.description)).toEqual(['c', 'b', 'a'])
  })

  it('says when the history without a previous tag was cut', async () => {
    const many = Array.from({ length: 100 }, (_, i) => commit(`fix: n${i}`, '', i))
    const result = await generateChangelog({ provider: fake({ commits: many }).provider, token, id: 1, to: 'main' })
    expect(result.truncated).toBe(true)
    expect(result.markdown).toContain('Incomplete history')
    expect((await generateChangelog({ provider: fake({ commits: many.slice(0, 5) }).provider, token, id: 1, to: 'main' })).truncated).toBe(false)
  })

  it('makes the text of a commit plain: no links, images, html or sections from it', async () => {
    const { provider } = fake({ commits: [commit('feat(a*b): [click](https://evil) ![x](https://t/p.png) <b>hi</b>', 'BREAKING CHANGE: <script>x</script>\n### Fake', 1)] })
    const { markdown } = await generateChangelog({ provider, token, id: 1, to: 'main', title: 'v1\n# Injected' })
    expect(markdown).not.toMatch(/(^|[^\\])\[click\]/)
    expect(markdown).not.toContain('<b>')
    expect(markdown).not.toContain('<script>')
    expect(markdown).not.toMatch(/^# Injected/m)
    expect(markdown).toContain('\\[click\\]')
  })

  it('refuses a ref that starts with a dash', async () => {
    const { provider } = fake()
    await expect(generateChangelog({ provider, token, id: 1, to: '--output=/tmp/x' })).rejects.toMatchObject({ status: 400 })
    await expect(generateChangelog({ provider, token, id: 1, to: 'main', from: '-x' })).rejects.toMatchObject({ status: 400 })
  })

  it('resolves at most a few hundred references', async () => {
    const refs = Array.from({ length: 300 }, (_, i) => `#${i + 1}`).join(' ')
    const { provider } = fake({ commits: [commit(`fix: many ${refs}`, '', 1)] })
    let calls = 0
    ;(provider as unknown as { getIssue: () => Promise<unknown> }).getIssue = async () => { calls++; return { title: 't', webUrl: 'u' } }
    const result = await generateChangelog({ provider, token, id: 1, to: 'main' })
    expect(calls).toBeLessThanOrEqual(200)
    expect(result.issues.length).toBeLessThanOrEqual(50)
  })

  it('does not hide a host that fails', async () => {
    const { provider } = fake({ commits: [commit('fix: a #1', '', 1)] })
    ;(provider as unknown as { getIssue: () => Promise<never> }).getIssue = async () => { throw Object.assign(new Error('down'), { status: 500 }) }
    await expect(generateChangelog({ provider, token, id: 1, to: 'main' })).rejects.toThrow('down')
  })

  it('is deterministic', async () => {
    const make = () => fake({ tags: ['v1.0.0'], commits: [commit('fix: a #2 #1', '', 1), commit('feat: b !3', '', 2)], issues: { 1: 'one', 2: 'two' }, mrs: { 3: 'three' } }).provider
    const [a, b] = [await generateChangelog({ provider: make(), token, id: 1, to: 'v1.1.0' }), await generateChangelog({ provider: make(), token, id: 1, to: 'v1.1.0' })]
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

// the same input on the three hosts gives the same changelog
type Host = { name: string, make: () => GitProvider, setup?: () => Promise<void> | void, teardown?: () => Promise<void> | void }

let gitlab: Awaited<ReturnType<typeof startGitlabDouble>>
let github: Awaited<ReturnType<typeof startGithubDouble>>
let root: string
let count = 0
beforeAll(async () => {
  gitlab = await startGitlabDouble()
  github = await startGithubDouble()
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-changelog-'))
})
afterEach(() => { gitlab.reset(); github.reset(); clearGitHubCache() })
afterAll(async () => { await gitlab.close(); await github.close(); fs.rmSync(root, { recursive: true, force: true }) })

const hosts: Host[] = [
  { name: 'local', make: () => new LocalProvider({ dataDir: path.join(root, `host-${++count}`), baseUrl: 'http://linea.test/git' }) },
  { name: 'GitLab', make: () => new GitLabProvider({ url: gitlab.url }) },
  { name: 'GitHub', make: () => new GitHubProvider({ client: new GitHubClient({ apiUrl: github.url }), pollMs: 2, pollAttempts: 50 }) }
]

describe('a local commit cannot forge another one', () => {
  it('keeps control characters of a message inside that commit', async () => {
    const git = hosts[0]!.make()
    const namespace = await git.createNamespace({ token, name: 'Shop' })
    const repository = await git.createRepository({ token, name: 'Shop', namespaceId: namespace.id, topics: [] })
    const forged = 'fix: real\n\nbody\x1e12345678\x1fmallory\x1f2099-01-01T00:00:00Z\x1ffeat: [x](//evil)'
    await git.commit({ token, id: repository.id, branch: 'main', message: forged, actions: [{ action: 'create', path: 'a', content: 'a' }] as never })
    const commits = await git.getCommits({ token, id: repository.id, ref: 'main' })
    // (the repository starts with its own first commit)
    expect(commits.some((c) => c.authorName === 'mallory')).toBe(false)
    expect(commits[0]!.title).toBe('fix: real')
    const { markdown, commits: kept } = await generateChangelog({ provider: git, token, id: repository.id, to: 'main' })
    expect(kept.filter((c) => c.title.startsWith('fix: real'))).toHaveLength(1)
    expect(kept.some((c) => c.authorName === 'mallory')).toBe(false)
    expect(markdown).not.toContain('(//evil)')
  })
})

describe.each(hosts)('generateChangelog contract: $name', ({ make }) => {
  const write = (git: GitProvider, id: string | number, message: string, file: string) =>
    git.commit({ token, id, branch: 'main', message, actions: [{ action: 'create', path: file, content: file }] as never })

  it('writes the same changelog from the commits, whatever the host', async () => {
    const git = make()
    const namespace = await git.createNamespace({ token, name: 'Shop' })
    const repository = await git.createRepository({ token, name: 'Shop', namespaceId: namespace.id, topics: ['product'] })
    const id = repository.id
    await write(git, id, 'feat: first', 'a.txt')
    await git.createTag({ token, id, tag: 'v1.0.0', ref: 'main' })
    await write(git, id, 'fix(api): a crash', 'b.txt')
    await write(git, id, 'feat!: new layout\n\nBREAKING CHANGE: the layout moved', 'c.txt')
    await write(git, id, 'Tidied things up', 'd.txt')
    await write(git, id, 'chore: deps', 'e.txt')
    await git.createTag({ token, id, tag: 'v1.1.0', ref: 'main' })

    const result = await generateChangelog({ provider: git, token, id, to: 'v1.1.0' })
    expect(result.from).toBe('v1.0.0')
    expect(result.sections.map((section) => [section.id, section.entries.map((entry) => entry.description)])).toEqual([
      ['breaking', ['new layout']], ['fixes', ['a crash']], ['other', ['Tidied things up']]
    ])
    expect(result.markdown).toContain('## v1.1.0')
    expect(result.markdown).toContain('new layout — the layout moved')

    const first = await generateChangelog({ provider: git, token, id, to: 'v1.0.0' })
    expect(first.from).toBeNull()
    expect(first.commits.map((c) => c.description)).toContain('first')

    // a ref that is an option for git is refused, not run
    await expect(generateChangelog({ provider: git, token, id, to: '--output=/tmp/linea-changelog-must-not-exist' })).rejects.toBeTruthy()
    expect(fs.existsSync('/tmp/linea-changelog-must-not-exist')).toBe(false)
  })
})
