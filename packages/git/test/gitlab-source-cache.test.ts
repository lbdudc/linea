import { afterEach, describe, expect, it, vi } from 'vitest'

// the client is replaced so that no GitLab is needed: what is checked is how many times the source asks it
const getTags = vi.fn()
const getTag = vi.fn()
const getRawFile = vi.fn()
const getFilePaths = vi.fn()
vi.mock('../src/gitlab/client.js', () => ({ createGitLabClient: () => ({ getTags, getTag, getRawFile, getFilePaths }) }))

const { GitLabPackageSource, forgetPackageTags } = await import('../src/packages/gitlab-source.js')

const source = (userId: string) => new GitLabPackageSource({ url: 'https://gitlab.example', token: 't', userId })

describe('GitLabPackageSource tag lookups', () => {
  afterEach(() => {
    getTags.mockReset()
    getTag.mockReset()
    vi.useRealTimers()
  })

  it('asks GitLab for the tags of a package once for the resolutions that follow each other', async () => {
    getTags.mockResolvedValue([{ name: 'v1.0.0' }, { name: 'v1.1.0' }, { name: 'nightly' }])
    const location = 'gitlab:linea/modules/cache-a'
    expect(await source('u1').listVersions({ location })).toEqual(['1.0.0', '1.1.0'])
    expect(await source('u1').listVersions({ location })).toEqual(['1.0.0', '1.1.0'])
    expect(getTags).toHaveBeenCalledTimes(1)
  })

  it('keeps what one user read apart from another user', async () => {
    getTags.mockResolvedValue([{ name: 'v1.0.0' }])
    const location = 'gitlab:linea/modules/cache-b'
    await source('u1').listVersions({ location })
    await source('u2').listVersions({ location })
    expect(getTags).toHaveBeenCalledTimes(2)
  })

  it('keeps what one GitLab said apart from another GitLab that has a project of the same path', async () => {
    getTags.mockResolvedValueOnce([{ name: 'v1.0.0' }]).mockResolvedValueOnce([{ name: 'v2.0.0' }])
    const location = 'gitlab:linea/modules/cache-host'
    const at = (url: string) => new GitLabPackageSource({ url, token: 't', userId: 'cli' })
    expect(await at('https://one.example').listVersions({ location })).toEqual(['1.0.0'])
    expect(await at('https://two.example').listVersions({ location })).toEqual(['2.0.0'])
    expect(getTags).toHaveBeenCalledTimes(2)
  })

  it('asks again once the minute is over, so a new release shows up', async () => {
    vi.useFakeTimers()
    getTags.mockResolvedValueOnce([{ name: 'v1.0.0' }]).mockResolvedValueOnce([{ name: 'v1.0.0' }, { name: 'v1.2.0' }])
    const location = 'gitlab:linea/modules/cache-c'
    expect(await source('u1').listVersions({ location })).toEqual(['1.0.0'])
    vi.advanceTimersByTime(61_000)
    expect(await source('u1').listVersions({ location })).toEqual(['1.0.0', '1.2.0'])
  })

  it('shows a version at once when it was just published, for every user, and leaves other packages alone', async () => {
    getTags.mockResolvedValue([{ name: 'v1.0.0' }])
    const mine = 'gitlab:linea/modules/cache-e'
    const other = 'gitlab:linea/modules/cache-f'
    await source('u1').listVersions({ location: mine })
    await source('u2').listVersions({ location: mine })
    await source('u1').listVersions({ location: other })
    expect(getTags).toHaveBeenCalledTimes(3)

    forgetPackageTags(mine)
    getTags.mockResolvedValue([{ name: 'v1.0.0' }, { name: 'v1.1.0' }])
    expect(await source('u1').listVersions({ location: mine })).toEqual(['1.0.0', '1.1.0'])
    expect(await source('u2').listVersions({ location: mine })).toEqual(['1.0.0', '1.1.0'])
    expect(await source('u1').listVersions({ location: other })).toEqual(['1.0.0']) // still remembered
    expect(getTags).toHaveBeenCalledTimes(5)
    forgetPackageTags('github:not/gitlab') // not a GitLab location: nothing to forget, nothing thrown
  })

  it('does not keep a failure', async () => {
    getTags.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 })).mockResolvedValueOnce([{ name: 'v2.0.0' }])
    const location = 'gitlab:linea/modules/cache-d'
    await expect(source('u1').listVersions({ location })).rejects.toThrow('boom')
    expect(await source('u1').listVersions({ location })).toEqual(['2.0.0'])
  })

  it('reads the revision of a tag once', async () => {
    getTags.mockResolvedValue([{ name: 'v1.0.0' }])
    getTag.mockResolvedValue({ commit: { id: 'abc' } })
    const location = 'gitlab:linea/modules/cache-e'
    const first = source('u1')
    await first.listVersions({ location })
    expect(await first.revision({ location, version: '1.0.0' })).toBe('abc')
    expect(await first.revision({ location, version: '1.0.0' })).toBe('abc')
    expect(getTag).toHaveBeenCalledTimes(1)
  })
})

