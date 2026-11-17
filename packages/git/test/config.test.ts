import { describe, expect, it } from 'vitest'
import { GitHubPackageSource, GitHubProvider, GitLabPackageSource, GitLabProvider, buildAuthorizeUrl, createGitProvider, createPackageSource, gitConfigFromEnv, gitProviderFactory, githubApiUrl, githubWebUrl } from '../src/index.js'

const ENV = {
  GIT_PROVIDER: 'github',
  GITLAB_HOSTNAME: 'https://gitlab.example.com',
  GITLAB_CLIENT_ID: 'gl-id',
  GITLAB_SECRET_ID: 'gl-secret',
  GITHUB_CLIENT_ID: 'gh-id',
  GITHUB_CLIENT_SECRET: 'gh-secret',
  REDIRECT_URI: 'http://localhost:9000',
  LINEA_TRUSTED_NAMESPACES: 'registry, github:acme',
  LINEA_GITHUB_OWNERS: 'acme, other',
  LINEA_REGISTRY: ' gitlab:linea/registry '
}

describe('gitConfigFromEnv', () => {
  it('reads what the LINEA server has always been given', () => {
    const config = gitConfigFromEnv(ENV)
    expect(config.provider).toBe('github')
    expect(config.gitlab).toMatchObject({ url: 'https://gitlab.example.com', clientId: 'gl-id', clientSecret: 'gl-secret', redirectUri: 'http://localhost:9000/login' })
    expect(config.github).toMatchObject({ clientId: 'gh-id', clientSecret: 'gh-secret', redirectUri: 'http://localhost:9000/login' })
    expect(config.trustedNamespaces).toEqual(['registry', 'github:acme'])
    expect(config.githubOwners).toEqual(['acme', 'other'])
    expect(config.registry).toBe('gitlab:linea/registry')
  })

  it('has no registry unless one is named', () => {
    expect(gitConfigFromEnv({ ...ENV, LINEA_REGISTRY: '  ' }).registry).toBeUndefined()
  })

  it('is GitLab unless it is told otherwise, and refuses a host it does not know', () => {
    expect(gitConfigFromEnv({ GITLAB_HOSTNAME: 'https://g' }).provider).toBe('gitlab')
    expect(() => gitConfigFromEnv({ GIT_PROVIDER: 'bitbucket' })).toThrow(/not a git host/)
  })

  it('takes the older name of the GitHub API setting', () => {
    expect(gitConfigFromEnv({ LINEA_GITHUB_API: 'https://ghe/api/v3' }).github?.apiUrl).toBe('https://ghe/api/v3')
  })
})

describe('createGitProvider', () => {
  it('makes the provider of the host, a new one each time (it remembers what it did)', () => {
    const github = createGitProvider(gitConfigFromEnv(ENV))
    expect(github).toBeInstanceOf(GitHubProvider)
    const factory = gitProviderFactory(() => gitConfigFromEnv({ ...ENV, GIT_PROVIDER: 'gitlab' }))
    expect(factory()).toBeInstanceOf(GitLabProvider)
    expect(factory()).not.toBe(factory())
  })

  it('asks for the address of GitLab when GitLab is the host', () => {
    expect(() => createGitProvider({ provider: 'gitlab', gitlab: { url: '' } })).toThrow(/GITLAB_HOSTNAME/)
  })

  it('says how to log in on each host', () => {
    const gitlab = createGitProvider(gitConfigFromEnv({ ...ENV, GIT_PROVIDER: 'gitlab' })).authConfig()
    expect(gitlab).toMatchObject({ kind: 'gitlab', authorizeUrl: 'https://gitlab.example.com/oauth/authorize', scope: 'api', clientId: 'gl-id' })
    const github = createGitProvider(gitConfigFromEnv(ENV)).authConfig()
    expect(github).toMatchObject({ kind: 'github', authorizeUrl: 'https://github.com/login/oauth/authorize', clientId: 'gh-id' })
    expect(github.scope).toContain('repo')
  })
})

describe('buildAuthorizeUrl', () => {
  it('puts the client, where to come back to, the state and what to ask for on the address of the host', () => {
    const url = new URL(buildAuthorizeUrl({
      auth: createGitProvider(gitConfigFromEnv(ENV)).authConfig(),
      redirectUri: 'http://127.0.0.1:8123/callback',
      state: 'abc'
    }))
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('gh-id')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8123/callback')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('abc')
    expect(url.searchParams.get('scope')).toContain('delete_repo')
  })
})

describe('where GitHub is', () => {
  it('is github.com unless it is said otherwise, and an Enterprise server has its API under /api/v3', () => {
    expect(githubWebUrl()).toBe('https://github.com')
    expect(githubApiUrl()).toBe('https://api.github.com')
    expect(githubApiUrl({ webUrl: 'https://ghe.example.com/' })).toBe('https://ghe.example.com/api/v3')
    expect(githubApiUrl({ webUrl: 'https://ghe.example.com', apiUrl: 'https://api.ghe.example.com/' })).toBe('https://api.ghe.example.com')
  })
})

describe('createPackageSource: where packages may come from', () => {
  const sourceOf = (trusted: string[]) =>
    createPackageSource({ ...gitConfigFromEnv(ENV), trustedNamespaces: trusted }, { token: 't', userId: 'u' })

  it('reads the host a location names, and refuses one it has no source for', async () => {
    const source = createPackageSource(gitConfigFromEnv({ ...ENV, LINEA_TRUSTED_NAMESPACES: '' }), { token: 't', userId: 'u' })
    await expect((async () => source.listVersions({ location: 'ftp:somewhere/x' }))()).rejects.toThrow(/not a location any registry here reads/)
  })

  it('limits GitLab to the paths it is given and GitHub to the owners it is given', async () => {
    const source = sourceOf(['registry', 'github:acme'])
    await expect(source.listVersions({ location: 'gitlab:elsewhere/mod' })).rejects.toThrow(/outside the trusted namespaces/)
    await expect(source.listVersions({ location: 'github:evil/mod' })).rejects.toThrow(/outside the trusted namespaces/)
  })

  it('trusts nothing from a host the list does not mention', async () => {
    const onlyGitHub = sourceOf(['github:acme'])
    await expect(onlyGitHub.listVersions({ location: 'gitlab:registry/mod' })).rejects.toThrow(/outside the trusted namespaces/)
    const onlyGitLab = sourceOf(['registry'])
    await expect(onlyGitLab.listVersions({ location: 'github:acme/mod' })).rejects.toThrow(/outside the trusted namespaces/)
  })

  it('takes a token per host, so a person on both hosts reads both', async () => {
    const source = createPackageSource(gitConfigFromEnv({ ...ENV, GIT_PROVIDER: 'gitlab', LINEA_TRUSTED_NAMESPACES: 'registry' }), { token: 'gl', tokens: { github: 'gh' }, userId: 'u' })
    await expect(source.listVersions({ location: 'github:acme/mod' })).rejects.toThrow(/outside the trusted namespaces/) // the GitHub source exists and is limited
  })

  it('knows the classes of each host', () => {
    expect(new GitLabPackageSource({ url: 'https://g', token: 't', userId: 'u' })).toBeInstanceOf(GitLabPackageSource)
    expect(new GitHubPackageSource({ userId: 'u' })).toBeInstanceOf(GitHubPackageSource)
  })
})
