import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { runCi } from '../src/cli.mjs'

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=ci@test', '-c', 'user.name=ci', ...args], { cwd, encoding: 'utf8' })
const run = async (cwd, ...argv) => {
  let out = ''
  let err = ''
  const code = await runCi({ argv, cwd, io: { out: (t) => { out += t }, err: (t) => { err += t } } })
  return { code, out, err }
}

describe('commit-lint and release-tag', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-release-'))
  // commit-lint reads these when it is not given the title or the range: set in a GitLab merge request pipeline, they would reach these tests
  const inherited = Object.fromEntries(['CI_MERGE_REQUEST_TITLE', 'CI_MERGE_REQUEST_DIFF_BASE_SHA', 'CI_COMMIT_SHA'].map((name) => [name, process.env[name]]))
  for (const name of Object.keys(inherited)) delete process.env[name]
  after(() => {
    for (const [name, value] of Object.entries(inherited)) if (value !== undefined) process.env[name] = value
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('commit-lint warns by default and fails with --strict', async () => {
    const ok = await run(tmp, 'commit-lint', '--title', 'feat(ui)!: nueva portada')
    assert.equal(ok.code, 0)
    const warn = await run(tmp, 'commit-lint', '--title', 'arreglos varios')
    assert.equal(warn.code, 0)
    assert.match(warn.err, /WARNING/)
    assert.equal((await run(tmp, 'commit-lint', '--title', 'arreglos varios', '--strict')).code, 1)
    assert.equal((await run(tmp, 'commit-lint', '--title', 'chore(generate): product x')).code, 0)
  })

  it('commit-lint reads the commits of a range', async () => {
    git(tmp, 'init', '-q', '-b', 'main')
    git(tmp, 'commit', '-q', '--allow-empty', '-m', 'chore: init')
    const base = git(tmp, 'rev-parse', 'HEAD').trim()
    git(tmp, 'commit', '-q', '--allow-empty', '-m', 'feat: algo')
    git(tmp, 'commit', '-q', '--allow-empty', '-m', 'cosas')
    const head = git(tmp, 'rev-parse', 'HEAD').trim()
    const result = await run(tmp, 'commit-lint', '--base', base, '--head', head)
    assert.match(result.err, /"cosas"/)
    assert.doesNotMatch(result.err, /feat: algo/)
  })

  it('release-tag creates tag and release once', async () => {
    const line = path.join(tmp, 'line')
    fs.mkdirSync(line)
    fs.writeFileSync(path.join(line, 'spl.json'), JSON.stringify({ version: '1.1.0' }))
    const tags = new Map()
    const releases = new Map()
    const provider = {
      getTag: async ({ tag }) => tags.get(tag) ?? null,
      getRelease: async ({ tag }) => releases.get(tag) ?? null,
      createTag: async ({ tag, ref }) => { tags.set(tag, { name: tag, commitId: ref }) },
      createRelease: async ({ tag, description }) => { releases.set(tag, { tag, description }) },
      listTags: async () => [],
      getCommits: async () => [{ shortId: 'abc1234', title: 'feat: portada nueva', message: 'feat: portada nueva', createdAt: '2026-01-01T00:00:00Z', authorName: 'x', webUrl: '' }],
      getRepository: async () => ({ path: 'g/p' })
    }
    const args = ['release-tag', '--line', line, '--project', '7', '--ref', 'deadbeef', '--server', 'http://x', '--token', 't']
    const call = async () => {
      let out = ''
      const code = await runCi({ argv: args, cwd: tmp, io: { out: (t) => { out += t }, err: () => {} }, deps: { providerFor: async () => provider } })
      return { code, out }
    }
    assert.equal((await call()).code, 0)
    assert.match(releases.get('v1.1.0').description, /Features/)
    assert.match(releases.get('v1.1.0').description, /portada nueva/)
    const again = await call()
    assert.match(again.out, /nothing to do/)
    assert.equal(releases.size, 1)
  })

  const fixture = () => {
    const line = fs.mkdtempSync(path.join(tmp, 'l-'))
    fs.writeFileSync(path.join(line, 'spl.json'), JSON.stringify({ version: '2.0.0' }))
    const tags = new Map()
    const releases = new Map()
    const provider = {
      getTag: async ({ tag }) => tags.get(tag) ?? null,
      getRelease: async ({ tag }) => releases.get(tag) ?? null,
      createTag: async ({ tag }) => { tags.set(tag, { name: tag }) },
      createRelease: async ({ tag }) => { if (provider.fail) throw new Error('boom'); releases.set(tag, { tag }) },
      listTags: async () => [],
      getCommits: async () => [],
      getRepository: async () => ({ path: 'g/p' }),
      fail: false
    }
    const call = async (...extra) => {
      let out = ''
      let err = ''
      const code = await runCi({ argv: ['release-tag', '--line', line, '--project', '7', '--ref', 'deadbeef', '--server', 'http://x', '--token', 't', ...extra], cwd: tmp, io: { out: (x) => { out += x }, err: (x) => { err += x } }, deps: { providerFor: async () => provider } })
      return { code, out, err }
    }
    return { provider, tags, releases, call, line }
  }

  it('release-tag finishes the release when a previous run left only the tag', async () => {
    const { provider, tags, releases, call } = fixture()
    provider.fail = true
    assert.equal((await call()).code, 1)
    assert.equal(tags.size, 1)
    provider.fail = false
    assert.equal((await call()).code, 0)
    assert.equal(releases.size, 1)
  })

  it('release-tag --dry-run creates nothing; a missing spl.json or token fails', async () => {
    const { tags, call, line } = fixture()
    assert.equal((await call('--dry-run')).code, 0)
    assert.equal(tags.size, 0)
    fs.rmSync(path.join(line, 'spl.json'))
    assert.equal((await call()).code, 1)
    delete process.env.LINEA_CI_TOKEN
    const noToken = await run(tmp, 'release-tag', '--line', line, '--project', '1', '--ref', 'abc1234')
    assert.equal(noToken.code, 1)
  })

  it('commit-lint lints draft titles, skips merges, rejects unsafe refs and survives a missing base', async () => {
    assert.equal((await run(tmp, 'commit-lint', '--title', 'Draft: cosas', '--strict')).code, 1)
    assert.equal((await run(tmp, 'commit-lint', '--title', 'Draft: fix: cosas', '--strict')).code, 0)
    assert.equal((await run(tmp, 'commit-lint', '--title', 'Merge branch x', '--strict')).code, 0)
    assert.equal((await run(tmp, 'commit-lint', '--base=--output=x', '--head', 'abc1234')).code, 1)
    const missingBase = await run(tmp, 'commit-lint', '--title', 'fix: a', '--base', 'deadbeef', '--head', 'cafebabe')
    assert.equal(missingBase.code, 0)
    assert.match(missingBase.err, /shallow/)
    assert.equal((await run(tmp, 'commit-lint', '--title', 'fix: a', '--base', 'deadbeef', '--head', 'cafebabe', '--strict')).code, 1)
  })
})
