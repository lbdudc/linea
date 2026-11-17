import fs from 'node:fs';
import { parse } from 'yaml';
import { expand } from '../plugins/PluginRegistry.js';
import { knownHostKeys } from './gitHosts.js';
import { HOST_KINDS, HOST_SCHEMAS } from './gitHostSchemas.js';
import { validateSettings } from './settings.js';
import { INSTANCE_SCHEMA } from './instanceSettings.js';

// `${NAME}` / `${NAME:-default}` in any string of the file: secrets stay in the environment, the file can be kept in git
const expandAll = (value, env) => {
  if (typeof value === 'string') return expand(value, env);
  if (Array.isArray(value)) return value.map((entry) => expandAll(entry, env));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, expandAll(entry, env)]));
  return value;
};

// `enabled: ${VAR:-false}` reaches us as the text "false": true and false are the only answers
const toBoolean = (value, where, warnings) => {
  if (value === undefined || typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  warnings.push(`${where}: must be true or false (got ${JSON.stringify(value)}), taken as false`);
  return undefined;
};

// the `gitHosts:` block, checked: what is wrong is left out and said, so that a typo cannot switch a host on
const checkGitHosts = (block, warnings) => {
  if (block === undefined || block === null) return {};
  if (typeof block !== 'object' || Array.isArray(block)) throw new Error('gitHosts: must be a mapping (primary:, local:, gitlab:, github:).');
  const checked = {};
  for (const [key, entry] of Object.entries(block)) {
    if (!knownHostKeys.includes(key)) {
      warnings.push(`gitHosts.${key}: not a git host (${knownHostKeys.join(', ')}), ignored`);
    } else if (key === 'primary') {
      const primary = typeof entry === 'string' ? entry.toLowerCase() : null;
      if (HOST_KINDS.includes(primary)) checked.primary = primary;
      else warnings.push(`gitHosts.primary: must be one of ${HOST_KINDS.join(', ')}, ignored`);
    } else if (entry === null || entry === undefined) {
      warnings.push(`gitHosts.${key}: empty, ignored (write enabled: false to switch it off)`);
    } else if (typeof entry === 'boolean') {
      checked[key] = { enabled: entry };
    } else if (typeof entry !== 'object' || Array.isArray(entry)) {
      warnings.push(`gitHosts.${key}: expected { enabled, ...settings }, ignored`);
    } else {
      const { enabled, ...settings } = entry;
      // (an answer that makes no sense switches it off: a typo must not switch a host on)
      const on = enabled === undefined ? undefined : (toBoolean(enabled, `gitHosts.${key}.enabled`, warnings) ?? false);
      for (const problem of validateSettings(HOST_SCHEMAS[key], settings)) warnings.push(`gitHosts.${key}.${problem}`);
      checked[key] = { ...settings, ...(on === undefined ? {} : { enabled: on }) };
    }
  }
  return checked;
};

// the `instance:` block, checked: what is wrong is left out and said
const checkInstance = (block, warnings) => {
  if (block === undefined || block === null) return {};
  if (typeof block !== 'object' || Array.isArray(block)) throw new Error('instance: must be a mapping (sessionHours:, maxFailedSignIns:, ...).');
  const checked = {};
  for (const [key, value] of Object.entries(block)) {
    const problems = validateSettings(INSTANCE_SCHEMA, { [key]: value });
    if (problems.length) warnings.push(...problems.map((problem) => `instance.${problem}, ignored`));
    else checked[key] = value;
  }
  return checked;
};

/**
 * What a deployment says in `linea.config.yml` (see `deploy/linea.config.example.yml`):
 *
 *   gitHosts: { primary: gitlab, gitlab: { url, clientId, clientSecret, defaultNamespace }, github: { ... }, local: { dataDir } }
 *   plugins:  { <id>: { enabled: true, settings: { ... } } }
 *   instance: { sessionHours, maxFailedSignIns, lockMinutes, minPasswordLength, modulesPublish, modulesRegister, auditRetentionDays }
 *
 * Returns `{ declared, gitHosts, warnings }`, `declared` being id -> `{ enabled, settings }`. A missing file is no file (`declared` is
 * empty); a file that cannot be read is an error, because a half-applied deployment is worse than one that does not start.
 */
export const loadDeployConfig = ({ file, env = process.env, required = false } = {}) => {
  const empty = { declared: {}, gitHosts: {}, instance: {}, warnings: [] };
  if (!file || !fs.existsSync(file)) {
    if (required) throw new Error(`LINEA_CONFIG points to ${file}, which does not exist.`);
    return empty;
  }
  return parseDeployConfig(fs.readFileSync(file, 'utf8'), { env, name: file });
};

/** What the text of a config file says (the same as `loadDeployConfig`, from text). `raw` is the file before `${VAR}` are filled in. */
export const parseDeployConfig = (text, { env = process.env, name = 'the file' } = {}) => {
  let raw;
  try {
    raw = parse(text) ?? {};
  } catch (error) {
    throw new Error(`${name} is not valid YAML: ${error.message}`);
  }
  const config = expandAll(raw, env);
  const warnings = [];
  if (typeof config !== 'object' || Array.isArray(config)) throw new Error(`${name} must be a mapping (gitHosts:, plugins:).`);
  const declared = {};
  for (const [id, entry] of Object.entries(config.plugins ?? {})) {
    if (entry !== null && typeof entry !== 'object') {
      warnings.push(`plugins.${id}: expected { enabled, settings }, ignored`);
      continue;
    }
    const { enabled = true, settings = {}, ...rest } = entry ?? {};
    for (const key of Object.keys(rest)) warnings.push(`plugins.${id}.${key}: unknown key, ignored`);
    declared[id] = { enabled: toBoolean(enabled, `plugins.${id}.enabled`, warnings) ?? (enabled === true || enabled === undefined), settings };
  }
  const gitHosts = checkGitHosts(config.gitHosts, warnings);
  const instance = checkInstance(config.instance, warnings);
  return { declared, gitHosts, instance, warnings, raw };
};

/** The state of a host as a config file: what the Plugins view downloads. Secrets become `${VAR}` placeholders named after the setting. */
export const toConfigYaml = ({ plugins, gitHosts = {}, instance = {} }) => {
  const lines = [];
  if (Object.keys(instance).length) {
    lines.push('instance:');
    for (const [key, value] of Object.entries(instance)) lines.push(`  ${key}: ${JSON.stringify(value)}`);
    lines.push('');
  }
  if (gitHosts.primary) {
    lines.push('gitHosts:', `  primary: ${gitHosts.primary}`);
    for (const host of gitHosts.hosts ?? []) {
      lines.push(`  ${host.id}:`, `    enabled: ${host.enabled}`);
      for (const [key, value] of Object.entries(host.settings ?? {})) lines.push(`    ${key}: ${JSON.stringify(value)}`);
    }
    lines.push('');
  }
  lines.push('plugins:');
  for (const plugin of plugins) {
    if (!plugin.installed) continue;
    lines.push(`  ${plugin.id}:`, `    enabled: ${plugin.enabled}`);
    const settings = Object.entries(plugin.settings ?? {});
    if (!settings.length) continue;
    lines.push('    settings:');
    for (const [key, value] of settings) lines.push(`      ${key}: ${JSON.stringify(value)}`);
  }
  return `${lines.join('\n')}\n`;
};
