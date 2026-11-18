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
    changes.push({
      area: 'instance', id: key, summary: [`${shown(instance.values[key])} → ${shown(value)}`], rows: [{ key, before: shown(instance.values[key]), after: shown(value) }],
      before: { instance: { [key]: instance.values[key] } }, run: (apply) => apply.instance({ [key]: value }),
    });
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
    const rows = [];
    const patch = {};
    const before = {};
    if (enabled !== undefined && enabled !== host.enabled) { summary.push(`enabled: ${host.enabled} → ${enabled}`); rows.push({ key: 'enabled', before: String(host.enabled), after: String(enabled) }); patch.enabled = enabled; before.enabled = host.enabled; }
    for (const [key, value] of Object.entries(settings)) {
      const secret = HOST_SCHEMAS[kind]?.[key]?.type === 'secret';
      if (secret && isPlaceholder(parsed.raw?.gitHosts?.[kind]?.[key])) { notes.push(`gitHosts.${kind}.${key}: a secret from the environment (${parsed.raw.gitHosts[kind][key]}), not copied`); continue; }
      if (secret ? host.values[key]?.isSet && value === '' : same(host.values[key], value)) continue;
      summary.push(`${key}: ${secret ? '' : `${shown(host.values[key])} → `}${shown(value, secret)}`);
      rows.push({ key, before: secret ? (host.values[key]?.isSet ? '••••' : '') : shown(host.values[key]), after: shown(value, secret) });
      patch.settings = { ...patch.settings, [key]: value };
      if (!secret) before.settings = { ...before.settings, [key]: host.values[key] ?? null };
    }
    if (summary.length) changes.push({ area: 'git-host', id: kind, summary, rows, before: { gitHost: { kind, patch: before } }, run: (apply) => apply.gitHost(kind, patch) });
  }
  if (parsed.gitHosts.primary && parsed.gitHosts.primary !== hosts.primary) {
    if (hosts.primaryLocked) notes.push('gitHosts.primary: set in this deployment\'s linea.config.yml, not changed');
    else changes.push({ area: 'git-host', id: 'primary', summary: [`${hosts.primary} → ${parsed.gitHosts.primary}`], rows: [{ key: 'primary', before: hosts.primary, after: parsed.gitHosts.primary }], before: { primary: hosts.primary }, run: (apply) => apply.primary(parsed.gitHosts.primary) });
  }

  // the plugins
  const plugins = await current.plugins();
  for (const [id, entry] of Object.entries(parsed.declared)) {
    const plugin = plugins.find((candidate) => candidate.id === id);
    if (!plugin) { notes.push(`plugins.${id}: not a plugin of this LINEA, ignored`); continue; }
    if (plugin.declared) { notes.push(`plugins.${id}: set in this deployment's linea.config.yml, not changed`); continue; }
    const summary = [];
    const rows = [];
    const steps = [];
    const before = { enabled: plugin.enabled, settings: {} };
    if (!plugin.installed) { summary.push('install'); rows.push({ key: 'install', before: 'no', after: 'yes' }); steps.push((apply) => apply.pluginInstall(id)); }
    const schema = plugin.settingsSchema ?? {};
    const now = plugin.installed ? (await current.pluginSettings(id)).values : {};
    const patch = {};
    for (const [key, value] of Object.entries(entry.settings ?? {})) {
      const secret = schema[key]?.type === 'secret';
      if (secret && isPlaceholder(parsed.raw?.plugins?.[id]?.settings?.[key])) { notes.push(`plugins.${id}.settings.${key}: a secret from the environment, not copied`); continue; }
      if (secret ? now[key]?.isSet && value === '' : same(now[key], value)) continue;
      summary.push(`${key}: ${secret ? '' : `${shown(now[key])} → `}${shown(value, secret)}`);
      rows.push({ key, before: secret ? (now[key]?.isSet ? '••••' : '') : shown(now[key]), after: shown(value, secret) });
      patch[key] = value;
      if (!secret) before.settings[key] = now[key] ?? null;
    }
    if (Object.keys(patch).length) steps.push((apply) => apply.pluginSettings(id, patch));
    if (entry.enabled !== plugin.enabled) { summary.push(entry.enabled ? 'enable' : 'disable'); rows.push({ key: 'enabled', before: String(Boolean(plugin.enabled)), after: String(Boolean(entry.enabled)) }); steps.push((apply) => apply.pluginEnabled(id, entry.enabled)); }
    if (summary.length) changes.push({ area: 'plugin', id, summary, rows, before: { plugin: { id, installed: plugin.installed, ...before } }, run: async (apply) => { for (const step of steps) await step(apply); } });
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

/** What the client gets of a plan: no code. `rows` is the same as `summary`, a row per key with what it is now and what it would be. */
export const describePlan = ({ changes, notes, warnings }) => ({ changes: changes.map(({ area, id, summary, rows }) => ({ area, id, summary, rows })), notes, warnings });

/**
 * Puts back what an applied plan changed, from the `before` of each of its changes. What cannot be put back is said: a secret was never
 * kept, a plugin that was installed stays installed.
 */
export const rollbackImport = async (befores, apply) => {
  const results = [];
  for (const { area, id, before } of befores) {
    try {
      if (before.instance) await apply.instance(before.instance);
      else if (before.primary) await apply.primary(before.primary);
      else if (before.gitHost) {
        const { enabled, settings } = before.gitHost.patch;
        await apply.gitHost(before.gitHost.kind, { ...(enabled === undefined ? {} : { enabled }), ...(settings ? { settings } : {}) });
      } else if (before.plugin) {
        if (!before.plugin.installed) { results.push({ area, id, ok: false, error: 'the plugin stays installed' }); continue; }
        if (Object.keys(before.plugin.settings ?? {}).length) await apply.pluginSettings(before.plugin.id, before.plugin.settings);
        await apply.pluginEnabled(before.plugin.id, before.plugin.enabled);
      }
      results.push({ area, id, ok: true });
    } catch (error) {
      results.push({ area, id, ok: false, error: error.message });
    }
  }
  return results;
};
