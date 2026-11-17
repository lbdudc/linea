import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { answerCredentialRequest, parseCredentialRequest } from '@lbdudc/linea-git';
import { gitSettings, type GitSettings } from './git.js';

/**
 * `linea credential get|store|erase`: a git credential helper. A clone of an SPL asks it for the token when git talks to the host, so
 * `git push` works in it with no token written anywhere but `~/.linea` (or the environment). It answers only for the host LINEA is
 * set up for, and never prompts.
 *
 * https://git-scm.com/docs/git-credential — the request is `key=value` lines, the answer too.
 */

export const parseRequest = parseCredentialRequest;

/** The address git talks to for this host. */
export function hostOf(settings: GitSettings): URL | undefined {
  const { config } = settings;
  const address = config.provider === 'github' ? (config.github?.webUrl ?? 'https://github.com') : config.provider === 'local' ? config.local?.baseUrl : config.gitlab?.url;
  try {
    return address ? new URL(address) : undefined;
  } catch {
    return undefined;
  }
}

export function answer(input: string, settings: GitSettings): string {
  // a token of GitLab goes with any name but an empty one ("oauth2" is what it documents); GitHub takes "x-access-token"
  const username = settings.username ?? (settings.config.provider === 'github' ? 'x-access-token' : 'oauth2');
  return answerCredentialRequest(input, { host: hostOf(settings), username, token: settings.token });
}

/** What `linea credential <op>` prints for the request on stdin. */
export function credentialHelper(op: string | undefined, input: string, settings: () => GitSettings = gitSettings): string {
  if (op !== 'get') return '';
  try {
    return answer(input, settings());
  } catch {
    return ''; // not set up: say nothing, and git goes on to the next helper
  }
}

/**
 * Why git was left without access to a repository, in words: what is stored is for another host, nothing is stored, or the token was
 * sent and the host refused it. For the error of a clone, a pull or a push that git refused.
 */
export function whyNoAccess(url: string, settings: () => GitSettings = gitSettings): string {
  let have: GitSettings;
  try {
    have = settings();
  } catch (e) {
    return `Why: no git access is stored. ${(e as Error).message}`;
  }
  const wanted = (() => {
    try {
      return new URL(url);
    } catch {
      return undefined;
    }
  })();
  const stored = hostOf(have);
  const from = { environment: 'the environment (GITLAB_TOKEN / GITHUB_TOKEN / LINEA_GIT_TOKEN)', server: "LINEA's server", token: 'the token you gave' }[have.source];
  if (wanted && stored && wanted.host.toLowerCase() !== stored.host.toLowerCase()) {
    return `Why: the git access in use (from ${from}) is for ${stored.host}, and this repository is on ${wanted.host}. It is only given to the host it is for.`;
  }
  return (
    `Why: the host (${wanted?.host ?? 'the host'}) refused what git gave it: the token from ${from} may be wrong, expired, or lack the scope git needs ` +
    `(GitLab: read_repository and write_repository, or api; GitHub: repo), or git did not get it from linea's credential helper.\n` +
    `  To tell which: set LINEA_DEBUG=1, run the command again, and read ~/.linea/credential.log (no line = git never asked linea).`
  );
}

/**
 * With `LINEA_DEBUG=1`, one line per request in `~/.linea/credential.log`: when git asked, for which host, and whether the helper had
 * an answer (never the token). It is how to tell "git never asked linea" from "linea answered and the host said no".
 */
export function traceHelper(op: string | undefined, request: string, answer: string): void {
  if (!process.env['LINEA_DEBUG'] || !op) return;
  try {
    const home = path.join(process.env['LINEA_HOME'] ?? os.homedir(), '.linea');
    fs.mkdirSync(home, { recursive: true });
    const host = parseRequest(request)['host'] ?? '?';
    const outcome = op === 'why' ? `no access: ${answer}` : op !== 'get' ? 'ignored' : answer ? `answered as ${parseRequest(answer)['username']}` : 'no answer (not the host it has access for, or none stored)';
    fs.appendFileSync(path.join(home, 'credential.log'), `${new Date().toISOString()} ${op} host=${host}: ${outcome}\n`);
  } catch {
    /* a log must never get in the way */
  }
}
