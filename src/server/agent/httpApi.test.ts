import { ApiError, createHttpApi } from './httpApi';
import { TICKET_ID, makeArticle, makeComment, makeTicket } from '../__tests__/agentFakes';

interface Seen {
  url: URL;
  init: RequestInit;
}

// A fetch that records what it is asked and answers from a queue of [status, body].
function stubFetch(answers: [number, unknown][]) {
  const seen: Seen[] = [];
  const impl = (async (input: URL | string, init: RequestInit) => {
    seen.push({ url: new URL(String(input)), init });
    const [status, body] = answers.shift() ?? [200, {}];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, seen };
}

const api = (
  answers: [number, unknown][],
  options: { requestId?: string; baseUrl?: string } = {}
) => {
  const fetchStub = stubFetch(answers);
  return {
    ...fetchStub,
    api: createHttpApi({
      baseUrl: options.baseUrl ?? 'https://desk.example.com',
      token: 'the-run-token',
      requestId: options.requestId,
      fetchImpl: fetchStub.impl,
    }),
  };
};

describe('every request', () => {
  test('carries the run’s token, and the request id when there is one', async () => {
    const { api: client, seen } = api([[200, { ticket: makeTicket() }]], { requestId: 'req-42' });
    await client.getTicket(TICKET_ID);
    const headers = seen[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer the-run-token');
    expect(headers['x-request-id']).toBe('req-42');
    expect(headers.accept).toBe('application/json');
  });

  test('omits the request id header when there is none', async () => {
    const { api: client, seen } = api([[200, { ticket: makeTicket() }]]);
    await client.getTicket(TICKET_ID);
    expect(seen[0]?.init.headers).not.toHaveProperty('x-request-id');
  });

  test('has a timeout, and never follows a redirect (which could send the token elsewhere)', async () => {
    const { api: client, seen } = api([[200, { ticket: makeTicket() }]]);
    await client.getTicket(TICKET_ID);
    expect(seen[0]?.init.redirect).toBe('error');
    expect(seen[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  test('is a GET, and only ever a GET: the agent reads through this client and writes elsewhere', async () => {
    const { api: client, seen } = api([
      [200, { ticket: makeTicket() }],
      [200, { comments: [] }],
      [200, { tickets: [] }],
      [200, { articles: [] }],
      [200, { article: makeArticle() }],
    ]);
    await client.getTicket(TICKET_ID);
    await client.getComments(TICKET_ID);
    await client.listTickets({ search: 'vpn' });
    await client.searchKb({ search: 'vpn' });
    await client.getKbArticle('KB-006');
    for (const request of seen) expect(request.init.method ?? 'GET').toBe('GET');
    expect(seen.every((request) => request.init.body === undefined)).toBe(true);
  });

  test('joins the base address without doubling a slash, including one with a trailing slash', async () => {
    for (const baseUrl of [
      'https://desk.example.com',
      'https://desk.example.com/',
      'https://desk.example.com///',
    ]) {
      const { api: client, seen } = api([[200, { ticket: makeTicket() }]], { baseUrl });
      await client.getTicket(TICKET_ID);
      expect(seen[0]?.url.href).toBe(`https://desk.example.com/api/tickets/${TICKET_ID}`);
    }
  });
});

describe('what it asks for', () => {
  test('reads a ticket and its comments by id, encoding the id', async () => {
    const { api: client, seen } = api([
      [200, { ticket: makeTicket() }],
      [200, { comments: [makeComment()] }],
    ]);
    expect((await client.getTicket(TICKET_ID)).ticketNumber).toBe('TKT-0100');
    expect(await client.getComments(TICKET_ID)).toHaveLength(1);
    expect(seen[1]?.url.pathname).toBe(`/api/tickets/${TICKET_ID}/comments`);
  });

  test('an id with odd characters cannot change the path it is sent to', async () => {
    const { api: client, seen } = api([[200, { article: makeArticle() }]]);
    await client.getKbArticle('../users?role=admin');
    expect(seen[0]?.url.pathname).toBe('/api/kb/..%2Fusers%3Frole%3Dadmin');
    expect(seen[0]?.url.search).toBe('');
  });

  test('lists tickets by search or by requester, newest first, leaving out what is blank', async () => {
    const { api: client, seen } = api([
      [200, { tickets: [makeTicket()] }],
      [200, { tickets: [] }],
    ]);
    await client.listTickets({ search: 'vpn', limit: 6 });
    await client.listTickets({ requesterEmail: 'una@example.com', search: '' });

    expect(Object.fromEntries(seen[0]?.url.searchParams ?? [])).toEqual({
      search: 'vpn',
      limit: '6',
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    expect(Object.fromEntries(seen[1]?.url.searchParams ?? [])).toEqual({
      requesterEmail: 'una@example.com',
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
  });

  test('searches the knowledge base, with a category when given', async () => {
    const { api: client, seen } = api([[200, { articles: [] }]]);
    await client.searchKb({ search: 'vpn drops', category: 'Network', limit: 5 });
    expect(seen[0]?.url.pathname).toBe('/api/kb');
    expect(Object.fromEntries(seen[0]?.url.searchParams ?? [])).toEqual({
      search: 'vpn drops',
      category: 'Network',
      limit: '5',
    });
  });

  test('text with symbols stays in its own parameter', async () => {
    const { api: client, seen } = api([[200, { articles: [] }]]);
    await client.searchKb({ search: 'a&role=admin#x' });
    expect(seen[0]?.url.searchParams.get('search')).toBe('a&role=admin#x');
    expect(seen[0]?.url.searchParams.has('role')).toBe(false);
  });
});

describe('when the API refuses', () => {
  test.each([
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
  ])('a %i becomes an ApiError with the status and the API’s own code', async (status, code) => {
    const { api: client } = api([[status, { code, message: 'SOMETHING A PERSON TYPED' }]]);
    const error = await client.getTicket(TICKET_ID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, code });
  });

  test('never carries the response body, which can hold what a person typed', async () => {
    const { api: client } = api([
      [400, { code: 'VALIDATION_FAILED', message: 'PRIVATE TICKET TEXT' }],
    ]);
    const error = (await client.getTicket(TICKET_ID).catch((e: unknown) => e)) as ApiError;
    expect(error.message).toBe('The ticketing API answered 400.');
    expect(JSON.stringify(error)).not.toContain('PRIVATE TICKET TEXT');
  });

  test('an answer that is not JSON is still an ApiError, with no code', async () => {
    const { api: client } = api([[502, '<html>Bad gateway</html>']]);
    const error = (await client.getTicket(TICKET_ID).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, code: undefined });
  });

  test('a code that is not text is not trusted', async () => {
    const { api: client } = api([[500, { code: { nested: 'object' } }]]);
    const error = (await client.getTicket(TICKET_ID).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBeUndefined();
  });
});
