import { parseDeployConfig } from './deployConfig.js';
import { HOST_SCHEMAS } from './gitHostSchemas.js';

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const shown = (value, secret) => (secret ? '••••' : JSON.stringify(value));
// `${VAR}` in the file is the way to say "this comes from the environment": a secret written so is not copied into the database
const isPlaceholder = (raw) => typeof raw === 'string' && /\$\{\w+/.test(raw);

/**
 * What applying a config file would change here, and how to do it. `text` is a linea.config.yml; `current` says what is now
 * (`instance`: describeInstance(), `gitHosts`: describeGitHosts(), `plugins`: pluginHost.list() + getSettings). Pure: nothing is changed.
 * Returns `{ changes: [{ area, id, summary: [text], run }], notes, warnings }`; a change leaves out of `summary` nothing it will do. The
 * file never removes anything (a host or plugin it does not name stays as it is).
 */
export const planImport = async ({ text, current, env = process.env }) => {
  const parsed = parseDeployConfig(text, { env, name: 'The file' });
  const changes = [];
  const notes = [];

  // how this LINEA behaves
  const instance = await current.instance();
  for (const [key, value] of Object.entries(parsed.instance)) {
    if (instance.meta[key]?.locked) { notes.push(`instance.${key}: set in this deployment's linea.config.yml, not changed`); continue; }
    if (same(instance.values[key], value)) continue;
    changes.push({ area: 'instance', id: key, summary: [`${shown(instance.values[key])} → ${shown(value)}`], run: (apply) => apply.instance({ [key]: value }) });
  }

  // the git hosts
  const hosts = await current.gitHosts();
  for (const [kind, entry] of Object.entries(parsed.gitHosts)) {
    if (kind === 'primary') continue;
    const host = hosts.hosts.find((candidate) => candidate.id === kind);
    if (!host) continue;
    if (host.locked) { notes.push(`gitHosts.${kind}: set in this deployment's linea.config.yml, not changed`); continue; }
    const { enabled, ...settings } = entry;
    const summary = [];
    const patch = {};
    if (enabled !== undefined && enabled !== host.enabled) { summary.push(`enabled: ${host.enabled} → ${enabled}`); patch.enabled = enabled; }
    for (const [key, value] of Object.entries(settings)) {
      const secret = HOST_SCHEMAS[kind]?.[key]?.type === 'secret';
      if (secret && isPlaceholder(parsed.raw?.gitHosts?.[kind]?.[key])) { notes.push(`gitHosts.${kind}.${key}: a secret from the environment (${parsed.raw.gitHosts[kind][key]}), not copied`); continue; }
      if (secret ? host.values[key]?.isSet && value === '' : same(host.values[key], value)) continue;
      summary.push(`${key}: ${secret ? '' : `${shown(host.values[key])} → `}${shown(value, secret)}`);
      patch.settings = { ...patch.settings, [key]: value };
    }
    if (summary.length) changes.push({ area: 'git-host', id: kind, summary, run: (apply) => apply.gitHost(kind, patch) });
  }
  if (parsed.gitHosts.primary && parsed.gitHosts.primary !== hosts.primary) {
    if (hosts.primaryLocked) notes.push('gitHosts.primary: set in this deployment\'s linea.config.yml, not changed');
    else changes.push({ area: 'git-host', id: 'primary', summary: [`${hosts.primary} → ${parsed.gitHosts.primary}`], run: (apply) => apply.primary(parsed.gitHosts.primary) });
  }

  // the plugins
  const plugins = await current.plugins();
  for (const [id, entry] of Object.entries(parsed.declared)) {
    const plugin = plugins.find((candidate) => candidate.id === id);
    if (!plugin) { notes.push(`plugins.${id}: not a plugin of this LINEA, ignored`); continue; }
    if (plugin.declared) { notes.push(`plugins.${id}: set in this deployment's linea.config.yml, not changed`); continue; }
    const summary = [];
    const steps = [];
    if (!plugin.installed) { summary.push('install'); steps.push((apply) => apply.pluginInstall(id)); }
    const schema = plugin.settingsSchema ?? {};
    const now = plugin.installed ? (await current.pluginSettings(id)).values : {};
    const patch = {};
    for (const [key, value] of Object.entries(entry.settings ?? {})) {
      const secret = schema[key]?.type === 'secret';
      if (secret && isPlaceholder(parsed.raw?.plugins?.[id]?.settings?.[key])) { notes.push(`plugins.${id}.settings.${key}: a secret from the environment, not copied`); continue; }
      if (secret ? now[key]?.isSet && value === '' : same(now[key], value)) continue;
      summary.push(`${key}: ${secret ? '' : `${shown(now[key])} → `}${shown(value, secret)}`);
      patch[key] = value;
    }
    if (Object.keys(patch).length) steps.push((apply) => apply.pluginSettings(id, patch));
    if (entry.enabled !== plugin.enabled) { summary.push(entry.enabled ? 'enable' : 'disable'); steps.push((apply) => apply.pluginEnabled(id, entry.enabled)); }
    if (summary.length) changes.push({ area: 'plugin', id, summary, run: async (apply) => { for (const step of steps) await step(apply); } });
  }

  return { changes, notes, warnings: parsed.warnings };
};

/** Does the plan, change by change: one that fails is reported and the rest go on. */
export const applyImport = async (plan, apply) => {
  const results = [];
  for (const change of plan.changes) {
    try {
      await change.run(apply);
      results.push({ area: change.area, id: change.id, ok: true });
    } catch (error) {
      results.push({ area: change.area, id: change.id, ok: false, error: error.message });
    }
  }
  return results;
};

/** What the client gets of a plan: no code. */
export const describePlan = ({ changes, notes, warnings }) => ({ changes: changes.map(({ area, id, summary }) => ({ area, id, summary })), notes, warnings });
