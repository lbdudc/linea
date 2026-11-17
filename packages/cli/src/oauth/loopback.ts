import http from 'http';
import crypto from 'crypto';
import open from 'open';

export interface LoopbackResult {
  code: string;
  redirectUri: string;
}

const PAGE = (ok: boolean, detail?: string): string => `<!doctype html><html><head>
<meta charset="utf-8"><title>linea</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#f1f5f9;display:flex;
height:100vh;margin:0;align-items:center;justify-content:center}
.card{text-align:center}h1{color:${ok ? '#4ade80' : '#f87171'}}p{color:#94a3b8}</style></head>
<body><div class="card"><h1>${ok ? '✓ Signed in' : '✗ Sign-in failed'}</h1>
<p>${ok ? 'You can close this tab and return to the terminal.' : detail ?? 'Please try again.'}</p>
</div></body></html>`;

export function buildAuthorizeUrl(opts: {
  authorizeBase: string;
  /** The full address of the host's authorize page, when the server says it (GitHub's is not GitLab's). */
  authorizeUrl?: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const { authorizeBase, authorizeUrl, clientId, redirectUri, state, scope = 'api' } = opts;
  return (
    (authorizeUrl ?? `${authorizeBase.replace(/\/$/, '')}/oauth/authorize`) +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code&scope=${encodeURIComponent(scope)}&state=${state}`
  );
}

export async function runLoopbackOAuth(opts: {
  authorizeBase: string;
  authorizeUrl?: string;
  clientId: string;
  port: number;
  scope?: string;
  onUrl?: (url: string) => void;
  timeoutMs?: number;
}): Promise<LoopbackResult> {
  const { authorizeBase, authorizeUrl: hostAuthorizeUrl, clientId, port, scope = 'api', onUrl, timeoutMs = 180_000 } = opts;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const state = crypto.randomBytes(16).toString('hex');
  const authorizeUrl = buildAuthorizeUrl({ authorizeBase, ...(hostAuthorizeUrl ? { authorizeUrl: hostAuthorizeUrl } : {}), clientId, redirectUri, state, scope });

  return new Promise<LoopbackResult>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', redirectUri);
      if (url.pathname !== '/callback') {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const oauthError = url.searchParams.get('error');

      const done = (ok: boolean, detail?: string) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(PAGE(ok, detail));
        cleanup();
      };

      if (oauthError) {
        done(false, oauthError);
        reject(new Error(`The git host returned an error: ${oauthError}`));
      } else if (!code || returnedState !== state) {
        done(false, 'state mismatch');
        reject(new Error('OAuth state mismatch — aborting for safety.'));
      } else {
        done(true);
        resolve({ code, redirectUri });
      }
    });

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Login timed out waiting for the browser callback.'));
    }, timeoutMs);
    timer.unref();

    function cleanup() {
      clearTimeout(timer);
      server.close();
    }

    server.on('error', (err) => {
      clearTimeout(timer);
      reject(
        (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
          ? new Error(`Port ${port} is in use. Set LINEA_OAUTH_PORT to a free port.`)
          : err,
      );
    });

    server.listen(port, '127.0.0.1', () => {
      onUrl?.(authorizeUrl);
      void open(authorizeUrl).catch(() => {
        /* browser launch failed — the user can copy the URL from the printed line */
      });
    });
  });
}
