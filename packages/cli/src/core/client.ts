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

/** The server did not take the sign-in and it could not be renewed: a new `login` is needed. */
export class SessionExpiredError extends Error {
  constructor() {
    super('Your session on the LINEA server expired.');
    this.name = 'SessionExpiredError';
  }
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
  'error_messages.no_linea_account':
    'That account has never signed in to this LINEA: sign in once with the browser (login <remote>) or a code (login <remote> --device) first; after that a token works.',
  'error_messages.device_flow_unavailable': 'This LINEA has no sign-in with a code for that remote: use the browser (login <remote>) or a token (login <remote> --token <token or file>).',
  'error_messages.device_flow_disabled': "The OAuth application of that remote does not allow the sign-in with a code (an administrator has to enable the device flow in it).",
  'error_messages.device_code_expired': 'The code expired before it was approved: run the command again.',
  'error_messages.device_access_denied': 'The sign-in was refused on the other screen.',
  'error_messages.git_host_not_linked': 'You have no account on that remote yet: remote link <remote>.',
  'error_messages.git_host_is_own': 'That is the account you sign in with here: it cannot be unlinked.',
  'error_messages.git_host_account_taken': 'That account already belongs to someone else on this LINEA.',
  'error_messages.git_host_validation': 'This LINEA does not have that remote on: remote shows the ones it has.',
  'error_messages.incorrect_credentials': 'Those credentials were not accepted.',
  'error_messages.too_many_attempts': 'Too many attempts: wait a little and try again.',
  'error_messages.code_validation':
    'GitLab did not send a valid authorization code — try /login again.',
  'error_messages.redirect_uri_validation':
    "The CLI's loopback redirect_uri was rejected by the server (must be a canonical http://127.0.0.1:<port>/callback or [::1] URI). Try /login again; if this persists, set LINEA_OAUTH_PORT to a different free port.",
};

export function handleApiError(error: unknown): string {
  if (error instanceof SessionExpiredError) return '✗ Your session on the LINEA server expired. Run: login  (or add --offline to work on this machine).';
  if (error instanceof SplalmError) {
    const known = CODE_MESSAGES[error.code];
    if (known) return known;
    const detail = error.code !== 'UNKNOWN_ERROR' ? error.code : error.message;
    switch (error.status) {
      case 400:
        return `Bad request — ${detail}. Check your input.`;
      case 401:
        return 'Unauthorized — your session has expired. Run: login  (or add --offline to work on this machine).';
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
      return `Cannot reach LINEA at ${baseUrl}. Check the address (server <url>). To work on this machine meanwhile: mode offline, or --offline for one command.`;
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

  if (res.status === 401 && !isRetry && currentJwt) {
    const refreshed = await doRefresh();
    if (refreshed) return apiRequest(method, urlPath, body, true);
    if (urlPath !== '/api/users/loginFromServiceToken') throw new SessionExpiredError();
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
  del: (p: string) => apiRequest('DELETE', p),
};
