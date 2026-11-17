import YAML from 'yaml';

/**
 * The CI of a product: what its pipeline is made of, kept by hand per product (`.linea/ci.json` in its repository) until an SPL can
 * hand it down. A generation renders it to `.gitlab-ci.yml` in the code it derives, so the file is in the very merge request whose
 * checks it is for. Pure: nothing here talks to the host.
 */

export const CI_CONFIG_PATH = '.linea/ci.json';
export const CI_FILE_PATH = '.gitlab-ci.yml';

export const STAGES = ['check', 'build', 'test'];
/** What happens to an update whose checks did not pass: a person decides, or it is merged, or it is rejected, without asking. */
export const ON_CHECKS_FAILED = ['ask', 'merge', 'reject'];
const MAX_JOBS = 30;
const MAX_TEXT = 20000;

const SPEC_SCRIPT = `node -e '
  const fs = require("fs");
  const { execSync } = require("child_process");
  const files = execSync("git ls-files \\"*.spec.json\\" \\".linea/*.json\\"").toString().split("\\n").filter(Boolean);
  if (!files.length) { console.log("no spec files"); process.exit(0); }
  let bad = 0;
  for (const f of files) {
    try { JSON.parse(fs.readFileSync(f, "utf8")); console.log("ok  " + f); }
    catch (e) { bad++; console.error("BAD " + f + ": " + e.message); }
  }
  process.exit(bad ? 1 : 0);
'`;

/** The checks a product starts with: its spec files are valid, the client lints and builds, the server builds and passes its tests. */
export const defaultJobs = () => [
  {
    id: 'product_spec', stage: 'check', enabled: true, image: 'node:16', script: SPEC_SCRIPT,
    variables: {}, services: [], cache: [], junit: ''
  },
  {
    id: 'client_lint', stage: 'check', enabled: true, image: 'node:16',
    script: 'cd client\nnpm install --no-audit --no-fund\nnpx vue-cli-service lint --no-fix',
    variables: { npm_config_cache: '$CI_PROJECT_DIR/.npm' }, services: [], cache: ['.npm'], junit: ''
  },
  {
    id: 'client_build', stage: 'build', enabled: true, image: 'node:16',
    script: 'cd client\nnpm install --no-audit --no-fund\nnpm run build',
    variables: { npm_config_cache: '$CI_PROJECT_DIR/.npm' }, services: [], cache: ['.npm'], junit: ''
  },
  {
    id: 'server_build', stage: 'build', enabled: true, image: 'gradle:8-jdk17',
    // spotlessApply rewrites sources on compile; the check must not change what it checks
    script: 'cd server\ngradle --no-daemon compileJava compileTestJava -x spotlessApply',
    variables: { GRADLE_USER_HOME: '$CI_PROJECT_DIR/.gradle' }, services: [], cache: ['.gradle/caches', '.gradle/wrapper'], junit: ''
  },
  {
    id: 'server_test', stage: 'test', enabled: true, image: 'gradle:8-jdk17',
    script: 'cd server\ngradle --no-daemon test -x spotlessApply',
    variables: {
      GRADLE_USER_HOME: '$CI_PROJECT_DIR/.gradle', POSTGRES_DB: 'eiel_2020', POSTGRES_USER: 'postgres',
      POSTGRES_PASSWORD: 'postgres', POSTGRES_HOST_AUTH_METHOD: 'trust', SPRING_DATASOURCE_HOST: 'db'
    },
    services: [{ name: 'postgis/postgis:15-3.4', alias: 'db' }], cache: ['.gradle/caches', '.gradle/wrapper'],
    junit: 'server/build/test-results/test/**/TEST-*.xml'
  }
];

export const defaultCiConfig = () => ({
  enabled: false,
  // the runner tags every job asks for: a runner only takes the jobs whose tags it has
  tags: ['deploy'],
  // generation waits for the checks of the update merge request before merging it
  waitForChecks: true,
  waitMinutes: 30,
  onChecksFailed: 'ask',
  // `jobs`: rendered from the list below; `yaml`: the file as written by hand
  mode: 'jobs',
  yaml: '',
  jobs: defaultJobs()
});

export class CiConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CiConfigError';
    this.statusCode = 400;
  }
}

const text = (value, label, { max = MAX_TEXT, required = false } = {}) => {
  const out = typeof value === 'string' ? value : value == null ? '' : null;
  if (out === null) throw new CiConfigError(`${label} must be text`);
  if (out.length > max) throw new CiConfigError(`${label} is too long`);
  if (required && !out.trim()) throw new CiConfigError(`${label} is required`);
  return out.replace(/\r\n/g, '\n');
};

const JOB_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,59}$/;
const RESERVED = new Set(['stages', 'workflow', 'default', 'include', 'variables', 'image', 'services', 'cache', 'before_script', 'after_script']);