describe('GitLabPackageSource when whoever asked has gone', () => {
  afterEach(() => {
    getTags.mockReset()
  })

  it('takes no further step once the signal is aborted', async () => {
    getTags.mockResolvedValue([{ name: 'v1.0.0' }])
    const controller = new AbortController()
    const gitlab = new GitLabPackageSource({ url: 'https://gitlab.example', token: 't', userId: 'u9', signal: controller.signal })
    const location = 'gitlab:linea/modules/cancel-a'
    expect(await gitlab.listVersions({ location })).toEqual(['1.0.0'])
    controller.abort()
    await expect(gitlab.listVersions({ location: 'gitlab:linea/modules/cancel-b' })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(gitlab.open({ location, version: '1.0.0' })).rejects.toMatchObject({ name: 'AbortError' })
    expect(getTags).toHaveBeenCalledTimes(1)
  })
})

describe('GitLabPackageSource reading what a user may not see, and what it kept', () => {
  afterEach(() => {
    getTags.mockReset()
    getRawFile.mockReset()
    vi.useRealTimers()
  })

  it('says a package is unreachable when GitLab answers 404, instead of "no versions"', async () => {
    getTags.mockRejectedValue(Object.assign(new Error('404 Project Not Found'), { status: 404 }))
    await expect(source('u7').listVersions({ location: 'gitlab:linea/modules/private-one' })).rejects.toThrow(/does not exist, or your GitLab account has no access/)
  })

  it('still lists no versions for a package that has no tags yet', async () => {
    getTags.mockResolvedValue([])
    expect(await source('u7').listVersions({ location: 'gitlab:linea/modules/untagged' })).toEqual([])
  })

  it('reads a file of a tag once, and again after ten minutes', async () => {
    vi.useFakeTimers()
    getTags.mockResolvedValue([{ name: 'v1.0.0' }])
    getRawFile.mockResolvedValue(Buffer.from('hello'))
    const location = 'gitlab:linea/modules/content-a'
    const read = async () => {
      const gitlab = source('u8')
      await gitlab.listVersions({ location })
      return (await gitlab.open({ location, version: '1.0.0' })).read({ path: 'spl.json' })
    }
    await read()
    await read()
    expect(getRawFile).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10 * 60_000 + 1000)
    await read()
    expect(getRawFile).toHaveBeenCalledTimes(2)
  })
})

describe('GitLabPackageSource reading the files of a listed version', () => {
  afterEach(() => {
    getTags.mockReset()
    getRawFile.mockReset()
    getFilePaths.mockReset()
  })

  it('fetches the files it is told will be read several at a time, ahead of the reads that come one after another', async () => {
    const paths = Array.from({ length: 24 }, (_, i) => `code/f${i}.js`)
    getTags.mockResolvedValue([{ name: 'v1.0.0' }])
    getFilePaths.mockResolvedValue(paths)
    let running = 0
    let peak = 0
    getRawFile.mockImplementation(async (_token: string, _id: string, path: string) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 10))
      running--
      return Buffer.from(path)
    })
    const location = 'gitlab:linea/modules/prefetch-a'
    const gitlab = source('u10')
    await gitlab.listVersions({ location })
    const files = await gitlab.open({ location, version: '1.0.0' })

    const listed = await files.list({ dir: 'code' })
    // listing alone fetches nothing: a check only lists, and reads the few files that decide something
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(getRawFile).not.toHaveBeenCalled()

    // what linea-core does when it is going to read all of them: say so, then read one after another
    files.prefetch?.(listed)
    for (const path of listed) expect(Buffer.from((await files.read({ path }))!).toString()).toBe(path)

    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(8)
    // each file was asked of GitLab once, however many reads and prefetches wanted it
    expect(getRawFile).toHaveBeenCalledTimes(24)
  })

  it('offers no fetching ahead for a package that is read from a working copy', async () => {
    getTags.mockResolvedValue([{ name: 'v1.0.0' }])
    getFilePaths.mockResolvedValue(['code/a.js', 'code/b.js'])
    getRawFile.mockResolvedValue(Buffer.from('x'))
    const location = 'gitlab:linea/modules/prefetch-b'
    const gitlab = new GitLabPackageSource({ url: 'https://gitlab.example', token: 't', userId: 'u11', overrides: { [location]: { version: '9.9.9', ref: 'main' } } })
    const files = await gitlab.open({ location, version: '9.9.9' })
    await files.list({ dir: 'code' })
    // a working copy changes under you: it offers no fetching ahead
    expect(files.prefetch).toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(getRawFile).not.toHaveBeenCalled()
  })
})

describe('GitLabPackageSource reads of a tagged version', () => {
  afterEach(() => {
    getRawFile.mockReset()
    getFilePaths.mockReset()
  })

  it('shares one call between resolutions that ask for the same file and tree at once', async () => {
    getRawFile.mockImplementation(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return Buffer.from('x') })
    getFilePaths.mockImplementation(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return ['code/a.js'] })
    const location = 'gitlab:linea/modules/inflight-a'
    const opened = await Promise.all([1, 2, 3].map(() => source('u1').open({ location, version: '1.0.0' })))
    const files = await Promise.all(opened.map((pkg) => pkg.read({ path: 'code/a.js' })))
    const trees = await Promise.all(opened.map((pkg) => pkg.list({ dir: 'code' })))
    expect(files.map((bytes) => Buffer.from(bytes as Uint8Array).toString())).toEqual(['x', 'x', 'x'])
    expect(trees).toEqual([['code/a.js'], ['code/a.js'], ['code/a.js']])
    expect(getRawFile).toHaveBeenCalledTimes(1)
    expect(getFilePaths).toHaveBeenCalledTimes(1)
  })
})
