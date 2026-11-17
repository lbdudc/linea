import express from 'express';
import domainEvents, { DOMAIN_EVENTS } from '../../model/events/domainEvents.js';
import { getGitProvider } from '../../model/git/index.js';

/**
 * Where a git host (GitLab, GitHub) tells LINEA about a push: `POST /api/webhooks/<host>`, checked with the host's own scheme and the
 * `GIT_WEBHOOK_SECRET`. A push becomes `git:pushed` (`{ host, repositoryId, branch, username }`), the same event the local host emits,
 * so whoever listens (a plugin) does not care which host it came from. Parses its own body: the signature is over the raw bytes.
 */
const gitWebhookRouter = express.Router();

gitWebhookRouter.post('/:host', express.raw({ type: () => true, limit: '1mb' }), (req, res) => {
  const secret = process.env.GIT_WEBHOOK_SECRET;
  let git;
  try {
    git = getGitProvider({ host: req.params.host });
  } catch {
    return res.status(404).json({ error: 'unknown_host' });
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!secret || !git.verifyWebhook({ headers: req.headers, rawBody, secret })) return res.status(401).json({ error: 'errors.unauthorized' });
  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'errors.invalid_argument' });
  }
  const push = git.parsePushEvent({ headers: req.headers, body });
  if (!push) return res.status(204).end();
  const username = body.user_username ?? body.pusher?.name ?? body.sender?.login ?? body.username ?? null;
  domainEvents.emit(DOMAIN_EVENTS.GIT_PUSHED, { host: req.params.host, repositoryId: push.repositoryId, branch: push.branch, username });
  return res.status(202).json({ status: 'accepted' });
});

export default gitWebhookRouter;
