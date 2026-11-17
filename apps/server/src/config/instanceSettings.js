import { resolveSettings, validateSettings } from './settings.js';

/**
 * How this LINEA behaves, beyond which git hosts it has: what an administrator may tune. Same layers as the plugins' settings
 * (`default` < stored in the UI < `instance:` of linea.config.yml, which locks). `group` says which section of the Configuration view shows it.
 */
export const INSTANCE_SCHEMA = {
  sessionHours: { type: 'number', group: 'signIn', min: 0.5, max: 720, default: 6900 / 3600 },
  maxFailedSignIns: { type: 'number', group: 'signIn', min: 1, max: 100, default: 10 },
  lockMinutes: { type: 'number', group: 'signIn', min: 1, max: 1440, default: 15 },
  minPasswordLength: { type: 'number', group: 'signIn', min: 8, max: 128, default: 8 },
  modulesPublish: { type: 'enum', group: 'modules', options: ['everyone', 'admins'], default: 'everyone' },
  modulesRegister: { type: 'enum', group: 'modules', options: ['everyone', 'admins'], default: 'everyone' },
  syncConcurrency: { type: 'number', group: 'scheduler', min: 1, max: 20, default: 2 },
  generationConcurrency: { type: 'number', group: 'scheduler', min: 1, max: 10, default: 3 },
  schedulerPaused: { type: 'boolean', group: 'scheduler', default: false },
  auditRetentionDays: { type: 'number', group: 'audit', min: 1, max: 3650, default: 180 },
};

export class InstanceSettingsError extends Error {
  code = 'INSTANCE_SETTINGS';
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

let declared = {};
let store = null;
let stored = {};
let cache = null;

const resolved = () => (cache ??= resolveSettings(INSTANCE_SCHEMA, { file: declared, stored, env: {} }));

/** Reads what the file declares (`instance:`) and what was saved. Called at start, and by tests. */
export const configureInstance = async ({ file = {}, store: instanceStore = null } = {}) => {
  declared = file;
  store = instanceStore;
  stored = store ? await store.all() : {};
  cache = null;
};

/** The value of one setting, now. */
export const instance = (key) => resolved().values[key];

/** What the view shows: the schema, the values and where each came from (`locked`: the file sets it). */
export const describeInstance = () => ({ schema: INSTANCE_SCHEMA, ...resolved() });

/** Saves a patch from the UI; `null` takes a setting back to its default. The keys the file sets are refused. */
export const saveInstance = async (patch = {}) => {
  if (!store) throw new InstanceSettingsError('There is nowhere to keep the settings.', 500);
  const { meta } = resolved();
  const locked = Object.keys(meta).filter((key) => meta[key].locked);
  const cleared = Object.entries(patch).filter(([, value]) => value === null).map(([key]) => key);
  const changes = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null));
  const problems = [
    ...validateSettings(INSTANCE_SCHEMA, changes, { locked }),
    ...cleared.filter((key) => !INSTANCE_SCHEMA[key]).map((key) => `${key}: not a setting`),
    ...cleared.filter((key) => locked.includes(key)).map((key) => `${key}: set in linea.config.yml`),
  ];
  if (problems.length) throw new InstanceSettingsError(problems.join('; '));
  for (const [key, value] of Object.entries(changes)) await store.set(key, INSTANCE_SCHEMA[key].type === 'number' ? Number(value) : value);
  for (const key of cleared) await store.unset(key);
  stored = await store.all();
  cache = null;
  return describeInstance();
};

/** What was set (file or UI), not the defaults: the `instance:` block a config file would carry. */
export const exportInstance = () => {
  const { values, meta } = resolved();
  return Object.fromEntries(Object.entries(values).filter(([key]) => ['file', 'stored'].includes(meta[key]?.source)));
};
