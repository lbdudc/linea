/**
 * The side of a git credential helper that does not depend on who runs it: git asks with `key=value` lines and takes the same as the
 * answer (https://git-scm.com/docs/git-credential). A helper answers only for the host it has access for, and never prompts.
 */

export function parseCredentialRequest (input: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of input.split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i > 0) fields[line.slice(0, i)] = line.slice(i + 1)
  }
  return fields
}

/**
 * What a helper says to a request: the username and password when the request is for `host` (same protocol, same host), nothing
 * otherwise (git goes on to the next helper).
 */
export function answerCredentialRequest (input: string, access: { host: URL | undefined, username: string, token: string }): string {
  const request = parseCredentialRequest(input)
  const { host } = access
  if (!host || !request['host']) return ''
  if (request['protocol'] && `${request['protocol']}:` !== host.protocol) return ''
  if (request['host'].toLowerCase() !== host.host.toLowerCase()) return ''
  return `username=${access.username}\npassword=${access.token}\n`
}
