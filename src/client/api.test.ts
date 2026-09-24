import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// api.js keeps the auth token in module state, so each test loads a fresh copy.
async function loadApi() {
  vi.resetModules();
  return import('./api');
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('updateTicket', () => {
  it('sends the ticket version as X-Ticket-Version so a stale edit is refused', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(json({ ticket: {} }));

    await api.updateTicket('abc', { priority: 'high' }, { version: 3 });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/tickets/abc');
    expect(options.method).toBe('PATCH');
    expect(options.headers['X-Ticket-Version']).toBe('3');
    // Not If-Match: some hosts answer that header themselves (see the API notes).
    expect(options.headers['If-Match']).toBeUndefined();
  });

  it('sends no version when it is unknown, and treats version 0 as known', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(json({ ticket: {} }));

    await api.updateTicket('abc', { priority: 'high' });
    await api.updateTicket('abc', { priority: 'high' }, { version: 0 });

    expect(fetchMock.mock.calls[0][1].headers['X-Ticket-Version']).toBeUndefined();
    expect(fetchMock.mock.calls[1][1].headers['X-Ticket-Version']).toBe('0');
  });
});

describe('requests', () => {
  it('leaves empty filters out of the query string and forwards the abort signal', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(json({ data: [] }));
    const controller = new AbortController();

    await api.fetchTickets(
      { status: '', priority: 'high', search: 'vpn', page: 2 },
      { signal: controller.signal }
    );

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/tickets?priority=high&search=vpn&page=2');
    expect(options.signal).toBe(controller.signal);
  });

  it('sends the access token as a bearer token, and holds it in memory only', async () => {
    let api = await loadApi();
    api.setAuthToken('abc.def');
    fetchMock.mockResolvedValue(json({ total: 0 }));
    await api.fetchStats();

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer abc.def');
    // Script-readable storage is exactly what an injected script could steal.
    expect(JSON.stringify({ ...localStorage })).not.toContain('abc.def');

    api = await loadApi(); // A fresh page load has no token until the session is restored.
    expect(api.hasAuthToken()).toBe(false);
  });

  it('sends JSON bodies with a content type, and none on plain reads', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(json({ ticket: {} }));

    await api.createTicket({ title: 'x' } as never);
    await api.fetchStats();

    expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
    expect(fetchMock.mock.calls[1][1].headers['Content-Type']).toBeUndefined();
  });

  it('returns null for a 204 response such as a delete', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(api.deleteTicket('1')).resolves.toBeNull();
  });

  it('downloads an export as a blob', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(new Response('Ticket ID,Title', { status: 200 }));

    const blob = await api.exportTickets({ status: 'open' });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/tickets/export?status=open');
    expect(await blob.text()).toBe('Ticket ID,Title');
  });

  it('remembers only a hint that a session may exist, and works when storage is blocked', async () => {
    let api = await loadApi();
    expect(api.sessionMayExist()).toBe(false);
    api.setSessionHint(true);

    api = await loadApi(); // A page reload.
    expect(api.sessionMayExist()).toBe(true);
    api.setSessionHint(false);
    expect(api.sessionMayExist()).toBe(false);

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => api.setSessionHint(true)).not.toThrow();
  });
});

describe('errors', () => {
  it('raises an ApiError with the message, status and request id from the body', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(
      json(
        { message: 'Title is required.', code: 'VALIDATION_FAILED', requestId: 'req-42' },
        { status: 400 }
      )
    );

    const error = await api.createTicket({} as never).catch((caught) => caught);

    expect(error).toBeInstanceOf(api.ApiError);
    expect(error).toMatchObject({
      message: 'Title is required.',
      status: 400,
      code: 'VALIDATION_FAILED',
      requestId: 'req-42',
    });
  });

  it('falls back to the x-request-id header and to a generic message', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(
      new Response('', { status: 502, headers: { 'x-request-id': 'edge-7' } })
    );

    const error = await api.fetchStats().catch((caught) => caught);

    expect(error.message).toBe('Request failed with status 502.');
    expect(error.requestId).toBe('edge-7');
    expect(error.code).toBe(''); // A proxy error has no API code.
  });

  it('truncates very long error messages', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(new Response('x'.repeat(1000), { status: 500 }));

    const error = await api.fetchStats().catch((caught) => caught);

    expect(error.message).toHaveLength(300);
  });

  it('explains network failures in plain language', async () => {
    const api = await loadApi();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(api.fetchStats()).rejects.toThrow(/Unable to reach the API/);
  });

  it('passes a cancelled request through untouched', async () => {
    const api = await loadApi();
    const abort = new DOMException('Aborted', 'AbortError');
    fetchMock.mockRejectedValue(abort);

    await expect(api.fetchStats()).rejects.toBe(abort);
  });
});

