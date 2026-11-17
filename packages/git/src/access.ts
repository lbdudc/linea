/**
 * How much a person may do in a repository, as numbers that grow with it. They are GitLab's own access levels (the other hosts map
 * what they have onto them), so a level read from any host compares with these.
 */
export const ACCESS = {
  /** Sees the repository exists. */
  MINIMAL: 5,
  GUEST: 10,
  /** Reads the code. */
  REPORTER: 20,
  /** Pushes to branches. */
  DEVELOPER: 30,
  /** Merges, and manages the repository's settings. */
  MAINTAINER: 40,
  /** Deletes it. */
  OWNER: 50
} as const

export type AccessLevel = (typeof ACCESS)[keyof typeof ACCESS]
