import type { Page, Route } from '@playwright/test';

// A stand-in for the service desk agent's endpoints, added on top of the mocked API from support.ts
// only by the tests that need it (Playwright runs the most recently added route first, and
// `fallback()` hands everything else to the mocks underneath). As with the real API, who is calling
// decides what they may do, and it is read from the bearer token the app sends (`token-<role>`).

export const PROPOSAL_TICKET_ID = '665f0f40d5d4f541f8ef1003';
export const RUN_ID = '665f0f40d5d4f541f8ef3001';
export const REPLY = 'Reconnect the VPN, then restart your laptop if it still drops.';

type Role = 'admin' | 'technician' | 'user';
type Decision = 'pending' | 'approved' | 'edited' | 'rejected';

interface AgentComment {
  _id: string;
  ticketId: string;
  body: string;
  visibility: 'public' | 'internal';
  source?: 'agent';
  approvedBy?: { id: string; name: string; email: string };
  author: { id: string; name: string; email: string; role: string };
  createdAt: string;
}

export interface AgentMockState {
  proposal: Decision;
  ticketStatus: string;
  comments: AgentComment[];
  activity: {
    action: string;
    actorName: string;
    actorRole: string;
    detail?: string;
    createdAt: string;
  }[];
  settings: {
    killSwitch: boolean;
    defaultMode: string;
    modeByCategory: Record<string, string>;
    autoAllowlist: string[];
    dailyCostCapUsd: number;
    perRequesterHourlyLimit: number;
    enabled: boolean;
    model: string;
    spentTodayUsd: number;
  };
  // The bodies the page sent, in order, so a test can say exactly what was asked.
  requests: { path: string; method: string; body: unknown }[];
  // Make the next approve or reject answer as if someone else decided first.
  conflictNext: boolean;
}

const roleOf = (route: Route): Role | null => {
  const header = route.request().headers()['authorization'] ?? '';
  const match = /^Bearer token-(admin|technician|user)$/.exec(header);
  return match ? (match[1] as Role) : null;
};

const error = (route: Route, status: number, code: string, message: string) =>
  route.fulfill({ status, json: { code, message } });

