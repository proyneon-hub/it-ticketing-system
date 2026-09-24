const API_BASE = '/api';
const TOKEN_KEY = 'it_ticketing_token';

function readStoredToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch (_error) {
    return ''; // Storage can be blocked (private mode); the session just will not persist.
  }
}

let authToken = readStoredToken();
let unauthorizedHandler = null;

export function setAuthToken(token) {
  authToken = token || '';
  try {
    if (authToken) {
      localStorage.setItem(TOKEN_KEY, authToken);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch (_error) {
    // Ignore storage failures; the in-memory token still works for this page.
  }
}

export function hasAuthToken() {
  return Boolean(authToken);
}

// Called when the API rejects a token we were holding (for example, it expired).
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

// Carries the HTTP status and the request id the server logged, so an error
// shown to a user can be matched to a log line by support.
export class ApiError extends Error {
  constructor(message, { status, requestId } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.requestId = requestId || '';
  }
}

async function readBody(response) {
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : { message: await response.text().catch(() => '') };
}

// Shared wrapper for every frontend API call. Keeping response parsing and
// error handling here means the React components can stay focused on UI state.
async function send(path, { headers, ...options } = {}) {
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
  const message = typeof data.message === 'string' ? data.message.trim() : '';

  if (response.status === 401 && hadToken) {
    setAuthToken('');
    unauthorizedHandler?.();
  }

  throw new ApiError(message.slice(0, 300) || `Request failed with status ${response.status}.`, {
    status: response.status,
    requestId: data.requestId || response.headers.get('x-request-id'),
  });
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
