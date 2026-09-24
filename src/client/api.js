const API_BASE = '/api';

// The access token lives in memory only. Script-readable storage (localStorage) is what
// an injected script could steal, so nothing that grants access is kept there. It is
// short-lived (15 minutes); a page reload gets a new one by trading the httpOnly refresh
// cookie, which scripts cannot read (see refreshSession).
let authToken = '';
let unauthorizedHandler = null;

export function setAuthToken(token) {
  authToken = token || '';
}

export function hasAuthToken() {
  return Boolean(authToken);
}

// Called when the session is over and cannot be renewed (for example, it was revoked).
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

// A harmless hint, not a credential: "this browser signed in recently". It only decides
// whether to try restoring a session on page load, so a first-time visitor does not make
// a request that is bound to fail.
const SESSION_HINT_KEY = 'it_ticketing_session';

export function sessionMayExist() {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch (_error) {
    return false; // Storage can be blocked (private mode).
  }
}

export function setSessionHint(present) {
  try {
    if (present) localStorage.setItem(SESSION_HINT_KEY, '1');
    else localStorage.removeItem(SESSION_HINT_KEY);
  } catch (_error) {
    // Ignore storage failures; the hint is only an optimisation.
  }
}

// Carries the HTTP status, the API's machine-readable `code` (branch on that, not
// on the wording of the message) and the request id the server logged, so an
// error shown to a user can be matched to a log line by support.
export class ApiError extends Error {
  constructor(message, { status, code, requestId } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code || '';
    this.requestId = requestId || '';
  }
}

async function readBody(response) {
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : { message: await response.text().catch(() => '') };
}

// The calls that establish or end a session. They are never retried after a refresh, and
// a 401 from them is an answer, not an expired session.
const SESSION_PATHS = new Set(['/auth/login', '/auth/refresh', '/auth/logout']);

function toApiError(response, data) {
  const message = typeof data.message === 'string' ? data.message.trim() : '';
  return new ApiError(message.slice(0, 300) || `Request failed with status ${response.status}.`, {
    status: response.status,
    code: typeof data.code === 'string' ? data.code : '',
    requestId: data.requestId || response.headers.get('x-request-id'),
  });
}

// Shared wrapper for every frontend API call. Keeping response parsing and
// error handling here means the React components can stay focused on UI state.
async function send(path, { headers, retry = true, ...options } = {}) {
  const hadToken = Boolean(authToken);
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(headers || {}),
      },
    });
  } catch (error) {
    // A cancelled request is not a failure; the caller already moved on.
    if (error.name === 'AbortError') throw error;
    // Network-level failures land here, for example when the API server is not
    // running locally or a Vercel deployment is missing its serverless routes.
    throw new ApiError(
      'Unable to reach the API. Check that the Vercel deployment includes the /api functions.'
    );
  }

  if (response.ok) return response;

  // Prefer JSON error messages from the API, but gracefully fall back to text
  // so the UI still shows something helpful for unexpected responses.
  const data = await readBody(response);

  let sessionEnded = false;
  if (response.status === 401 && hadToken && !SESSION_PATHS.has(path)) {
    // The 15-minute access token has probably expired. Renew it and repeat the call once.
    if (retry) {
      try {
        await refreshSession();
        return send(path, { headers, ...options, retry: false });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
      }
    }
    // The session cannot be renewed: it was ended, or the renewed token was refused too.
    setAuthToken('');
    unauthorizedHandler?.();
    sessionEnded = true;
  }

  const error = toApiError(response, data);
  // Lets the UI skip announcing this failure: the session handler already explained it.
  if (sessionEnded) error.sessionEnded = true;
  throw error;
}

async function request(path, options) {
  const response = await send(path, options);
  // DELETE /api/tickets/:id intentionally returns no response body.
  return response.status === 204 ? null : readBody(response);
}

function toQueryString(filters = {}) {
  // Only include filters that have values, so empty dropdowns mean "all".
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString() ? `?${params.toString()}` : '';
}

export function login(credentials) {
  return request('/auth/login', { method: 'POST', body: JSON.stringify(credentials) });
}

let refreshing = null;

// Trades the refresh cookie (which the browser sends by itself) for a new access token.
// A refresh token works once, so requests that expire together must share one refresh:
// two at the same moment would look like a stolen token and end the session.
export function refreshSession() {
  if (!refreshing) {
    refreshing = request('/auth/refresh', { method: 'POST' })
      .then((data) => {
        setAuthToken(data.token);
        return data;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

// Ends the session on the server, and forgets the token here whether or not that worked.
export function logout() {
  return request('/auth/logout', { method: 'POST' }).finally(() => setAuthToken(''));
}

export function fetchMe() {
  return request('/auth/me');
}

export function fetchDemoUsers() {
  return request('/auth/demo-users');
}

export function fetchTickets(filters = {}, { signal } = {}) {
  return request(`/tickets${toQueryString(filters)}`, { signal });
}

export async function exportTickets(filters = {}) {
  const response = await send(`/tickets/export${toQueryString(filters)}`);
  return response.blob();
}

export function fetchStats({ signal } = {}) {
  return request('/tickets/stats', { signal });
}

export function createTicket(ticket) {
  return request('/tickets', { method: 'POST', body: JSON.stringify(ticket) });
}

// `version` is the ticket's `__v` as last loaded. Sent as If-Match, it makes the
// API refuse the edit (409) if someone else changed the ticket in the meantime.
export function updateTicket(id, patch, { version } = {}) {
  return request(`/tickets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
    ...(Number.isInteger(version) ? { headers: { 'If-Match': `"${version}"` } } : {}),
  });
}

export function deleteTicket(id) {
  return request(`/tickets/${id}`, { method: 'DELETE' });
}
