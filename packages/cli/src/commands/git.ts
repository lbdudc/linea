import { publishFolder } from '@lbdudc/linea-git';
import { gitProviderOf, gitSettings } from '../core/git.js';
import type { Command } from './types.js';
import { workdirOf } from './util.js';

const publish: Command = {
  name: 'publish',
  summary: 'Publish every module and metamodel of your workspace to your git host (one at a time: module publish)',
  usage: 'publish <group or owner> [name] [--dry-run]',
  run: async ({ args, session }) => {
    const dryRun = args.includes('--dry-run');
    const [root, only] = args.filter((a) => !a.startsWith('--'));
    if (!root) {
      return 'Usage: publish <group or owner> [name] [--dry-run]\n  GitLab: the path of a group that exists already (the packages go to <group>/modules and <group>/metamodels).\n  GitHub: the user or organisation that owns them.';
    }
    const settings = gitSettings();
    const lines: string[] = [];
    const published = await publishFolder({
      provider: gitProviderOf(settings),
      token: settings.token,
      dir: workdirOf(session),
      root,
      ...(only ? { only } : {}),
      dryRun,
      skipPublished: true,
      log: (line) => lines.push(line),
    });
    if (!published.length) return `Nothing to publish in ${workdirOf(session)}${only ? ` named "${only}"` : ''}. See /packages.`;
    const mark = { published: '✓ published', 'already-published': '· already published', 'dry-run': '… would publish' } as const;
    return [
      ...published.map((p) => `  ${mark[p.status]}  ${p.kind} ${p.name} v${p.version}  → ${p.path}`),
      ...(dryRun ? ['', 'Dry run: nothing was written.'] : ['', 'Raise the version in a manifest to publish a new version of it.']),
    ].join('\n');
  },
};

export const gitCommands: Command[] = [publish];
