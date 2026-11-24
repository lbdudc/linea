import path from 'node:path';
import type { Session } from '../commands/types.js';
import { configureClient } from './client.js';
import { config } from './config.js';
import { loadState, resolveMode, serverOf } from './credentials.js';
import { findContext, type FolderContext } from './context.js';
import { resolveWorkdir } from './workdir.js';

/**
 * The session a command runs in: what was stored (server, user, editor) plus where you are. There is no active SPL; the mode (server or offline) is the one thing that is kept:
 * standing in an SPL makes commands about it, and its parent folder is the workspace, the way standing in a repository makes it the
 * one `git` acts on.
 */
export function buildSession(opts: { cwd?: string } = {}): { session: Session; folder: FolderContext } {
  const stored = loadState();
  const baseUrl = serverOf(stored);
  const token = config.DEV_TOKEN || stored.token || '';
  configureClient({ baseUrl, token });
  const cwd = opts.cwd ?? process.cwd();
  const folder = findContext(cwd);
  // the SPLs of a workspace sit directly in it: the modules and metamodels they use are looked for next to them
  const workdir = folder.workspace ?? (folder.line ? path.dirname(folder.line.dir) : resolveWorkdir(stored.workdir));

  return {
    folder,
    session: {
      baseUrl,
      authed: Boolean(token),
      mode: resolveMode(stored),
      user: stored.user,
      workdir,
      cwd,
      ...(stored.editor ? { editor: stored.editor } : {}),
      ...(stored.theme ? { theme: stored.theme } : {}),
    },
  };
}
