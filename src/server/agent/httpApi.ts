import type { KbArticle, KbSearchResult } from '../../shared/kb-types';
import type { Comment, Ticket } from '../../shared/ticket-types';
import type { AgentApi, TicketSearch } from './types';

// The agent's way into the ticketing system: the same HTTP API a person's browser uses, called
// with the run's own short-lived token. Every read and write therefore passes through the API's
// validation, permissions and concurrency rules, and the API's token check is what confines the
// agent to one ticket. The agent has no other route to the data (docs/adr/009). It makes two kinds
// of write, and only these: it sets a ticket's triage (PATCH /tickets/:id, guarded by the version it
// read), it hands the ticket over (POST /agent/escalations), and, in auto mode where the server allows
// it, it answers the ticket (POST /agent/resolutions).

// The API refused, or failed. Carries the status and the API's own stable error code, never the
// body, which may hold something a person typed.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

interface CallOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface HttpApiOptions {
  baseUrl: string;
  // The service token for this run (security/accessToken.ts issueServiceToken).
  token: string;
  requestId?: string | undefined;
  fetchImpl?: typeof fetch;
}

export function createHttpApi({
  baseUrl,
  token,
  requestId,
  fetchImpl = fetch,
}: HttpApiOptions): AgentApi {
  const root = baseUrl.replace(/\/+$/, '');

  async function call<T>(
    method: 'GET' | 'PATCH' | 'POST',
    path: string,
    { query = {}, body, headers = {} }: CallOptions = {}
  ): Promise<T> {
    const url = new URL(`${root}/api${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    const response = await fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(requestId ? { 'x-request-id': requestId } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'error',
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { code?: unknown };
      const code = typeof body.code === 'string' ? body.code : undefined;
      throw new ApiError(response.status, code, `The ticketing API answered ${response.status}.`);
    }
    return (await response.json()) as T;
  }

  const get = <T>(path: string, query: CallOptions['query'] = {}): Promise<T> =>
    call<T>('GET', path, { query });

  const getTicket = async (id: string): Promise<Ticket> =>
    (await get<{ ticket: Ticket }>(`/tickets/${encodeURIComponent(id)}`)).ticket;

  return {
    getTicket,
    async getComments(id) {
      return (await get<{ comments: Comment[] }>(`/tickets/${encodeURIComponent(id)}/comments`))
        .comments;
    },
    async listTickets(query: TicketSearch) {
      const body = await get<{ tickets: Ticket[] }>('/tickets', {
        search: query.search,
        requesterEmail: query.requesterEmail,
        limit: query.limit,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });
      return body.tickets;
    },
    async searchKb(query) {
      return (
        await get<{ articles: KbSearchResult[] }>('/kb', {
          search: query.search,
          category: query.category,
          limit: query.limit,
        })
      ).articles;
    },
    async getKbArticle(id) {
      return (await get<{ article: KbArticle }>(`/kb/${encodeURIComponent(id)}`)).article;
    },

    async setTriage(id, triage) {
      // Guarded by the version it read. If a person edited the ticket in between, read it again and
      // try once more; a second conflict means someone is working on it, and the agent steps back.
      for (let attempt = 1; ; attempt += 1) {
        const ticket = await getTicket(id);
        try {
          await call('PATCH', `/tickets/${encodeURIComponent(id)}`, {
            headers: { 'x-ticket-version': String(ticket.__v) },
            body: {
              category: triage.category,
              priority: triage.priority,
              // A ticket someone has already assigned keeps its owner.
              ...(ticket.assignee === 'Unassigned' ? { assignee: triage.assigneeGroup } : {}),
            },
          });
          return;
        } catch (error) {
          const conflict = error instanceof ApiError && error.code === 'VERSION_CONFLICT';
          if (!conflict || attempt >= 2) throw error;
        }
      }
    },

    async postResolution(input) {
      await call('POST', '/agent/resolutions', { body: input });
    },

    async escalate(input) {
      await call('POST', '/agent/escalations', { body: input });
    },
  };
}
