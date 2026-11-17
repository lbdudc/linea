import { splalm } from '../core/client.js';
import type { ReconcileLinesResult, ReconcileProductsResult, SplalmNamespace } from '../core/types.js';
import type { Command } from './types.js';

/** What only LINEA's server can tell or do: the groups a new SPL can be made under, and rediscovering what its git host has. */

const namespaces: Command = {
  name: 'namespaces',
  summary: 'The groups (GitLab) or accounts (GitHub) a new SPL can be made under',
  usage: 'namespaces',
  requiresAuth: true,
  run: async () => {
    const all = (await splalm.get('/api/lines/namespaces')) as SplalmNamespace[];
    if (!all.length) return 'No groups available: the next SPL will get a new top-level group.';
    return ['Where an SPL can be made (use the id with: spl new <name> --namespace <id>):', ...all.map((n) => `  ${String(n.id).padEnd(24)} ${n.fullPath}`)].join('\n');
  },
};

const reconcile: Command = {
  name: 'reconcile',
  summary: 'Make LINEA rediscover the SPLs or products its git host has that it missed',
  usage: 'reconcile <spls|products> [--prune]',
  requiresAuth: true,
  run: async ({ args }) => {
    const subject = args.find((a) => !a.startsWith('--'));
    const which = subject === 'lines' ? 'spls' : subject;
    if (which !== 'spls' && which !== 'products') return 'Usage: reconcile <spls|products> [--prune]';
    const query = args.includes('--prune') ? '?prune=true' : '';

    if (which === 'spls') {
      const r = (await splalm.post(`/api/lines/reconcile${query}`)) as ReconcileLinesResult;
      return [
        `✓ Reconciled SPLs: ${r.created.length} created, ${r.skipped} already known${r.archived.length ? `, ${r.archived.length} archived` : ''}.`,
        ...r.created.map((c) => `  + ${c.name}`),
        ...r.archived.map((a) => `  - ${a.name} (archived: no longer on the git host)`),
      ].join('\n');
    }

    const r = (await splalm.post(`/api/products/reconcile${query}`)) as ReconcileProductsResult;
    return [
      `✓ Reconciled products: ${r.created.length} created, ${r.skipped} already known${r.unlinked.length ? `, ${r.unlinked.length} unlinked` : ''}${r.archived.length ? `, ${r.archived.length} archived` : ''}.`,
      ...r.created.map((c) => `  + ${c.name} (${c.lineName})`),
      ...r.unlinked.map((u) => `  ? ${u.name}: ${u.reason}`),
      ...r.archived.map((a) => `  - ${a.name ?? a.id} (archived)`),
    ].join('\n');
  },
};

export const serverCommands: Command[] = [namespaces, reconcile];
