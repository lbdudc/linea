import { createRecent } from '../recent.js'

/**
 * What the token of a user could see of the catalog a moment ago. The form asks for the list every time it opens, and a list is a GitLab
 * call per package. Keyed per user and registry (what is visible depends on the token), and short: whatever changes the catalog or publishes
 * a package clears it, and what changes it from outside (another server, GitLab itself) shows after the time is up.
 */
export const packageLists = createRecent({ ttlMs: 30_000, limit: 200 })