export async function installAgentMocks(page: Page): Promise<AgentMockState> {
  const state: AgentMockState = {
    proposal: 'pending',
    ticketStatus: 'open',
    comments: [],
    activity: [
      {
        action: 'ticket_created',
        actorName: 'Una User',
        actorRole: 'user',
        createdAt: '2026-06-02T08:00:00.000Z',
      },
      {
        action: 'agent_proposed',
        actorName: 'Service Desk Agent',
        actorRole: 'agent',
        detail: 'Drafted a reply for a person to approve',
        createdAt: '2026-06-02T08:01:00.000Z',
      },
    ],
    settings: {
      killSwitch: false,
      defaultMode: 'assist',
      modeByCategory: {},
      autoAllowlist: [],
      dailyCostCapUsd: 1,
      perRequesterHourlyLimit: 5,
      enabled: true,
      model: 'claude-sonnet-5',
      spentTodayUsd: 0.0234,
    },
    requests: [],
    conflictNext: false,
  };
  let sequence = 0;

  const ticketFor = (role: Role) => ({
    _id: PROPOSAL_TICKET_ID,
    ticketNumber: 'TKT-0003',
    title: 'VPN drops during calls',
    description: 'The VPN disconnects every few minutes when I am on a call.',
    requesterName: 'Una User',
    requesterEmail: 'user@demo.local',
    status: state.ticketStatus,
    priority: 'high',
    category: 'Network',
    assignee: 'Network Support',
    dueAt: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 60 * 1000).toISOString(),
    __v: state.ticketStatus === 'open' ? 1 : 2,
    // What the agent did is for staff; the requester's copy has neither the field nor the
    // history entries about it.
    ...(role === 'user'
      ? {
          activity: state.activity.filter((entry) => entry.actorRole !== 'agent'),
        }
      : {
          agent: { lastRunId: RUN_ID, triageSource: 'agent', proposalStatus: state.proposal },
          activity: state.activity,
        }),
  });

  const proposalView = () => ({
    status: state.proposal,
    runId: RUN_ID,
    proposal: {
      replyMarkdown: REPLY,
      citedKbIds: ['KB-006'],
      confidence: 'high',
      reasoningSummary: 'The article covers exactly this problem.',
    },
    triage: { category: 'Network', priority: 'high', assigneeGroup: 'Network Support' },
    citedArticles: [{ id: 'KB-006', title: 'VPN keeps disconnecting' }],
  });

  const runs = [
    {
      _id: RUN_ID,
      ticketId: PROPOSAL_TICKET_ID,
      ticketNumber: 'TKT-0003',
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
      triage: { category: 'Network', priority: 'high', assigneeGroup: 'Network Support' },
      startedAt: '2026-06-02T08:01:00.000Z',
      finishedAt: '2026-06-02T08:01:04.000Z',
    },
    {
      _id: '665f0f40d5d4f541f8ef3002',
      ticketId: '665f0f40d5d4f541f8ef1002',
      ticketNumber: 'TKT-0002',
      mode: 'assist',
      model: 'claude-sonnet-5',
      promptVersion: 'triage.v1',
      outcome: 'aborted',
      outcomeReason: 'requester_rate_limited',
      attempts: 1,
      steps: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: 0,
      hasProposal: false,
      startedAt: '2026-06-02T07:00:00.000Z',
    },
  ];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const role = roleOf(route);
    const body = request.postData() ? (request.postDataJSON() as unknown) : undefined;

    const isOurTicket = path === `/api/tickets/${PROPOSAL_TICKET_ID}`;
    const isOurProposal = path.startsWith(`/api/tickets/${PROPOSAL_TICKET_ID}/proposal`);
    const isOurComments = path === `/api/tickets/${PROPOSAL_TICKET_ID}/comments`;
    const isAgent = path.startsWith('/api/agent/');
    if (!isOurTicket && !isOurProposal && !isOurComments && !isAgent) return route.fallback();

    if (!role) return error(route, 401, 'UNAUTHORIZED', 'Authentication required.');
    if (method !== 'GET') state.requests.push({ path, method, body });

    if (isOurTicket && method === 'GET')
      return route.fulfill({ json: { ticket: ticketFor(role) } });

    if (isOurComments) {
      if (method === 'GET') {
        const thread = state.comments.filter(
          (comment) => role !== 'user' || comment.visibility === 'public'
        );
        return route.fulfill({ json: { comments: thread } });
      }
      return route.fallback();
    }

    if (isOurProposal) {
      if (role === 'user') return error(route, 403, 'FORBIDDEN', 'Only staff can do this.');
      if (method === 'GET') return route.fulfill({ json: { proposal: proposalView() } });

      const decided = path.endsWith('/approve') ? 'approve' : 'reject';
      if (state.proposal !== 'pending' || state.conflictNext) {
        state.conflictNext = false;
        return error(
          route,
          409,
          'NO_PENDING_PROPOSAL',
          'This proposal was decided, or the ticket changed, while you were looking at it. Reload and try again.'
        );
      }
      const actor = role === 'admin' ? 'Priya Admin' : 'Theo Technician';
      if (decided === 'reject') {
        state.proposal = 'rejected';
        const reason = (body as { reason?: string } | undefined)?.reason;
        state.activity.push({
          action: 'proposal_rejected',
          actorName: actor,
          actorRole: role,
          ...(reason ? { detail: reason } : {}),
          createdAt: new Date().toISOString(),
        });
        return route.fulfill({ json: { status: 'rejected' } });
      }
      const edit = (body as { replyMarkdown?: string } | undefined)?.replyMarkdown;
      state.proposal = edit && edit.trim() !== REPLY ? 'edited' : 'approved';
      state.ticketStatus = 'pending-user';
      sequence += 1;
      state.comments.push({
        _id: `agent-cmt-${sequence}`,
        ticketId: PROPOSAL_TICKET_ID,
        body: edit ?? REPLY,
        visibility: 'public',
        source: 'agent',
        approvedBy: {
          id: role === 'admin' ? 'usr_admin' : 'usr_tech',
          name: actor,
          email: role === 'admin' ? 'admin@demo.local' : 'tech@demo.local',
        },
        author: {
          id: 'service-desk-agent',
          name: 'Service Desk Agent',
          email: 'agent@service.local',
          role: 'agent',
        },
        createdAt: new Date().toISOString(),
      });
      state.activity.push({
        action: 'proposal_approved',
        actorName: actor,
        actorRole: role,
        createdAt: new Date().toISOString(),
      });
      return route.fulfill({ json: { status: state.proposal } });
    }

    // --- /api/agent/*
    if (path === '/api/agent/settings') {
      if (role === 'user') return error(route, 403, 'FORBIDDEN', 'Only staff can do this.');
      if (method === 'GET') return route.fulfill({ json: { settings: state.settings } });
      if (role !== 'admin') {
        return error(route, 403, 'FORBIDDEN', 'You do not have permission to perform this action.');
      }
      state.settings = { ...state.settings, ...(body as object) };
      return route.fulfill({ json: { settings: state.settings } });
    }

    if (path === '/api/agent/runs') {
      if (role !== 'admin') {
        return error(route, 403, 'FORBIDDEN', 'You do not have permission to perform this action.');
      }
      const outcome = url.searchParams.get('outcome');
      const shown = outcome ? runs.filter((run) => run.outcome === outcome) : runs;
      return route.fulfill({
        json: {
          runs: shown,
          pagination: { page: 1, limit: 15, total: shown.length, totalPages: 1 },
        },
      });
    }

    if (path === `/api/agent/runs/${RUN_ID}`) {
      if (role !== 'admin') {
        return error(route, 403, 'FORBIDDEN', 'You do not have permission to perform this action.');
      }
      return route.fulfill({
        json: {
          run: {
            ...runs[0],
            proposal: proposalView().proposal,
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
            {
              attempt: 1,
              index: 2,
              kind: 'tool',
              toolName: 'propose_resolution',
              outputSummary: 'cites KB-006; confidence high',
              latencyMs: 8,
            },
          ],
        },
      });
    }

    return route.fallback();
  });

  return state;
}
