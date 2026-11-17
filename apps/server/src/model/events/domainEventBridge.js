import { createHmac } from 'node:crypto';
import domainEvents, { DOMAIN_EVENTS } from './domainEvents.js';
import User from '../entities/user.js';

const BRIDGE_TIMEOUT_MS = 5000;

let wired = false;

// what plugins and the configured receivers hear about
const FORWARDED = [DOMAIN_EVENTS.PRODUCT_GENERATED, DOMAIN_EVENTS.GIT_PUSHED];

const sign = (secret, body) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

const parseUrls = (value) => (value ?? '').split(',').map((url) => url.trim()).filter(Boolean);

const forward = (url, secret, body, event) => {
  try {
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Linea-Signature': sign(secret, body),
      },
      body,
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    })
      .then((res) => {
        if (!res.ok) {
          console.error(`[domainEventBridge] ${url} rejected ${event} (HTTP ${res.status})`);
        }
      })
      .catch((err) => {
        console.error(`[domainEventBridge] failed to forward ${event} to ${url}:`, err?.message ?? err);
      });
  } catch (err) {
    console.error(`[domainEventBridge] failed to forward ${event} to ${url}:`, err?.message ?? err);
  }
};

/**
 * Forwards PRODUCT_GENERATED and GIT_PUSHED to the URLs in EVENT_WEBHOOK_URLS (comma separated) and to the ones of the plugins that are enabled
 * (`pluginTargets()`, their `remote.events`): a POST of `{ event, payload }` (the payload plus `actor: { username }`) signed with
 * HMAC-SHA256 of the body in `X-Linea-Signature` (`sha256=<hex>`), keyed by EVENT_WEBHOOK_SECRET. Without the secret, or without a
 * receiver, nothing is sent: LINEA does not need one.
 */
export const wireDomainEventBridge = ({ pluginTargets = () => [] } = {}) => {
  if (wired) return;
  wired = true;

  const urls = parseUrls(process.env.EVENT_WEBHOOK_URLS);
  const secret = process.env.EVENT_WEBHOOK_SECRET;

  if (!secret) {
    console.info('[domainEventBridge] EVENT_WEBHOOK_SECRET not set — domain events are not forwarded');
    return;
  }

  console.info(`[domainEventBridge] wired — forwarding ${FORWARDED.join(', ')} to ${urls.join(', ') || 'the plugins that ask for it'}`);

  for (const event of FORWARDED) {
    domainEvents.on(event, async (payload) => {
      const targets = [...new Set([...urls, ...pluginTargets()])];
      if (!targets.length) return;
      // a receiver outside LINEA cannot resolve LINEA user ids: it gets the git username too (a push already carries the pusher's)
      const user = payload?.userId ? await User.findById(payload.userId).select('username').lean().catch(() => null) : null;
      const actor = user ? { username: user.username } : payload?.username ? { username: payload.username } : null;
      const body = JSON.stringify({ event, payload: { ...payload, actor } });
      for (const url of targets) forward(url, secret, body, event);
    });
  }
};
