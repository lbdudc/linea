/**
 * A GitLab for developing LINEA on a laptop: the in-memory double the tests use, plus the OAuth endpoints LINEA logs in with.
 * Its registry of metamodels and modules is published into it, when it starts, by the same script that publishes them to a real
 * GitLab (scripts/publish-registry.mjs), from the `metamodels/` and `modules/` folders of the workspace. Everything lives in memory:
 * restarting it starts over.
 *
 *   node dev/fake-gitlab.js            (port 8081; PORT=… to change it; REGISTRY_DIR=… for another folder of packages)
 *
 * Point the server at it with GITLAB_HOSTNAME=http://localhost:8081. Logging in takes no password: "Sign in with GitLab" lands
 * straight back in LINEA as the user `dev`, who owns every project (access level 50).
 */
import { spawn } from 'node:child_process';
import express from 'express';
import { createGitlabDoubleApp } from '@lbdudc/linea-git/testing';

const PORT = Number(process.env.PORT ?? 8081);
const BASE = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;
const REGISTRY_GROUP = 'registry';
// the repository that holds the catalog: the server is started with LINEA_REGISTRY=<this> (dev/up.sh)
const REGISTRY_LOCATION = `gitlab:${REGISTRY_GROUP}/index`;
const USER = { id: 1, username: 'dev', name: 'Dev User', email: 'dev@example.com', avatar_url: '' };
const OWNER = { id: 1, username: USER.username, name: USER.name, access_level: 50 };

const { app: double, state } = createGitlabDoubleApp(BASE);
const app = express();

// logging in takes no password: the authorize page sends the browser straight back with a code
app.get('/oauth/authorize', (req, res) => {
  const redirect = new URL(String(req.query.redirect_uri));
  redirect.searchParams.set('code', 'dev-code');
  if (req.query.state) redirect.searchParams.set('state', String(req.query.state));
  res.redirect(redirect.toString());
});

app.post('/oauth/token', express.json(), express.urlencoded({ extended: true }), (_req, res) => {
  res.json({
    access_token: 'dev-access-token',
    refresh_token: 'dev-refresh-token',
    token_type: 'Bearer',
    expires_in: 7200,
    created_at: Math.floor(Date.now() / 1000),
  });
});

app.get('/api/v4/user', (_req, res) => res.json(USER));

// `dev` is an owner of everything
app.get(['/api/v4/projects/:id/members/all', '/api/v4/groups/:id/members/all'], (_req, res) => res.json([OWNER]));

// A real GitLab runs the checks of a merge request when it is opened; the double only runs a pipeline per commit, so the update of a
// generation gets one. `.linea/` is where a generation does not look when it compares its code.
app.post('/api/v4/projects/:id/merge_requests', express.json(), (req, _res, next) => {
  const { source_branch: source, target_branch: target } = req.body ?? {};
  const key = decodeURIComponent(req.params.id);
  const project = [...state.projects.values()].find((candidate) => String(candidate.id) === key || candidate.path_with_namespace === key);
  if (project && source === 'bigbang' && target === 'main') {
    project.commit({ branch: source, message: 'Run the checks', actions: [{ action: 'create', file_path: `.linea/checks-run-${Date.now()}`, content: '' }] });
  }
  next();
});

app.use(double);

app.listen(PORT, () => {
  state.createGroup({ name: REGISTRY_GROUP });
  console.log(`[fake-gitlab] ${BASE}  (user "dev")`);

  const publish = spawn(
    process.execPath,
    ['scripts/publish-registry.mjs', '--group', REGISTRY_GROUP, '--registry', REGISTRY_LOCATION, ...(process.env.REGISTRY_DIR ? ['--dir', process.env.REGISTRY_DIR] : [])],
    { env: { ...process.env, GITLAB_URL: `http://127.0.0.1:${PORT}`, GITLAB_TOKEN: 'dev' }, stdio: 'inherit' },
  );
  publish.on('exit', (code) => {
    console.log(code === 0 ? `[fake-gitlab] registry published under "${REGISTRY_GROUP}": ${state.projects.size} projects` : `[fake-gitlab] publishing the registry failed (exit ${code})`);
  });
});
