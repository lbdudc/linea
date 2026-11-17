/**
 * The git hosts in memory: a test (of this library, of the LINEA server, of the CLI) starts one and points a provider at its `url`; the dev
 * stack serves them as a GitLab and a GitHub on a laptop. The behaviour any provider has to have is `describeGitProviderContract`, in
 * `@lbdudc/linea-git/contract` (it needs vitest, which this entry does not).
 */
export { createGitlabDoubleApp, startGitlabDouble } from './gitlab-double.js'
export { createGithubDoubleApp, startGithubDouble } from './github-double.js'
