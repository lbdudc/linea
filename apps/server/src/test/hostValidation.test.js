import { test, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createLineValidator, hostQueryValidator } from '../rest/validators/lineValidators.js';
import { configureGitHosts } from '../model/git/index.js';

// two hosts are on
beforeAll(() => configureGitHosts({ file: { gitlab: { url: 'http://gl' }, github: { clientId: 'a', clientSecret: 'b' } } }));
afterAll(() => configureGitHosts({}));

// the validators as the routes mount them, with a Host header that is not a git host (as any real request has)
const app = express();
app.use(express.json());
app.post('/lines', createLineValidator, (req, res) => res.status(200).json({ ok: true }));
app.get('/namespaces', hostQueryValidator, (req, res) => res.status(200).json({ ok: true }));

test('the host of a line is the one in the body, not the Host header of the request', async () => {
  const base = { name: 'a-line', version: '0.0.0', kind: 'plain' };
  expect((await request(app).post('/lines').set('Host', 'localhost:9000').send(base)).status).toBe(200);
  expect((await request(app).post('/lines').set('Host', 'localhost:9000').send({ ...base, host: 'gitlab' })).status).toBe(200);
  expect((await request(app).post('/lines').send({ ...base, host: 'bitbucket' })).status).toBe(400);
});

test('?host= must be a host that is on', async () => {
  expect((await request(app).get('/namespaces?host=github')).status).toBe(200);
  expect((await request(app).get('/namespaces?host=nowhere')).status).toBe(400);
  expect((await request(app).get('/namespaces')).status).toBe(200);
});