describe('expired sessions', () => {
  it('clears the token and notifies the app when the API rejects a held token', async () => {
    const api = await loadApi();
    const handler = vi.fn();
    api.onUnauthorized(handler);
    api.setAuthToken('stale');
    fetchMock.mockResolvedValue(json({ message: 'Authentication required.' }, { status: 401 }));

    await expect(api.fetchStats()).rejects.toThrow('Authentication required.');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(api.hasAuthToken()).toBe(false);
  });

  it('does not treat a failed sign-in as an expired session', async () => {
    const api = await loadApi();
    const handler = vi.fn();
    api.onUnauthorized(handler);
    fetchMock.mockResolvedValue(json({ message: 'Invalid email or password.' }, { status: 401 }));

    await expect(api.login({ email: 'a', password: 'b' })).rejects.toThrow('Invalid email');

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('refreshing an expired access token', () => {
  const unauthorized = () =>
    json({ message: 'Authentication required.', code: 'UNAUTHORIZED' }, { status: 401 });

  const refreshed = (token: string) =>
    json({ token, user: { id: 'usr_1', name: 'A', email: 'a@b.c', role: 'admin' } });

  // Answers each call by its URL, so the order requests happen in does not matter.

  function route(handlers: Record<string, (options: any) => Response | Promise<Response>>) {
    fetchMock.mockImplementation(async (url: string, options?: any) => {
      const handler = handlers[`${options?.method || 'GET'} ${url}`];

      if (!handler) throw new Error(`Unexpected request ${options?.method || 'GET'} ${url}`);

      return handler(options);
    });
  }

  it('silently refreshes on a 401 and repeats the request with the new token', async () => {
    const api = await loadApi();

    const handler = vi.fn();

    api.onUnauthorized(handler);

    api.setAuthToken('expired');

    const seen: string[] = [];

    route({
      'GET /api/tickets/stats': (options: any) => {
        seen.push(options.headers.Authorization);

        return seen.length === 1 ? unauthorized() : json({ total: 7 });
      },

      'POST /api/auth/refresh': () => refreshed('fresh'),
    });

    await expect(api.fetchStats()).resolves.toEqual({ total: 7 });

    expect(seen).toEqual(['Bearer expired', 'Bearer fresh']);

    expect(handler).not.toHaveBeenCalled();

    expect(api.hasAuthToken()).toBe(true);
  });

  it('shares one refresh between requests that expire together', async () => {
    const api = await loadApi();

    api.setAuthToken('expired');

    let refreshes = 0;

    route({
      'GET /api/tickets/stats': (options: any) =>
        options.headers.Authorization === 'Bearer fresh' ? json({ ok: 1 }) : unauthorized(),

      'GET /api/tickets?page=1': (options: any) =>
        options.headers.Authorization === 'Bearer fresh' ? json({ ok: 2 }) : unauthorized(),

      'POST /api/auth/refresh': () => {
        refreshes += 1;

        return refreshed('fresh');
      },
    });

    // A refresh token works once; two concurrent refreshes would end the session.

    const results = await Promise.all([api.fetchStats(), api.fetchTickets({ page: 1 })]);

    expect(results).toEqual([{ ok: 1 }, { ok: 2 }]);

    expect(refreshes).toBe(1);
  });

  it('signs out and reports the original error when the refresh is refused', async () => {
    const api = await loadApi();

    const handler = vi.fn();

    api.onUnauthorized(handler);

    api.setAuthToken('expired');

    route({
      'GET /api/tickets/stats': unauthorized,

      'POST /api/auth/refresh': () => json({ message: 'Session expired.' }, { status: 401 }),
    });

    const error = await api.fetchStats().catch((caught) => caught);

    expect(error).toMatchObject({ status: 401 });
    // The app already told the user their session ended; the failing request must not
    // announce a second, less helpful "Authentication required." over it.
    expect(error.sessionEnded).toBe(true);

    expect(handler).toHaveBeenCalledTimes(1);

    expect(api.hasAuthToken()).toBe(false);
  });

  it('retries only once: a second 401 after a good refresh ends the session', async () => {
    const api = await loadApi();

    const handler = vi.fn();

    api.onUnauthorized(handler);

    api.setAuthToken('expired');

    let attempts = 0;

    route({
      'GET /api/tickets/stats': () => {
        attempts += 1;

        return unauthorized();
      },

      'POST /api/auth/refresh': () => refreshed('fresh'),
    });

    await expect(api.fetchStats()).rejects.toMatchObject({ status: 401 });

    expect(attempts).toBe(2);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not try to refresh when there was no session, and never refreshes a refresh', async () => {
    const api = await loadApi();

    route({
      'GET /api/tickets/stats': unauthorized,

      'POST /api/auth/refresh': unauthorized,
    });

    await expect(api.fetchStats()).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).toHaveBeenCalledTimes(1); // No token held, so no refresh attempt.

    await expect(api.refreshSession()).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).toHaveBeenCalledTimes(2); // The failed refresh was not itself retried.
  });

  it('refreshSession stores the new access token and returns the user', async () => {
    const api = await loadApi();

    route({ 'POST /api/auth/refresh': () => refreshed('restored') });

    const data = await api.refreshSession();

    expect(data.user.role).toBe('admin');

    expect(api.hasAuthToken()).toBe(true);

    fetchMock.mockResolvedValue(json({ total: 0 }));

    await api.fetchStats();

    expect(fetchMock.mock.calls.at(-1)?.[1].headers.Authorization).toBe('Bearer restored');
  });

  it('logout tells the server, and forgets the token even if the server cannot be reached', async () => {
    const api = await loadApi();

    api.setAuthToken('abc');

    route({ 'POST /api/auth/logout': () => new Response(null, { status: 204 }) });

    await api.logout();

    expect(api.hasAuthToken()).toBe(false);

    api.setAuthToken('abc');

    fetchMock.mockRejectedValue(new TypeError('offline'));

    await expect(api.logout()).rejects.toThrow();

    expect(api.hasAuthToken()).toBe(false);
  });
});
