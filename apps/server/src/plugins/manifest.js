import semver from 'semver';

// What a plugin.json may say. The same fields are written down in docs/linea/plugins.md and docs/linea/plugin.schema.json.
const KEYS = ['id', 'name', 'description', 'icon', 'version', 'requires', 'server', 'client', 'settings', 'serviceKey', 'remote'];
const REQUIRES_KEYS = ['linea', 'hostApi', 'gitHosts'];
const REMOTE_KEYS = ['baseUrl', 'health', 'events', 'web'];
const SETTING_TYPES = ['string', 'url', 'number', 'boolean', 'enum', 'list', 'secret'];
const SETTING_KEYS = ['type', 'label', 'description', 'default', 'env', 'required', 'public', 'options', 'min', 'max', 'optionsFrom'];

const isText = (value) => typeof value === 'string' && value.length > 0;
const isLabel = (value) => isText(value) || (value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(isText));

/**
 * Checks a manifest. `errors` make the plugin unusable (it is listed with the error); `warnings` are shown in the log only (a key the host
 * does not know is most likely a typo).
 */
export const validateManifest = (manifest) => {
  const errors = [];
  const warnings = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { errors: ['plugin.json must be an object'], warnings };

  for (const key of Object.keys(manifest)) if (!KEYS.includes(key)) warnings.push(`unknown key "${key}"`);
  if (!isLabel(manifest.name)) errors.push('"name" must be text or { en, es, gl }');
  if (!semver.valid(manifest.version)) errors.push('"version" must be a semver such as 1.0.0');
  if (manifest.description !== undefined && !isLabel(manifest.description)) errors.push('"description" must be text or { en, es, gl }');
  for (const key of ['server', 'client']) {
    if (manifest[key] !== undefined && !isText(manifest[key])) errors.push(`"${key}" must be a path inside the plugin's folder`);
    if (isText(manifest[key]) && (manifest[key].startsWith('/') || manifest[key].split('/').includes('..'))) errors.push(`"${key}" must stay inside the plugin's folder`);
  }

  const { requires } = manifest;
  if (requires !== undefined) {
    if (!requires || typeof requires !== 'object') errors.push('"requires" must be an object');
    else {
      for (const key of Object.keys(requires)) if (!REQUIRES_KEYS.includes(key)) warnings.push(`unknown key "requires.${key}"`);
      for (const key of ['linea', 'hostApi']) if (requires[key] !== undefined && !semver.validRange(requires[key])) errors.push(`"requires.${key}" must be a semver range`);
      if (requires.gitHosts !== undefined && !(Array.isArray(requires.gitHosts) && requires.gitHosts.every(isText))) errors.push('"requires.gitHosts" must be a list of host names');
    }
  }

  const { remote } = manifest;
  if (remote !== undefined) {
    if (!remote || typeof remote !== 'object') errors.push('"remote" must be an object');
    else {
      for (const key of Object.keys(remote)) if (!REMOTE_KEYS.includes(key)) warnings.push(`unknown key "remote.${key}"`);
      for (const key of REMOTE_KEYS) if (remote[key] !== undefined && !isText(remote[key])) errors.push(`"remote.${key}" must be text`);
      if (remote.health && !remote.baseUrl) errors.push('"remote.health" needs "remote.baseUrl"');
    }
  }

  const { settings } = manifest;
  if (settings !== undefined) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) errors.push('"settings" must be an object');
    else {
      for (const [key, spec] of Object.entries(settings)) {
        if (!spec || !SETTING_TYPES.includes(spec.type)) { errors.push(`settings.${key}.type must be one of ${SETTING_TYPES.join(', ')}`); continue; }
        for (const field of Object.keys(spec)) if (!SETTING_KEYS.includes(field)) warnings.push(`unknown key "settings.${key}.${field}"`);
        if (spec.type === 'enum' && !(Array.isArray(spec.options) && spec.options.length)) errors.push(`settings.${key}: an enum needs "options"`);
        if (spec.type === 'secret' && spec.public) errors.push(`settings.${key}: a secret cannot be public`);
      }
    }
  }
  if (manifest.serviceKey !== undefined && manifest.settings?.[manifest.serviceKey]?.type !== 'secret') errors.push('"serviceKey" must name a setting of type secret');
  return { errors, warnings };
};
