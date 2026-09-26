// Fakes for testing the agent without a database, a network or a model: a ticketing API held in
// memory, a recorder that keeps what it is given, and a run context wired to both. The real loop,
// registry and tools run against these unchanged.
import type { AgentPolicySettings } from '../domain/agentPolicy';
import { ApiError } from '../agent/httpApi';
import type {
  AgentApi,
  ModelClient,
  RunContext,
  RunLimits,
  StepRecord,
  TicketSearch,
} from '../agent/types';
import type { AgentRunMode } from '../../shared/agent-constants';
import type { KbArticle, KbSearchResult } from '../../shared/kb-types';
import type { Comment, Ticket } from '../../shared/ticket-types';

export const TICKET_ID = '665f0f40d5d4f541f8ef2002';
export const OTHER_TICKET_ID = '665f0f40d5d4f541f8ef2003';

export const makeTicket = (overrides: Partial<Ticket> = {}): Ticket => ({
  _id: TICKET_ID,
  __v: 0,
  ticketNumber: 'TKT-0100',
  title: 'VPN keeps disconnecting',
  description: 'The VPN drops every few minutes when I am on a call.',
  requesterName: 'Una User',
  requesterEmail: 'una@example.com',
  requesterUserId: 'usr_una',
  status: 'open',
  priority: 'medium',
  assignee: 'Unassigned',
  category: 'General Support',
  dueAt: '2026-09-27T12:00:00.000Z',
  createdAt: '2026-09-25T12:00:00.000Z',
  updatedAt: '2026-09-25T12:00:00.000Z',
  activity: [],
  createdByRole: 'user',
  ...overrides,
});

export const makeComment = (overrides: Partial<Comment> = {}): Comment => ({
  _id: '665f0f40d5d4f541f8ef3001',
  ticketId: TICKET_ID,
  body: 'It is still happening.',
  visibility: 'public',
  author: { id: 'usr_una', name: 'Una User', email: 'una@example.com', role: 'user' },
  createdAt: '2026-09-25T13:00:00.000Z',
  ...overrides,
});

export const makeArticle = (overrides: Partial<KbArticle> = {}): KbArticle => ({
  id: 'KB-006',
  title: 'VPN keeps disconnecting',
  category: 'Network',
  lastReviewed: '2026-09-01',
  appliesTo: ['Windows', 'macOS'],
  body: '# VPN keeps disconnecting\n\n1. Check your home internet.\n2. Reconnect the VPN.\n',
  ...overrides,
});

export interface FakeApi extends AgentApi {
  // Every call made, as "name arg", in order.
  calls: string[];
  articles: KbArticle[];
  tickets: Ticket[];
  comments: Comment[];
  // Set to make the next call of that method fail.
  failWith: { method: keyof AgentApi; error: unknown } | undefined;
}

