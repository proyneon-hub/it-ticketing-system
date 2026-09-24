import type {
  AuditPage,
  AuditQuery,
  Comment,
  CommentVisibility,
  Credentials,
  DemoUser,
  LoginResponse,
  Role,
  Stats,
  Ticket,
  TicketChanges,
  TicketFilters,
  TicketForm,
  TicketPage,
  Trends,
  User,
  UserSummary,
} from './types';

const API_BASE = '/api';

// The access token lives in memory only. Script-readable storage (localStorage) is what
// an injected script could steal, so nothing that grants access is kept there. It is
// short-lived (15 minutes); a page reload gets a new one by trading the httpOnly refresh
// cookie, which scripts cannot read (see refreshSession).
let authToken = '';
let unauthorizedHandler: (() => void) | null = null;

export function setAuthToken(token: string | null | undefined): void {
  authToken = token || '';
}

export function hasAuthToken(): boolean {
  return Boolean(authToken);
}

// Called when the session is over and cannot be renewed (for example, it was revoked).
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

// A harmless hint, not a credential: "this browser signed in recently". It only decides
// whether to try restoring a session on page load, so a first-time visitor does not make
// a request that is bound to fail.
const SESSION_HINT_KEY = 'it_ticketing_session';

export function sessionMayExist(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch (_error) {
    return false; // Storage can be blocked (private mode).
  }
}

export function setSessionHint(present: boolean): void {
  try {
    if (present) localStorage.setItem(SESSION_HINT_KEY, '1');
    else localStorage.removeItem(SESSION_HINT_KEY);
  } catch (_error) {
    // Ignore storage failures; the hint is only an optimisation.
  }
}

interface ApiErrorDetails {
  status?: number | undefined;
  code?: string | undefined;
  requestId?: string | null | undefined;
}

// Carries the HTTP status, the API's machine-readable `code` (branch on that, not
// on the wording of the message) and the request id the server logged, so an
// error shown to a user can be matched to a log line by support.
export class ApiError extends Error {
  status: number | undefined;
  code: string;
  requestId: string;
  // Set when this failure is what ended the session: the app has already told the user,
  // so the notice layer must not show it as well.
  sessionEnded = false;

  constructor(message: string, { status, code, requestId }: ApiErrorDetails = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code || '';
    this.requestId = requestId || '';
  }
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : { message: await response.text().catch(() => '') };
}

// The calls that establish or end a session. They are never retried after a refresh, and
// a 401 from them is an answer, not an expired session.
const SESSION_PATHS = new Set(['/auth/login', '/auth/refresh', '/auth/logout']);

function toApiError(response: Response, data: Record<string, unknown>): ApiError {
  const message = typeof data.message === 'string' ? data.message.trim() : '';
  return new ApiError(message.slice(0, 300) || `Request failed with status ${response.status}.`, {
    status: response.status,
    code: typeof data.code === 'string' ? data.code : '',
    requestId: (data.requestId as string | undefined) || response.headers.get('x-request-id'),
  });
}

interface SendOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
  retry?: boolean;
}

// Shared wrapper for every frontend API call. Keeping response parsing and
// error handling here means the React components can stay focused on UI state.
async function send(
  path: string,
  { headers, retry = true, ...options }: SendOptions = {}
): Promise<Response> {
  const hadToken = Boolean(authToken);
  let response: Response;

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
    if ((error as Error).name === 'AbortError') throw error;
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

async function request<T>(path: string, options?: SendOptions): Promise<T> {
  const response = await send(path, options);
  // DELETE /api/tickets/:id and logout intentionally return no response body.
  return (response.status === 204 ? null : await readBody(response)) as T;
}

function toQueryString(values: object = {}): string {
  // Only include values that are set, so empty dropdowns mean "all".
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value) params.set(key, String(value));
  });
  return params.toString() ? `?${params.toString()}` : '';
}

export function login(credentials: Credentials): Promise<LoginResponse> {
  return request('/auth/login', { method: 'POST', body: JSON.stringify(credentials) });
}

let refreshing: Promise<LoginResponse> | null = null;

// Trades the refresh cookie (which the browser sends by itself) for a new access token.
// A refresh token works once, so requests that expire together must share one refresh:
// two at the same moment would look like a stolen token and end the session.
export function refreshSession(): Promise<LoginResponse> {
  if (!refreshing) {
    refreshing = request<LoginResponse>('/auth/refresh', { method: 'POST' })
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
export function logout(): Promise<null> {
  return request<null>('/auth/logout', { method: 'POST' }).finally(() => setAuthToken(''));
}

export function fetchMe(): Promise<{ user: User }> {
  return request('/auth/me');
}

export function fetchDemoUsers(): Promise<{ users: DemoUser[] }> {
  return request('/auth/demo-users');
}

interface Cancellable {
  signal?: AbortSignal | undefined;
}

export function fetchTickets(
  filters: Partial<TicketFilters> = {},
  { signal }: Cancellable = {}
): Promise<TicketPage> {
  return request(`/tickets${toQueryString(filters)}`, { signal });
}

export async function exportTickets(filters: Partial<TicketFilters> = {}): Promise<Blob> {
  const response = await send(`/tickets/export${toQueryString(filters)}`);
  return response.blob();
}

export function fetchStats({ signal }: Cancellable = {}): Promise<Stats> {
  return request('/tickets/stats', { signal });
}

export function fetchTrends(
  { days, tz }: { days: number; tz: string },
  { signal }: Cancellable = {}
): Promise<Trends> {
  return request(`/tickets/stats/trends${toQueryString({ days, tz })}`, { signal });
}

export function fetchComments(
  ticketId: string,
  { signal }: Cancellable = {}
): Promise<{ comments: Comment[] }> {
  return request(`/tickets/${ticketId}/comments`, { signal });
}

export function addComment(
  ticketId: string,
  comment: { body: string; visibility: CommentVisibility }
): Promise<{ comment: Comment }> {
  return request(`/tickets/${ticketId}/comments`, {
    method: 'POST',
    body: JSON.stringify(comment),
  });
}

export function fetchTicket(id: string, { signal }: Cancellable = {}): Promise<{ ticket: Ticket }> {
  return request(`/tickets/${id}`, { signal });
}

export function createTicket(ticket: TicketForm): Promise<{ ticket: Ticket }> {
  return request('/tickets', { method: 'POST', body: JSON.stringify(ticket) });
}

// `version` is the ticket's `__v` as last loaded. Sent as If-Match, it makes the
// API refuse the edit (409) if someone else changed the ticket in the meantime.
export function updateTicket(
  id: string,
  patch: TicketChanges,
  { version }: { version?: number | undefined } = {}
): Promise<{ ticket: Ticket }> {
  return request(`/tickets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
    ...(Number.isInteger(version) ? { headers: { 'If-Match': `"${version}"` } } : {}),
  });
}

export function deleteTicket(id: string): Promise<null> {
  return request(`/tickets/${id}`, { method: 'DELETE' });
}

export function fetchUsers({ signal }: Cancellable = {}): Promise<{ users: UserSummary[] }> {
  return request('/users', { signal });
}

export function changeUserRole(id: string, role: Role): Promise<{ user: User }> {
  return request(`/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) });
}

export function fetchAudit(
  query: Partial<AuditQuery> = {},
  { signal }: Cancellable = {}
): Promise<AuditPage> {
  return request(`/audit${toQueryString(query)}`, { signal });
}
