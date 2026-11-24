/** The token is expired or revoked. Hosts raise their own class (GitLab's, from gitlab-commando); this one is for providers that have none. */
export class GitAuthError extends Error {
  status = 401

  constructor(message = 'unauthorized') {
    super(message)
    this.name = 'GitAuthError'
  }
}

/** The host refused or failed a request; `status` is the HTTP status when there was one. */
export class GitError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'GitError'
    if (status !== undefined) this.status = status
  }
}

/** A package from a place the deployment does not trust (packages carry scripts that run in the server). */
export class PackageNotAllowedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PackageNotAllowedError'
  }
}

/** There is no such package (or it is not a module / metamodel as asked). */
export class PackageNotFoundError extends Error {
  constructor(message = 'Package not found') {
    super(message)
    this.name = 'PackageNotFoundError'
  }
}

/** The version is already published: a tag does not move. */
export class PackageVersionExistsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PackageVersionExistsError'
  }
}

/** The version of a manifest cannot be published: it is not semver, or it is not greater than the last one published. */
export class PackageVersionInvalidError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PackageVersionInvalidError'
  }
}

/** The device authorization flow cannot go on: the code expired, the user refused, the host's app has it off, or the host has none. */
export class GitDeviceFlowError extends GitAuthError {
  reason: 'expired_token' | 'access_denied' | 'device_flow_disabled' | 'unsupported'

  constructor(reason: 'expired_token' | 'access_denied' | 'device_flow_disabled' | 'unsupported', message: string = reason) {
    super(message)
    this.name = 'GitDeviceFlowError'
    this.reason = reason
  }
}