export function fakeApi(
  initial: {
    ticket?: Ticket;
    articles?: KbArticle[];
    tickets?: Ticket[];
    comments?: Comment[];
  } = {}
): FakeApi {
  const ticket = initial.ticket ?? makeTicket();
  const api: FakeApi = {
    calls: [],
    articles: initial.articles ?? [makeArticle()],
    tickets: initial.tickets ?? [],
    comments: initial.comments ?? [],
    failWith: undefined,

    async getTicket(id) {
      return track('getTicket', id, () => {
        if (id !== ticket._id) throw new ApiError(403, 'FORBIDDEN', 'forbidden');
        return ticket;
      });
    },
    async getComments(id) {
      return track('getComments', id, () => api.comments);
    },
    async listTickets(query: TicketSearch) {
      return track('listTickets', JSON.stringify(query), () =>
        api.tickets
          .filter((t) => !query.requesterEmail || t.requesterEmail === query.requesterEmail)
          .filter(
            (t) =>
              !query.search ||
              query.search
                .toLowerCase()
                .split(/\s+/)
                .some((word) => t.title.toLowerCase().includes(word))
          )
          .slice(0, query.limit ?? 10)
      );
    },
    async searchKb(query) {
      return track('searchKb', query.search, () => {
        const words = query.search.toLowerCase().split(/\s+/);
        return api.articles
          .filter((a) => words.some((w) => `${a.title} ${a.body}`.toLowerCase().includes(w)))
          .filter((a) => !query.category || a.category === query.category)
          .slice(0, query.limit ?? 5)
          .map((a): KbSearchResult => ({
            id: a.id,
            title: a.title,
            category: a.category,
            lastReviewed: a.lastReviewed,
            snippet: a.body.slice(0, 80),
          }));
      });
    },
    async getKbArticle(id) {
      return track('getKbArticle', id, () => {
        const found = api.articles.find((a) => a.id === id);
        if (!found) throw new ApiError(404, 'NOT_FOUND', 'not found');
        return found;
      });
    },
    async setTriage(id, triage) {
      return track(
        'setTriage',
        `${id} ${triage.category}/${triage.priority}/${triage.assigneeGroup}`,
        () => {
          if (id !== ticket._id) throw new ApiError(403, 'FORBIDDEN', 'forbidden');
        }
      );
    },
    async postResolution(input) {
      return track(
        'postResolution',
        `${input.ticketId} ${input.confidence} ${input.citedKbIds.join(',')}`,
        () => {
          if (input.ticketId !== ticket._id) throw new ApiError(403, 'FORBIDDEN', 'forbidden');
        }
      );
    },
    async escalate(input) {
      return track('escalate', `${input.ticketId} ${input.assigneeGroup} ${input.reason}`, () => {
        if (input.ticketId !== ticket._id) throw new ApiError(403, 'FORBIDDEN', 'forbidden');
      });
    },
  };

  // Records the call, and applies a queued failure to the next call of that method.
  function track<T>(method: keyof AgentApi, arg: string, work: () => T): T {
    api.calls.push(`${method} ${arg}`);
    if (api.failWith?.method === method) {
      const { error } = api.failWith;
      api.failWith = undefined;
      throw error;
    }
    return work();
  }

  return api;
}

export const baseSettings = (
  overrides: Partial<AgentPolicySettings & { dailyCostCapUsd: number }> = {}
): AgentPolicySettings & { dailyCostCapUsd: number } => ({
  killSwitch: false,
  defaultMode: 'shadow',
  modeByCategory: {},
  autoAllowlist: [],
  dailyCostCapUsd: 100,
  ...overrides,
});

export const defaultLimits: RunLimits = {
  maxSteps: 8,
  maxTokens: 1_000_000,
  maxOutputTokens: 2048,
};

export interface Harness {
  ctx: RunContext;
  api: FakeApi;
  steps: StepRecord[];
  // Change what the settings say between steps.
  settings: { current: ReturnType<typeof baseSettings>; reads: number };
  spent: { usd: number };
}

export function harness(options: {
  modelClient: ModelClient;
  mode?: AgentRunMode;
  api?: FakeApi;
  model?: string;
  limits?: Partial<RunLimits>;
  settings?: Partial<AgentPolicySettings & { dailyCostCapUsd: number }>;
}): Harness {
  const api = options.api ?? fakeApi();
  const steps: StepRecord[] = [];
  const settings = { current: baseSettings(options.settings), reads: 0 };
  const spent = { usd: 0 };
  let clock = 0;

  const ctx: RunContext = {
    ticketId: TICKET_ID,
    runId: 'run-1',
    mode: options.mode ?? 'shadow',
    model: options.model ?? 'claude-haiku-4-5',
    system: 'SYSTEM PROMPT',
    api,
    modelClient: options.modelClient,
    recorder: {
      async step(record) {
        steps.push(record);
      },
    },
    limits: { ...defaultLimits, ...options.limits },
    async settings() {
      settings.reads += 1;
      return settings.current;
    },
    async spentTodayUsd() {
      return spent.usd;
    },
    now: () => (clock += 10),
  };
  return { ctx, api, steps, settings, spent };
}
