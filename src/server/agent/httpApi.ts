import type { KbArticle, KbSearchResult } from '../../shared/kb-types';
import type { Comment, Ticket } from '../../shared/ticket-types';
import type { AgentApi, TicketSearch } from './types';

// The agent's way into the ticketing system: the same HTTP API a person's browser uses, called
// with the run's own short-lived token. Every read and write therefore passes through the API's
// validation, permissions and concurrency rules, and the API's token check is what confines the
// agent to one ticket. The agent has no other route to the data (docs/adr/009).

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

  async function get<T>(
    path: string,
    query: Record<string, string | number | undefined> = {}
  ): Promise<T> {
    const url = new URL(`${root}/api${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    const response = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
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

  return {
    async getTicket(id) {
      return (await get<{ ticket: Ticket }>(`/tickets/${encodeURIComponent(id)}`)).ticket;
    },
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
  };
}
