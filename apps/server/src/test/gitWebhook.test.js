import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import domainEvents, { DOMAIN_EVENTS } from '../model/events/domainEvents.js';

const provider = {
  verifyWebhook: ({ headers, secret }) => headers['x-gitlab-token'] === secret,
  parsePushEvent: ({ body }) => (body?.object_kind === 'push' ? { repositoryId: body.project.id, branch: body.ref.replace('refs/heads/', '') } : null),
};
vi.mock('../model/git/index.js', () => ({
  getGitProvider: ({ host }) => { if (host !== 'gitlab') throw new Error('off'); return provider; },
}));

const { default: gitWebhookRouter } = await import('../rest/routers/gitWebhookRouter.js');
const app = () => { const server = express(); server.use('/api/webhooks', gitWebhookRouter); return server; };
const push = { object_kind: 'push', ref: 'refs/heads/main', user_username: 'ana', project: { id: 5 } };

beforeEach(() => { process.env.GIT_WEBHOOK_SECRET = 'shh'; });
afterEach(() => { delete process.env.GIT_WEBHOOK_SECRET; domainEvents.removeAllListeners(DOMAIN_EVENTS.GIT_PUSHED); });

test('a push the host signs becomes git:pushed; anything else is refused or ignored', async () => {
  const seen = [];
  domainEvents.on(DOMAIN_EVENTS.GIT_PUSHED, (event) => seen.push(event));
  await request(app()).post('/api/webhooks/gitlab').set('X-Gitlab-Token', 'wrong').send(push).expect(401);
  await request(app()).post('/api/webhooks/nowhere').send(push).expect(404);
  await request(app()).post('/api/webhooks/gitlab').set('X-Gitlab-Token', 'shh').send({ object_kind: 'tag_push' }).expect(204);
  await request(app()).post('/api/webhooks/gitlab').set('X-Gitlab-Token', 'shh').send(push).expect(202);
  expect(seen).toEqual([{ host: 'gitlab', repositoryId: 5, branch: 'main', username: 'ana' }]);
});
