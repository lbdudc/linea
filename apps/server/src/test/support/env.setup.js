// Pins the environment the suite depends on so it does not vary with server/.env,
// server/.env.local or the developer's shell. properties.js skips dotenv entirely
// when running under vitest, so nothing can overwrite these values.
// Hostname is loopback so nothing can reach the real network (see netProbe).
// Scope: the git-host/auth variables plus external-service/scheduler variables
// below; any other variable read from process.env is still inherited from the shell.
const pinned = {
  GITLAB_HOSTNAME: 'http://127.0.0.1:1',
  GITLAB_CLIENT_ID: 'test-client-id',
  GITLAB_SECRET_ID: 'test-client-secret',
  REDIRECT_URI: 'http://127.0.0.1:9000',
  JWT_SIGN_KEY: 'test-jwt-sign-key',
  GIT_PROVIDER: '',
  GITHUB_CLIENT_ID: '',
  GITHUB_SECRET_ID: '',
  GITHUB_HOSTNAME: '',
  LINEA_REPOS_DIR: '',
  // External services / schedulers: never active in tests.
  ANTHROPIC_API_KEY: '',
  EMBEDDINGS_URL: '',
  EMBEDDINGS_API_KEY: '',
  BOT_USER: '',
  HEALTH_INTERVAL_MS: '',
  SYNC_RECONCILE_INTERVAL_MS: '',
};
for (const [key, value] of Object.entries(pinned)) process.env[key] = value;
