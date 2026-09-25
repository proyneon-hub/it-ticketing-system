import type {
  AgentRunDetail,
  AgentRunSummary,
  AgentSettings,
  ProposalView,
  Comment,
  DemoUser,
  Pagination,
  Stats,
  Ticket,
  TicketPage,
  Trends,
  User,
} from '../types';

const HOUR = 60 * 60 * 1000;

// Shapes copied from the real API (see src/server/openapi.json). Sign-in and refresh
// return the user as `id`, while a token payload (/auth/me) carries `sub` and `exp`.
// Tests that use one shape for both can hide bugs that only appear against the real server.
export const users = {
  admin: { id: 'usr_admin', name: 'Priya Admin', email: 'admin@demo.local', role: 'admin' },
  technician: {
    id: 'usr_tech',
    name: 'Theo Technician',
    email: 'tech@demo.local',
    role: 'technician',
  },
  user: { id: 'usr_user', name: 'Una User', email: 'user@demo.local', role: 'user' },
} satisfies Record<string, User>;

export const sessionUser = (user: User) => ({
  sub: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  exp: Math.floor(Date.now() / 1000) + 3600,
});

export const demoUsers: DemoUser[] = Object.values(users).map((user) => ({
  ...user,
  demoPassword: `${user.role}-password`,
}));

export function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    _id: '665f0f40d5d4f541f8ef1001',
    ticketNumber: 'TKT-0001',
    title: 'Laptop cannot connect to Wi-Fi',
    description: 'Drops from the corporate network.',
    requesterName: 'Avery Johnson',
    requesterEmail: 'avery@example.com',
    requesterUserId: '',
    status: 'open',
    priority: 'high',
    category: 'Network',
    assignee: 'Network Support',
    dueAt: new Date(Date.now() + 48 * HOUR).toISOString(),
    createdAt: new Date(Date.now() - 4 * HOUR).toISOString(),
    updatedAt: new Date(Date.now() - 2 * HOUR).toISOString(),
    createdByRole: 'user',
    activity: [],
    __v: 2,
    ...overrides,
  };
}

export function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    _id: '665f0f40d5d4f541f8ef2001',
    ticketId: '665f0f40d5d4f541f8ef1001',
    body: 'Looking into it.',
    visibility: 'public',
    author: {
      id: 'usr_tech',
      name: 'Theo Technician',
      email: 'tech@demo.local',
      role: 'technician',
    },
    createdAt: '2026-06-02T09:00:00.000Z',
    ...overrides,
  };
}

// Three days, with one resolved-in-time ticket and one late: 50% on time, 12.5 h on average.
export function makeTrends(overrides: Partial<Trends> = {}): Trends {
  return {
    days: 3,
    timeZone: 'America/Toronto',
    series: [
      { date: '2026-06-13', opened: 2, resolved: 0 },
      { date: '2026-06-14', opened: 5, resolved: 1 },
      { date: '2026-06-15', opened: 1, resolved: 1 },
    ],
    resolution: { resolved: 2, meanHours: 12.5 },
    sla: { resolved: 2, met: 1, compliancePercent: 50 },
    ...overrides,
  };
}

export const ticketPage = (
  tickets: Ticket[],
  pagination: Partial<Pagination> = {}
): TicketPage => ({
  data: tickets,
  tickets,
  pagination: { page: 1, limit: 10, total: tickets.length, totalPages: 1, ...pagination },
});

export const emptyStats: Stats = {
  total: 0,
  byStatus: {},
  byPriority: {},
  sla: { breached: 0, dueSoon: 0 },
};

// A promise the test resolves by hand, to control the order responses arrive in.
export function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function makeProposal(overrides: Partial<ProposalView> = {}): ProposalView {
  return {
    status: 'pending',
    runId: '665f0f40d5d4f541f8ef3001',
    proposal: {
      replyMarkdown: 'Reconnect the VPN, then restart your laptop if it still drops.',
      citedKbIds: ['KB-006'],
      confidence: 'high',
      reasoningSummary: 'The article covers exactly this problem.',
    },
    triage: { category: 'Network', priority: 'high', assigneeGroup: 'Network Support' },
    citedArticles: [{ id: 'KB-006', title: 'VPN keeps disconnecting' }],
    ...overrides,
  };
}

// A ticket the agent has drafted a reply for.
export const withProposal = (status: 'pending' | 'approved' | 'edited' | 'rejected' = 'pending') =>
  makeTicket({
    agent: {
      lastRunId: '665f0f40d5d4f541f8ef3001',
      triageSource: 'agent',
      proposalStatus: status,
    },
  });

export function makeAgentSettings(overrides: Partial<AgentSettings> = {}): AgentSettings {
  return {
    killSwitch: false,
    defaultMode: 'assist',
    modeByCategory: {},
    autoAllowlist: [],
    dailyCostCapUsd: 1,
    perRequesterHourlyLimit: 5,
    enabled: true,
    model: 'claude-sonnet-5',
    spentTodayUsd: 0.0234,
    autoAvailable: true,
    circuit: { open: false, consecutiveFailures: 0 },
    ...overrides,
  };
}

export function makeRun(overrides: Partial<AgentRunSummary> = {}): AgentRunSummary {
  return {
    _id: '665f0f40d5d4f541f8ef3001',
    ticketId: '665f0f40d5d4f541f8ef1001',
    ticketNumber: 'TKT-0001',
    mode: 'assist',
    model: 'claude-sonnet-5',
    promptVersion: 'triage.v1',
    outcome: 'proposed',
    attempts: 1,
    steps: 3,
    inputTokens: 3000,
    outputTokens: 300,
    costUsd: 0.009,
    latencyMs: 4200,
    hasProposal: true,
    startedAt: '2026-06-02T09:00:00.000Z',
    ...overrides,
  };
}

export function makeRunDetail(overrides: Partial<AgentRunDetail> = {}): AgentRunDetail {
  return {
    run: {
      ...makeRun(),
      triage: { category: 'Network', priority: 'high', assigneeGroup: 'Network Support' },
      proposal: makeProposal().proposal,
    },
    steps: [
      { attempt: 1, index: 0, kind: 'model', stopReason: 'tool_use', latencyMs: 900 },
      {
        attempt: 1,
        index: 1,
        kind: 'tool',
        toolName: 'search_kb',
        outputSummary: 'articles: KB-006',
        latencyMs: 12,
      },
    ],
    ...overrides,
  };
}
