// A remote plugin: its own process. LINEA calls /health and POSTs events to /events; the service calls LINEA's API with its service key.
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { verifyEventSignature, serviceClient, healthStatus, readBody } from './linea-plugin-sdk.js';

const PORT = Number(process.env.PORT ?? 8091);
const SECRET = process.env.EVENT_WEBHOOK_SECRET; // the same value LINEA signs with
const received = []; // the last events (a demo keeps few)
const KEEP = 100;

export const createServer = ({ secret = SECRET, linea } = {}) => http.createServer(async (req, res) => {
  const send = (status, body) => {
    if (status === 204) { res.writeHead(204).end(); return; }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && pathname === '/health') return send(200, healthStatus({ received: received.length }));
    // (open to anyone who reaches the service: a demo, put authentication here in a real plugin)
    if (req.method === 'GET' && pathname === '/') return send(200, { received });
    if (req.method === 'POST' && pathname === '/events') {
      const raw = await readBody(req);
      if (!verifyEventSignature(secret, raw, req.headers['x-linea-signature'])) return send(401, { error: 'bad signature' });
      let message;
      try { message = JSON.parse(raw.toString('utf8')); } catch { return send(400, { error: 'not JSON' }); }
      const { event, payload } = message ?? {};
      if (received.length >= KEEP) received.shift();
      received.push({ event, actor: payload?.actor?.username ?? null, at: new Date().toISOString() });
      send(204, {}); // answer first: LINEA waits 5 s for it and does not retry
      // then act back on LINEA as the person who caused the event
      if (linea && payload?.actor?.username) await linea.get('/api/lines/enrolled', { actAs: payload.actor.username }).catch((error) => console.error(`[echo-plugin] LINEA: ${error.message}`));
      return undefined;
    }
    return send(404, { error: 'not found' });
  } catch (error) {
    return send(error.status ?? 500, { error: error.message });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const linea = process.env.LINEA_URL && process.env.ECHO_SERVICE_KEY ? serviceClient({ baseUrl: process.env.LINEA_URL, key: process.env.ECHO_SERVICE_KEY }) : null;
  createServer({ linea }).listen(PORT, () => console.info(`[echo-plugin] listening on ${PORT}`));
}