const normalizeJob = (raw, index) => {
  if (!raw || typeof raw !== 'object') throw new CiConfigError(`job ${index + 1} is not valid`);
  const id = text(raw.id, `job ${index + 1} name`, { max: 60, required: true }).trim();
  if (!JOB_ID.test(id) || RESERVED.has(id)) throw new CiConfigError(`"${id}" is not a valid job name`);
  const stage = STAGES.includes(raw.stage) ? raw.stage : 'test';
  const variables = {};
  for (const [key, value] of Object.entries(raw.variables && typeof raw.variables === 'object' ? raw.variables : {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new CiConfigError(`"${key}" is not a valid variable name (job ${id})`);
    variables[key] = text(String(value ?? ''), `variable ${key} of ${id}`, { max: 500 });
  }
  const services = (Array.isArray(raw.services) ? raw.services : []).map((service) => ({
    name: text(service?.name, `service of ${id}`, { max: 200, required: true }).trim(),
    alias: text(service?.alias, `service alias of ${id}`, { max: 60 }).trim()
  }));
  const cache = (Array.isArray(raw.cache) ? raw.cache : []).map((entry) => text(entry, `cache path of ${id}`, { max: 200 }).trim()).filter(Boolean);
  return {
    id,
    stage,
    enabled: raw.enabled !== false,
    image: text(raw.image, `image of ${id}`, { max: 200, required: true }).trim(),
    script: text(raw.script, `script of ${id}`, { required: true }),
    variables,
    services,
    cache,
    junit: text(raw.junit, `report of ${id}`, { max: 300 }).trim()
  };
};

/** What a saved (or sent) configuration comes to: anything missing takes its default, anything invalid is refused. */
export const normalizeCiConfig = (raw) => {
  const base = defaultCiConfig();
  if (raw == null) return base;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new CiConfigError('the CI configuration must be an object');
  const mode = raw.mode === 'yaml' ? 'yaml' : 'jobs';
  const tags = (Array.isArray(raw.tags) ? raw.tags : base.tags).map((tag) => text(tag, 'runner tag', { max: 60 }).trim()).filter(Boolean);
  const minutes = Number(raw.waitMinutes ?? base.waitMinutes);
  const jobs = Array.isArray(raw.jobs) ? raw.jobs.map(normalizeJob) : base.jobs;
  if (jobs.length > MAX_JOBS) throw new CiConfigError(`a pipeline has at most ${MAX_JOBS} jobs`);
  if (new Set(jobs.map((job) => job.id)).size !== jobs.length) throw new CiConfigError('two jobs have the same name');
  const config = {
    enabled: raw.enabled === true,
    tags,
    waitForChecks: raw.waitForChecks !== false,
    waitMinutes: Number.isFinite(minutes) ? Math.min(240, Math.max(1, Math.round(minutes))) : base.waitMinutes,
    onChecksFailed: ON_CHECKS_FAILED.includes(raw.onChecksFailed) ? raw.onChecksFailed : base.onChecksFailed,
    mode,
    yaml: text(raw.yaml, 'the pipeline file'),
    jobs
  };
  if (config.enabled && mode === 'yaml') {
    let parsed;
    try { parsed = YAML.parse(config.yaml); } catch (error) { throw new CiConfigError(`the pipeline file is not valid YAML: ${error.message.split('\n')[0]}`); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new CiConfigError('the pipeline file must be a YAML mapping of jobs');
  }
  if (config.enabled && mode === 'jobs' && !jobs.some((job) => job.enabled)) throw new CiConfigError('turn on at least one job');
  return config;
};

const HEADER = [
  'CI of the product. It is generated by LINEA from .linea/ci.json: edit it in the CI/CD tab of the product, not here.',
  'It runs only on the merge request of the generation (bigbang -> main), so its checks show up in the Pipelines tab of the MR.'
].map((line) => `# ${line}`).join('\n');

const jobToYaml = (job, tags) => {
  const out = { stage: job.stage };
  if (tags.length) out.tags = tags;
  out.image = job.image;
  if (Object.keys(job.variables).length) out.variables = job.variables;
  if (job.services.length) out.services = job.services.map((service) => (service.alias ? { name: service.name, alias: service.alias } : service.name));
  out.script = [job.script.replace(/\n+$/, '')];
  if (job.cache.length) out.cache = { key: 'cache-$CI_JOB_NAME-$CI_COMMIT_REF_SLUG', paths: job.cache };
  if (job.junit) out.artifacts = { when: 'always', reports: { junit: job.junit }, expire_in: '1 week' };
  return out;
};

/**
 * The `.gitlab-ci.yml` of a configuration: the file written by hand, or the one made of its jobs. `null` when CI is off.
 * The jobs run only on the merge request that carries a generation (`baseBranch` to `defaultBranch`): the checks are for deciding that
 * merge, and any other pipeline (the branch of a generation, its merge request into the base branch, a push to the default branch)
 * would only queue behind it on the runners.
 */
export const renderPipeline = (config, { baseBranch = 'bigbang', defaultBranch = 'main' } = {}) => {
  if (!config?.enabled) return null;
  if (config.mode === 'yaml') return `${config.yaml.replace(/\n*$/, '')}\n`;
  const jobs = config.jobs.filter((job) => job.enabled);
  const doc = {
    workflow: {
      rules: [
        { if: `$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_SOURCE_BRANCH_NAME == "${baseBranch}" && $CI_MERGE_REQUEST_TARGET_BRANCH_NAME == "${defaultBranch}"` },
        { when: 'never' }
      ]
    },
    stages: STAGES.filter((stage) => jobs.some((job) => job.stage === stage))
  };
  for (const job of jobs) doc[job.id] = jobToYaml(job, config.tags);
  return `${HEADER}\n\n${YAML.stringify(doc, { lineWidth: 0, aliasDuplicateObjects: false })}`;
};

export const serializeCiConfig = (config) => `${JSON.stringify(config, null, 2)}\n`;

export const parseCiConfig = (content) => {
  if (content == null || !String(content).trim()) return defaultCiConfig();
  try {
    return normalizeCiConfig(JSON.parse(content));
  } catch (error) {
    // a file that cannot be read is no CI, not a failed generation
    console.error(`[ci] ${CI_CONFIG_PATH} is not valid, CI is treated as off: ${error.message}`);
    return defaultCiConfig();
  }
};
