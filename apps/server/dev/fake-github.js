/**
 * A GitHub for developing LINEA on a laptop: the in-memory GitHub the tests use, plus the OAuth endpoints LINEA logs in with. Its
 * registry of metamodels and modules is published into it, when it starts, by the same script that publishes them to a real GitHub
 * (scripts/publish-registry.mjs --host github), from the `metamodels/` and `modules/` folders of the workspace. Everything lives in
 * memory: restarting it starts over.
 *
 *   node dev/fake-github.js            (port 8082; PORT=… to change it; REGISTRY_DIR=… for another folder of packages)
 *
 * Run the server on it with
 *   GIT_PROVIDER=github GITHUB_URL=http://localhost:8082 GITHUB_API_URL=http://localhost:8082 GITHUB_CLIENT_ID=dev-client \
 *   GITHUB_CLIENT_SECRET=dev-secret GITHUB_WEB_IDE_URL=http://localhost:8082 REDIRECT_URI=http://localhost:9000 …
 * Logging in takes no password: "Continue with GitHub" lands straight back in LINEA as the user `dev`, who owns everything. The
 * organisation `acme` is there too, to put an SPL in.
 */
import { spawn } from 'node:child_process';
import express from 'express';
import { createGithubDoubleApp } from '@lbdudc/linea-git/testing';

const PORT = Number(process.env.PORT ?? 8082);
const BASE = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;

const { app: double, state } = createGithubDoubleApp(BASE);
const app = express();

// logging in takes no password: the authorize page sends the browser straight back with a code
app.get('/login/oauth/authorize', (req, res) => {
  const redirect = new URL(String(req.query.redirect_uri));
  redirect.searchParams.set('code', 'dev-code');
  if (req.query.state) redirect.searchParams.set('state', String(req.query.state));
  res.redirect(redirect.toString());
});

// device authorization: pending until the approval page is opened (GET /login/device?user_code=…)
const devices = new Map(); // device_code -> { userCode, approved }
app.post('/login/device/code', express.json(), express.urlencoded({ extended: true }), (_req, res) => {
  const n = devices.size + 1;
  const device = { userCode: `DEV${n}-GH${n}`, approved: false };
  devices.set(`device-code-${n}`, device);
  res.json({ device_code: `device-code-${n}`, user_code: device.userCode, verification_uri: `${BASE}/login/device`, expires_in: 600, interval: 1 });
});
app.get('/login/device', (req, res) => {
  const device = [...devices.values()].find((candidate) => candidate.userCode === req.query.user_code);
  if (device) device.approved = true;
  res.type('text/plain').send(device ? 'Device approved: go back to the terminal.' : 'Unknown code.');
});

app.post('/login/oauth/access_token', express.json(), express.urlencoded({ extended: true }), (req, res) => {
  if (req.body?.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
    const device = devices.get(String(req.body.device_code));
    if (!device) return res.json({ error: 'expired_token' });
    if (!device.approved) return res.json({ error: 'authorization_pending' });
  }
  res.json({ access_token: 'gho_dev-access-token', token_type: 'bearer', scope: 'repo,delete_repo,read:org,write:repo_hook' });
});

// a link to a repository (the "open in GitHub" and "web IDE" buttons) lands on a page that says where it is
app.get('/:owner/:repo', (req, res, next) => {
  if (['repos', 'repositories', 'user', 'users', 'orgs', 'login', '__codeload'].includes(req.params.owner)) return next();
  res.type('text/plain').send(`${req.params.owner}/${req.params.repo} (the in-memory GitHub of the dev stack)`);
});

app.use(double);

app.listen(PORT, () => {
  state.addOrg('acme', 'admin');
  console.log(`[fake-github] ${BASE}  (user "dev", organisation "acme")`);

  const publish = spawn(
    process.execPath,
    ['scripts/publish-registry.mjs', '--host', 'github', '--owner', 'dev', '--registry', 'github:dev/linea-registry', ...(process.env.REGISTRY_DIR ? ['--dir', process.env.REGISTRY_DIR] : [])],
    { env: { ...process.env, GITHUB_API_URL: `http://127.0.0.1:${PORT}`, GITHUB_TOKEN: 'dev' }, stdio: 'inherit' },
  );
  publish.on('exit', (code) => {
    console.log(code === 0 ? `[fake-github] registry published under "dev": ${state.repos.size} repositories` : `[fake-github] publishing the registry failed (exit ${code})`);
  });
});
