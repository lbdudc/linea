/** What the interface calls a git host. */
const NAMES = { local: 'LINEA', gitlab: 'GitLab', github: 'GitHub' }

export const hostName = (provider) => NAMES[provider] ?? 'GitLab'
