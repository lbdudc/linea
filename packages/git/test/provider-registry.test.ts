import { afterEach, expect, test } from 'vitest'
import { createGitProvider, gitProviderKinds, registerGitProvider, unregisterGitProvider } from '../src/index.js'
import { gitConfigFromEnv } from '../src/config.js'
import { GitHubProvider } from '../src/github/provider.js'

const githubEnv = { GIT_PROVIDER: 'github', REDIRECT_URI: 'http://x', GITHUB_URL: 'http://gh', GITHUB_API_URL: 'http://gh', GITHUB_CLIENT_ID: 'a', GITHUB_CLIENT_SECRET: 'b' }

afterEach(() => {
  // the built-in GitHub is put back for the other tests
  if (!gitProviderKinds().includes('github')) {
    registerGitProvider('github', {
      create: (config) => new GitHubProvider({ config: config.github ?? {} }),
      cacheKey: (config) => `github|${config.github?.apiUrl ?? ''}`,
    })
  }
})

test('the local host, GitLab and GitHub are built in', () => {
  expect(gitProviderKinds().sort()).toEqual(['github', 'gitlab', 'local'])
})

test('a host that was unregistered is refused, and works again once registered', () => {
  const config = gitConfigFromEnv(githubEnv)
  expect(createGitProvider(config).kind).toBe('github')

  expect(unregisterGitProvider('github')).toBe(true)
  expect(() => createGitProvider(config)).toThrow(/github is not a git host this program offers \(local, gitlab\)/)

  registerGitProvider('github', {
    create: (c) => new GitHubProvider({ config: c.github ?? {} }),
    cacheKey: (c) => `github|${c.github?.apiUrl ?? ''}`,
  })
  expect(createGitProvider(config).kind).toBe('github')
})
