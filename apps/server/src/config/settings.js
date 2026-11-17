const TYPES = new Set(['string', 'url', 'number', 'boolean', 'enum', 'list', 'secret']);

const coerce = (spec, value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (spec.type === 'number') return Number(value);
  if (spec.type === 'boolean') return value === true || value === 'true';
  if (spec.type === 'list') return Array.isArray(value) ? value : String(value).split(',').map((entry) => entry.trim()).filter(Boolean);
  return value;
};

/**
 * What a plugin's `settings` block (in plugin.json) comes to: `default` < `env` < `stored` (set in the UI) < `file` (linea.config.yml).
 * Returns `{ values, meta }`; `meta[key]` is `{ source, locked }` (locked: it comes from the file) or `{ source, missing }` for a
 * required setting nobody gave. Pure: the host passes in what it read.
 */
export const resolveSettings = (schema = {}, { file = {}, stored = {}, env = process.env } = {}) => {
  const values = {};
  const meta = {};
  for (const [key, spec] of Object.entries(schema)) {
    const layers = [
      ['file', file[key]],
      ['stored', stored[key]],
      ['env', spec.env ? env[spec.env] : undefined],
      ['default', spec.default],
    ];
    const found = layers.map(([source, raw]) => [source, coerce(spec, raw)]).find(([, value]) => value !== undefined);
    if (found) {
      values[key] = found[1];
      meta[key] = { source: found[0], locked: found[0] === 'file' };
    } else {
      meta[key] = { source: null, locked: false, ...(spec.required ? { missing: true } : {}) };
    }
  }
  return { values, meta };
};

/** Checks a patch from the UI against the schema; returns the list of problems (empty: it is valid). */
export const validateSettings = (schema = {}, patch = {}, { locked = [] } = {}) => {
  const problems = [];
  for (const [key, raw] of Object.entries(patch)) {
    const spec = schema[key];
    if (!spec || !TYPES.has(spec.type)) {
      problems.push(`${key}: not a setting of this plugin`);
      continue;
    }
    if (locked.includes(key)) {
      problems.push(`${key}: set in linea.config.yml`);
      continue;
    }
    const value = coerce(spec, raw);
    if (value === undefined) continue;
    if (spec.type === 'boolean' && ![true, false, 'true', 'false'].includes(raw)) problems.push(`${key}: must be true or false`);
    if (['string', 'secret', 'url', 'enum'].includes(spec.type) && typeof raw !== 'string') problems.push(`${key}: must be text`);
    if (spec.type === 'list' && !(typeof raw === 'string' || (Array.isArray(raw) && raw.every((entry) => typeof entry === 'string')))) problems.push(`${key}: must be a list of text`);
    if (spec.type === 'number' && (Number.isNaN(value) || value < (spec.min ?? -Infinity) || value > (spec.max ?? Infinity))) problems.push(`${key}: not a valid number`);
    if (spec.type === 'enum' && !spec.options?.includes(value)) problems.push(`${key}: must be one of ${spec.options?.join(', ')}`);
    if (spec.type === 'url') {
      // the server calls these addresses: nothing but http(s)
      if (typeof value !== 'string' || !URL.canParse(value) || !/^https?:$/.test(new URL(value).protocol)) problems.push(`${key}: not an http(s) URL`);
    }
  }
  return problems;
};

/** The settings safe to show: secrets are replaced by `{ isSet }`. */
export const maskSecrets = (schema = {}, values = {}) => Object.fromEntries(
  Object.entries(values).map(([key, value]) => [key, schema[key]?.type === 'secret' ? { isSet: Boolean(value) } : value]),
);

/** Only the settings a plugin marked `public` (what the browser may get in `ui.info`). */
export const publicSettings = (schema = {}, values = {}) => Object.fromEntries(
  Object.entries(values).filter(([key]) => schema[key]?.public && schema[key].type !== 'secret'),
);
