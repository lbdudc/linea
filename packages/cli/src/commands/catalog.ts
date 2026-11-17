import { registerLocation } from '@lbdudc/linea-core';
import { createPackageSource } from '@lbdudc/linea-git';
import { parseFlags, flagString } from '../core/args.js';
import { catalogOf, gitSettings, type GitSettings } from '../core/git.js';
import type { Command } from './types.js';

const LOCATION = /^(gitlab|github):(.+)$/;

/** The catalog of this installation, or an error that says how to name one. */
function catalogOrFail(settings: GitSettings) {
  const catalog = catalogOf(settings);
  if (!catalog) {
    throw new Error('No registry is set: export LINEA_REGISTRY=gitlab:<group>/<repository> (or github:<owner>/<repository>), the repository that holds registry.json.');
  }
  return catalog;
}

const list: Command = {
  name: 'registry list',
  summary: 'The modules and metamodels registered in the registry (LINEA_REGISTRY)',
  usage: 'registry list [search] [--kind module|metamodel]',
  flags: ['--kind module|metamodel'],
  run: async ({ args, data }) => {
    const { positional, flags } = parseFlags(args, { value: { kind: undefined } });
    const kind = flagString(flags, 'kind');
    if (kind !== undefined && kind !== 'module' && kind !== 'metamodel') return 'Usage: registry list [search] [--kind module|metamodel]';
    const settings = gitSettings();
    const search = positional[0]?.toLowerCase();
    const entries = (await catalogOrFail(settings).list(kind ? { kind } : {})).filter((e) => !search || `${e.name} ${e.description ?? ''} ${e.location}`.toLowerCase().includes(search));
    data?.(entries);
    if (!entries.length) return `Nothing is registered in ${settings.config.registry}${search ? ` matching "${search}"` : ''}. Add a package with: registry add <location>`;
    return entries.map((e) => `  ${e.kind === 'module' ? 'module   ' : 'metamodel'}  ${e.name.padEnd(18)} ${e.location}${e.description ? `  — ${e.description}` : ''}`).join('\n');
  },
};

const add: Command = {
  name: 'registry add',
  summary: 'Register a package of the git host (it needs a published version) so that LINEA lists it',
  usage: 'registry add <gitlab:group/project|github:owner/repo>',
  run: async ({ args, setStatus, data }) => {
    const location = args.find((a) => !a.startsWith('-'));
    if (!location || !LOCATION.test(location)) return 'Usage: registry add <gitlab:group/project|github:owner/repo>   (module list --remote shows the packages of the host)';
    const settings = gitSettings();
    const catalog = catalogOrFail(settings);
    setStatus(`reading ${location}…`);
    const entry = await registerLocation({ catalog, source: createPackageSource(settings.config, { token: settings.token, userId: 'cli' }), location, addedBy: settings.username });
    data?.(entry);
    return `✓ Registered ${entry.kind} ${entry.name} (${entry.location}) in ${settings.config.registry}.`;
  },
};

const remove: Command = {
  name: 'registry remove',
  summary: 'Take a package out of the registry (the package itself is not touched)',
  usage: 'registry remove <location>',
  run: async ({ args }) => {
    const location = args.find((a) => !a.startsWith('-'));
    if (!location) return 'Usage: registry remove <location>';
    const settings = gitSettings();
    const catalog = catalogOrFail(settings);
    if (!(await catalog.get({ location }))) return `· ${location} is not registered: nothing changed.`;
    await catalog.remove({ location });
    return `✓ Removed ${location} from ${settings.config.registry}. SPLs can still use it: the registry only lists.`;
  },
};

export const catalogCommands: Command[] = [list, add, remove];
