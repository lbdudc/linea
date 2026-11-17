import type { LoginResponse } from './types.js';

let baseUrl = 'http://localhost:3000';
let currentJwt = '';
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let persistToken: ((token: string) => void) | null = null;

export function configureClient(opts: { baseUrl?: string; token?: string }): void {
  if (opts.baseUrl) baseUrl = opts.baseUrl;
  if (opts.token !== undefined) currentJwt = opts.token;
}

export function onTokenRefreshed(fn: (token: string) => void): void {
  persistToken = fn;
}

export class SplalmError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: unknown;

  constructor(
    status: number,
    body: { message?: string; error?: string } & Record<string, unknown>,
  ) {
    super(body['message'] ?? `HTTP ${status}`);
    this.name = 'SplalmError';
    this.status = status;
    this.code = (body['error'] as string | undefined) ?? 'UNKNOWN_ERROR';
    this.details = body;
  }
}

const CODE_MESSAGES: Record<string, string> = {
  'error_messages.feature_selection_error':
    "The product's feature selection is invalid or empty — configure its features (or sensor model) before generating.",
  'error_messages.spec_object_validation': 'The product spec is malformed (missing spec object).',
  'error_messages.basicData_object_validation': 'The product spec is missing basicData.',
  'error_messages.basicData_name_validation': 'The product name is missing or invalid.',
  'error_messages.basicData_version_format': 'The product version must be in x.y.z form.',
  'error_messages.line_platform_not_found': 'The SPL has no platform code in GitLab yet.',
  'error_messages.code_validation':
    'GitLab did not send a valid authorization code — try /login again.',
  'error_messages.redirect_uri_validation':
    "The CLI's loopback redirect_uri was rejected by the server (must be a canonical http://127.0.0.1:<port>/callback or [::1] URI). Try /login again; if this persists, set LINEA_OAUTH_PORT to a different free port.",
};

export function handleApiError(error: unknown): string {
  if (error instanceof SplalmError) {
    const known = CODE_MESSAGES[error.code];
    if (known) return known;
    const detail = error.code !== 'UNKNOWN_ERROR' ? error.code : error.message;
    switch (error.status) {
      case 400:
        return `Bad request — ${detail}. Check your input.`;
      case 401:
        return 'Unauthorized — your session has expired. Run /login to sign in again.';
      case 403:
        return 'Permission denied — you need a higher GitLab access level (maintainer=40, owner=50) for this.';
      case 404:
        return `Not found — ${error.message}.`;
      case 409:
        return `Conflict — ${error.message}. A resource with that name may already exist.`;
      case 422:
        return `Validation failed — ${error.message}. Names allow [a-zA-Z0-9_.-] and versions must be x.y.z.`;
      default:
        return `SPLALM returned HTTP ${error.status} — ${error.message}.`;
    }
  }
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    const causeCode =
      cause && typeof cause === 'object' && 'code' in cause ? String((cause as { code: unknown }).code) : '';
    const blob = `${error.message} ${causeCode}`;
    if (error.message === 'fetch failed' || blob.includes('ECONNREFUSED') || blob.includes('ENOTFOUND')) {
      return `Cannot reach SPLALM at ${baseUrl}. Check the server is running and LINEA_BASE_URL is correct.`;
    }
    if (blob.includes('ETIMEDOUT') || blob.includes('timeout')) {
      return 'Request timed out. Generation can take several minutes.';
    }
    return error.message;
  }
  return String(error);
}

async function apiRequest(
  method: string,
  urlPath: string,
  body?: unknown,
  isRetry = false,
): Promise<unknown> {
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${currentJwt}`,
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(`${baseUrl}${urlPath}`, init);

  if (res.status === 401 && !isRetry) {
    const refreshed = await doRefresh();
    if (refreshed) return apiRequest(method, urlPath, body, true);
  }

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ message: res.statusText }))) as Record<
      string,
      unknown
    >;
    throw new SplalmError(
      res.status,
      err as { message?: string; error?: string } & Record<string, unknown>,
    );
  }

  if (res.status === 204) return null;
  return res.json();
}

async function doRefresh(): Promise<boolean> {
  if (!currentJwt) return false;
  try {
    const res = await fetch(`${baseUrl}/api/users/loginFromServiceToken`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentJwt}`,
      },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as LoginResponse;
    currentJwt = data.token;
    persistToken?.(currentJwt);
    scheduleRefresh();
    return true;
  } catch {
    return false;
  }
}

function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void doRefresh(), (6900 - 600) * 1000);
  refreshTimer.unref();
}

export function startAutoRefresh(): void {
  if (currentJwt) scheduleRefresh();
}

export const splalm = {
  get: (p: string) => apiRequest('GET', p),
  post: (p: string, b?: unknown) => apiRequest('POST', p, b),
  put: (p: string, b?: unknown) => apiRequest('PUT', p, b),
};
