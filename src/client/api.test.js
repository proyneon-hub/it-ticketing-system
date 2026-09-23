import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// api.js keeps the auth token in module state, so each test loads a fresh copy.
async function loadApi() {
  vi.resetModules();
  return import('./api.js');
}

const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

let fetchMock;

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
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

  it('sends the saved bearer token and persists it across page loads', async () => {
    let api = await loadApi();
    api.setAuthToken('abc.def');
    expect(localStorage.getItem('it_ticketing_token')).toBe('abc.def');

    api = await loadApi(); // A fresh page load reads the token back.
    expect(api.hasAuthToken()).toBe(true);
    fetchMock.mockResolvedValue(json({ total: 0 }));
    await api.fetchStats();

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer abc.def');
  });

  it('sends JSON bodies with a content type, and none on plain reads', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(json({ ticket: {} }));

    await api.createTicket({ title: 'x' });
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

  it('works when browser storage is unavailable', async () => {
    const api = await loadApi();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(() => api.setAuthToken('token')).not.toThrow();
    expect(api.hasAuthToken()).toBe(true);
  });
});

describe('errors', () => {
  it('raises an ApiError with the message, status and request id from the body', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(
      json({ message: 'Title is required.', requestId: 'req-42' }, { status: 400 })
    );

    const error = await api.createTicket({}).catch((caught) => caught);

    expect(error).toBeInstanceOf(api.ApiError);
    expect(error).toMatchObject({
      message: 'Title is required.',
      status: 400,
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
    expect(localStorage.getItem('it_ticketing_token')).toBeNull();
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
