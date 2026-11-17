import fs from 'node:fs';
import path from 'node:path';
import {
  GitCommandError,
  configureCredentials as configureCredentialsWith,
  credentialOptions as credentialOptionsWith,
  gitOk as gitOkLib,
  gitOkAsync as gitOkAsyncLib,
  isAuthFailure,
} from '@lbdudc/linea-git';

/**
 * Git, as this program uses it: the operations are linea-git's (`checkout`); what is here is what is of this program: which credential
 * helper git is given (this very program), and the words that tell a person how to get access when the host says no.
 */

export {
  changedCount,
  checkGitAccess,
  cloneUrlOf,
  git,
  gitAsync,
  isAuthFailure,
  isRepo,
  repoState,
  slug,
  type GitResult,
  type RepoState,
} from '@lbdudc/linea-git';
export { readOrigin, writeOrigin, type Origin } from '@lbdudc/linea-core/workspace';

const NO_ACCESS =
  '\n  git has no access to the host. Sign in again (login), or give a personal access token: login --token <token or file>' +
  '\n  (GitLab: the token needs read_repository and write_repository, or api; GitHub: repo). doctor --online tests it.';

/** What to add to what git said when it is an authentication failure: how to give git access. Nothing otherwise. */
export const accessHint = (said: string): string => (isAuthFailure(said) ? NO_ACCESS : '');

/** A failure of git that was the host refusing access says how to get it. */
const hinted = (e: unknown): unknown => (e instanceof GitCommandError && e.denied ? new Error(`${e.message}${NO_ACCESS}`) : e);

/** `git`, and the output; a failure throws with what git said (and how to get access, when that was the problem). */
export function gitOk(cwd: string | undefined, args: string[]): string {
  try {
    return gitOkLib(cwd, args);
  } catch (e) {
    throw hinted(e);
  }
}

export async function gitOkAsync(cwd: string | undefined, args: string[], opts: { onProgress?: (line: string) => void } = {}): Promise<string> {
  try {
    return await gitOkAsyncLib(cwd, args, opts);
  } catch (e) {
    throw hinted(e);
  }
}

// ---------------------------------------------------------------- credentials for git

/** What to run for `credential.helper`: this program, so `git push` finds the token with no token written in any repository. */
export function helperCommand(): string {
  const slash = (p: string) => p.replace(/\\/g, '/');
  // LINEA_ENTRY: the program to run as the helper when this process is not it (a test runner, an embedding program)
  const entry = process.env['LINEA_ENTRY'] ?? process.argv[1];
  const script = entry && fs.existsSync(entry) && !/^\/\$bunfs|^B:\/~BUN/.test(slash(entry)) ? entry : undefined;
  const runs = script && path.resolve(script) !== path.resolve(process.execPath);
  // a script run by bun reads the `.env` of the folder git is in: not the place to find out which server this is
  const program = script && /\.tsx$/.test(script) ? path.join(path.dirname(script), 'credential.ts') : script; // from the sources: see credential.ts
  const parts = [process.execPath, ...(runs ? ['--no-env-file', program as string] : []), 'credential'];
  return `!${parts.map((p) => `'${slash(p)}'`).join(' ')}`;
}

/** `-c` options that make git use our credential helper for this host, for a command that has no repository yet (clone). */
export const credentialOptions = (url: string): string[] => credentialOptionsWith(url, helperCommand());

/** The same, kept in the repository's own config, so `git pull/push` there find the token as well. */
export const configureCredentials = (dir: string, url: string): void => configureCredentialsWith(dir, url, helperCommand());
