import type { Page } from '@playwright/test';
import { testUsers } from '../test-data/users';
import type {
  MockActivity,
  MockDashboardStats,
  MockTicket,
  MockUser,
  TicketPriority,
  TicketStatus,
  UserRole,
} from '../test-data/types';

export type {
  MockDashboardStats,
  MockTicket,
  MockUser,
  TicketPriority,
  TicketStatus,
  UserRole,
} from '../test-data/types';

type JsonRecord = Record<string, unknown>;

interface MockComment {
  _id: string;
  ticketId: string;
  body: string;
  visibility: 'public' | 'internal';
  author: { id: string; name: string; email: string; role: UserRole };
  createdAt: string;
}

const ticketStatuses: TicketStatus[] = ['open', 'assigned', 'in-progress', 'resolved', 'closed'];
const ticketPriorities: TicketPriority[] = ['low', 'medium', 'high', 'urgent'];

const demoUsers: Record<UserRole, MockUser> = {
  admin: {
    sub: 'usr_admin',
    name: testUsers.admin.name,
    email: testUsers.admin.email,
    role: testUsers.admin.role,
    demoPassword: testUsers.admin.password,
  },
  technician: {
    sub: 'usr_tech',
    name: testUsers.technician.name,
    email: testUsers.technician.email,
    role: testUsers.technician.role,
    demoPassword: testUsers.technician.password,
  },
  user: {
    sub: 'usr_user',
    name: testUsers.user.name,
    email: testUsers.user.email,
    role: testUsers.user.role,
    demoPassword: testUsers.user.password,
  },
};

const baseTickets: MockTicket[] = [
  {
    _id: '665f0f40d5d4f541f8ef1001',
    ticketNumber: 'TKT-0001',
    title: 'Laptop cannot connect to Wi-Fi',
    description: 'Device drops from corporate Wi-Fi every few minutes.',
    requesterName: 'Avery Johnson',
    requesterEmail: 'avery@example.com',
    status: 'open',
    priority: 'high',
    category: 'Network',
    assignee: 'Network Support',
    dueAt: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    __v: 0,
    activity: [
      {
        action: 'ticket_created',
        detail: 'Seeded demo ticket',
        actorName: 'Priya Admin',
        actorRole: 'admin',
        createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      },
    ],
  },
  {
    _id: '665f0f40d5d4f541f8ef1002',
    ticketNumber: 'TKT-0002',
    title: 'Password reset required for payroll app',
    description: 'Requester is locked out before payroll approval.',
    requesterName: 'Una User',
    requesterEmail: 'user@demo.local',
    status: 'assigned',
    priority: 'urgent',
    category: 'Access',
    assignee: 'Theo Technician',
    dueAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    __v: 0,
    activity: [
      {
        action: 'ticket_created',
        detail: 'Seeded breached urgent ticket',
        actorName: 'Priya Admin',
        actorRole: 'admin',
        createdAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
      },
      {
        action: 'status_changed',
        from: 'open',
        to: 'assigned',
        actorName: 'Theo Technician',
        actorRole: 'technician',
        createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
      },
    ],
  },
];

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function stringFromPayload(value: unknown, property: string): string | undefined {
  if (!isJsonRecord(value)) return undefined;

  const candidate = value[property];
  return typeof candidate === 'string' ? candidate : undefined;
}

function isTicketStatus(value: string): value is TicketStatus {
  return ticketStatuses.some((status) => status === value);
}

function isTicketPriority(value: string): value is TicketPriority {
  return ticketPriorities.some((priority) => priority === value);
}

function statsFor(tickets: readonly MockTicket[]): MockDashboardStats {
  const byStatus = Object.fromEntries(ticketStatuses.map((status) => [status, 0])) as Record<
    TicketStatus,
    number
  >;
  const byPriority = Object.fromEntries(
    ticketPriorities.map((priority) => [priority, 0])
  ) as Record<TicketPriority, number>;

  for (const ticket of tickets) {
    byStatus[ticket.status] += 1;
    byPriority[ticket.priority] += 1;
  }

  return {
    total: tickets.length,
    byStatus,
    byPriority,
    sla: {
      breached: tickets.filter((ticket) => new Date(ticket.dueAt).getTime() < Date.now()).length,
      dueSoon: tickets.filter((ticket) => new Date(ticket.dueAt).getTime() >= Date.now()).length,
    },
  };
}

function cloneTicket(ticket: MockTicket): MockTicket {
  return { ...ticket, activity: [...ticket.activity] };
}

function visibleTicketsFor(
  activeUser: MockUser | null,
  tickets: readonly MockTicket[]
): MockTicket[] {
  return activeUser?.role === 'user'
    ? tickets.filter((ticket) => ticket.requesterEmail === activeUser.email)
    : [...tickets];
}

function filterTickets(tickets: readonly MockTicket[], params: URLSearchParams): MockTicket[] {
  const status = params.get('status');
  const priority = params.get('priority');
  const search = params.get('search')?.trim().toLowerCase();

  return tickets.filter((ticket) => {
    if (status && ticket.status !== status) return false;
    if (priority && ticket.priority !== priority) return false;
    if (!search) return true;

    return [
      ticket.ticketNumber,
      ticket.title,
      ticket.description,
      ticket.requesterName,
      ticket.requesterEmail,
      ticket.assignee,
      ticket.category,
    ].some((value) => value.toLowerCase().includes(search));
  });
}

function csvFor(tickets: readonly MockTicket[]): string {
  const rows = tickets.map((ticket) => `${ticket.ticketNumber},${ticket.title}`);
  return ['Ticket ID,Title', ...rows].join('\n');
}

export async function installApiMocks(page: Page): Promise<void> {
  let currentUser: MockUser | null = null;
  let tickets = baseTickets.map(cloneTicket);
  // The people the admin page lists. Roles can be changed there, as in the real API.
  let people = Object.values(demoUsers).map((user) => ({
    id: user.sub,
    name: user.name,
    email: user.email,
    role: user.role as UserRole,
    createdAt: '2026-06-01T12:00:00.000Z',
  }));

  // Comments per ticket. As in the real API the server, not the page, decides what a
  // requester receives: an internal note is never sent to one.
  let comments: MockComment[] = [
    {
      _id: 'cmt-1',
      ticketId: '665f0f40d5d4f541f8ef1001',
      body: 'Checked the access point logs; it is rebooting.',
      visibility: 'public',
      author: {
        id: 'usr_tech',
        name: testUsers.technician.name,
        email: testUsers.technician.email,
        role: 'technician',
      },
      createdAt: '2026-06-02T09:00:00.000Z',
    },
    {
      _id: 'cmt-2',
      ticketId: '665f0f40d5d4f541f8ef1001',
      body: 'Firmware 4.2 is suspect; do not tell the user yet.',
      visibility: 'internal',
      author: {
        id: 'usr_tech',
        name: testUsers.technician.name,
        email: testUsers.technician.email,
        role: 'technician',
      },
      createdAt: '2026-06-02T09:05:00.000Z',
    },
    {
      _id: 'cmt-3',
      ticketId: '665f0f40d5d4f541f8ef1002',
      body: 'Your account is unlocked; please try again.',
      visibility: 'public',
      author: {
        id: 'usr_tech',
        name: testUsers.technician.name,
        email: testUsers.technician.email,
        role: 'technician',
      },
      createdAt: '2026-06-02T10:00:00.000Z',
    },
    {
      _id: 'cmt-4',
      ticketId: '665f0f40d5d4f541f8ef1002',
      body: 'Locked out by a stale VPN session; check the SSO logs.',
      visibility: 'internal',
      author: {
        id: 'usr_tech',
        name: testUsers.technician.name,
        email: testUsers.technician.email,
        role: 'technician',
      },
      createdAt: '2026-06-02T10:05:00.000Z',
    },
  ];
  let commentSequence = 4;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/auth/demo-users') {
      return route.fulfill({
        json: {
          users: Object.values(demoUsers).map(({ sub: _sub, ...user }) => user),
        },
      });
    }

    if (path === '/api/auth/me') {
      if (!currentUser)
        return route.fulfill({
          status: 401,
          json: { message: 'Authentication required.', code: 'UNAUTHORIZED' },
        });
      return route.fulfill({ json: { user: currentUser } });
    }

    // The refresh cookie is httpOnly, so the page cannot see it; the mock keeps the session
    // here instead, which (like the cookie) survives a page reload.
    if (path === '/api/auth/refresh' && method === 'POST') {
      if (!currentUser) {
        return route.fulfill({
          status: 401,
          json: { message: 'Not signed in.', code: 'UNAUTHORIZED' },
        });
      }
      const { sub, name, email, role } = currentUser;
      return route.fulfill({
        json: { token: `token-${role}`, user: { id: sub, name, email, role } },
      });
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      currentUser = null;
      return route.fulfill({ status: 204, body: '' });
    }

    if (path === '/api/auth/login' && method === 'POST') {
      const email = stringFromPayload(request.postDataJSON() as unknown, 'email');
      const password = stringFromPayload(request.postDataJSON() as unknown, 'password');
      const matchedUser =
        Object.values(demoUsers).find(
          (user) => user.email === email && user.demoPassword === password
        ) ?? null;

      if (!matchedUser) {
        return route.fulfill({
          status: 401,
          json: { message: 'Invalid demo credentials.', code: 'UNAUTHORIZED' },
        });
      }

      currentUser = matchedUser;
      // The real API returns `id` here and `sub` from /auth/me. The mock keeps the
      // same difference so a client that mixes them up fails here, not only in production.
      const { sub, name, email: userEmail, role } = matchedUser;
      return route.fulfill({
        json: {
          token: `token-${matchedUser.role}`,
          user: { id: sub, name, email: userEmail, role },
        },
      });
    }

    // --- admin: users and the audit log (admins only, like the real API)
    if (path === '/api/users' || path.startsWith('/api/users/')) {
      if (!currentUser) {
        return route.fulfill({
          status: 401,
          json: { message: 'Authentication required.', code: 'UNAUTHORIZED' },
        });
      }
      if (currentUser.role !== 'admin') {
        return route.fulfill({
          status: 403,
          json: {
            message: 'You do not have permission to perform this action.',
            code: 'FORBIDDEN',
          },
        });
      }

      if (path === '/api/users' && method === 'GET') {
        return route.fulfill({ json: { users: people } });
      }

      if (method === 'PATCH') {
        const id = path.split('/').pop();
        const role = stringFromPayload(request.postDataJSON() as unknown, 'role') as UserRole;
        const target = people.find((person) => person.id === id);
        if (!target) {
          return route.fulfill({
            status: 404,
            json: { message: 'User not found.', code: 'NOT_FOUND' },
          });
        }
        // There must always be one admin.
        const otherAdmins = people.filter((p) => p.role === 'admin' && p.id !== id).length;
        if (target.role === 'admin' && role !== 'admin' && otherAdmins === 0) {
          return route.fulfill({
            status: 409,
            json: { message: 'There must always be at least one admin.', code: 'LAST_ADMIN' },
          });
        }
        people = people.map((person) => (person.id === id ? { ...person, role } : person));
        const { id: userId, name, email } = target;
        return route.fulfill({ json: { user: { id: userId, name, email, role } } });
      }
    }

    if (path === '/api/audit' && method === 'GET') {
      if (currentUser?.role !== 'admin') {
        return route.fulfill({
          status: currentUser ? 403 : 401,
          json: { message: 'Not permitted.', code: currentUser ? 'FORBIDDEN' : 'UNAUTHORIZED' },
        });
      }
      const events = [
        {
          _id: 'evt-2',
          type: 'role_changed',
          outcome: 'success',
          actor: { email: 'admin@demo.local', role: 'admin' },
          target: { type: 'user', label: 'tech@demo.local' },
          detail: 'Role changed from technician to admin.',
          ip: '203.0.113.7',
          at: '2026-06-02T09:30:00.000Z',
        },
        {
          _id: 'evt-1',
          type: 'login_success',
          outcome: 'success',
          actor: { email: 'tech@demo.local', role: 'technician' },
          ip: '203.0.113.9',
          at: '2026-06-02T09:00:00.000Z',
        },
      ];
      const type = url.searchParams.get('type');
      const shown = type ? events.filter((event) => event.type === type) : events;
      return route.fulfill({
        json: {
          events: shown,
          data: shown,
          pagination: { page: 1, limit: 25, total: shown.length, totalPages: 1 },
        },
      });
    }

    // --- trends (staff and requesters; a requester's would cover only their tickets)
    if (path === '/api/tickets/stats/trends' && method === 'GET') {
      if (!currentUser) {
        return route.fulfill({
          status: 401,
          json: { message: 'Authentication required.', code: 'UNAUTHORIZED' },
        });
      }
      const days = Number(url.searchParams.get('days') ?? 30);
      const today = Date.now();
      const series = Array.from({ length: days }, (_, index) => {
        const date = new Date(today - (days - 1 - index) * 24 * 60 * 60 * 1000);
        return {
          date: date.toISOString().slice(0, 10),
          opened: (index % 5) + 1,
          resolved: index % 3,
        };
      });
      const resolved = series.reduce((total, day) => total + day.resolved, 0);
      return route.fulfill({
        json: {
          days,
          timeZone: url.searchParams.get('tz') ?? 'UTC',
          series,
          resolution: { resolved, meanHours: 18.5 },
          sla: { resolved, met: Math.round(resolved / 2), compliancePercent: 50 },
        },
      });
    }

    // --- comments on a ticket
    const commentsMatch = /^\/api\/tickets\/([a-f\d]{24})\/comments$/.exec(path);
    if (commentsMatch) {
      if (!currentUser) {
        return route.fulfill({
          status: 401,
          json: { message: 'Authentication required.', code: 'UNAUTHORIZED' },
        });
      }
      const ticketId = commentsMatch[1];
      const ticket = visibleTicketsFor(currentUser, tickets).find((t) => t._id === ticketId);
      if (!ticket) {
        return route.fulfill({
          status: 404,
          json: { message: 'Ticket not found.', code: 'NOT_FOUND' },
        });
      }

      if (method === 'GET') {
        const thread = comments.filter(
          (comment) =>
            comment.ticketId === ticketId &&
            (currentUser?.role !== 'user' || comment.visibility === 'public')
        );
        return route.fulfill({ json: { comments: thread } });
      }

      if (method === 'POST') {
        const payload = request.postDataJSON() as JsonRecord;
        const body = stringFromPayload(payload, 'body')?.trim();
        const visibility = stringFromPayload(payload, 'visibility') ?? 'public';
        if (!body) {
          return route.fulfill({
            status: 400,
            json: {
              message: 'Comment is required.',
              code: 'VALIDATION_FAILED',
              errors: [{ field: 'body', message: 'Comment is required.' }],
            },
          });
        }
        if (visibility === 'internal' && currentUser.role === 'user') {
          return route.fulfill({
            status: 403,
            json: { message: 'Only staff can add internal notes.', code: 'FORBIDDEN' },
          });
        }
        commentSequence += 1;
        const comment: MockComment = {
          _id: `cmt-${commentSequence}`,
          ticketId: ticketId as string,
          body,
          visibility: visibility === 'internal' ? 'internal' : 'public',
          author: {
            id: currentUser.sub,
            name: currentUser.name,
            email: currentUser.email,
            role: currentUser.role,
          },
          createdAt: new Date().toISOString(),
        };
        comments = [...comments, comment];
        return route.fulfill({ status: 201, json: { comment } });
      }
    }

    // --- one ticket (the detail page)
    if (
      path.startsWith('/api/tickets/') &&
      method === 'GET' &&
      path !== '/api/tickets/stats' &&
      path !== '/api/tickets/export'
    ) {
      if (!currentUser) {
        return route.fulfill({
          status: 401,
          json: { message: 'Authentication required.', code: 'UNAUTHORIZED' },
        });
      }
      const id = path.split('/').pop();
      const found = visibleTicketsFor(currentUser, tickets).find((ticket) => ticket._id === id);
      return found
        ? route.fulfill({ json: { ticket: found } })
        : route.fulfill({
            status: 404,
            json: { message: 'Ticket not found.', code: 'NOT_FOUND' },
          });
    }

    if (path === '/api/tickets/stats') {
      const visibleTickets = visibleTicketsFor(currentUser, tickets);
      return route.fulfill({ json: statsFor(visibleTickets) });
    }

    if (path === '/api/tickets/export') {
      if (!currentUser) {
        return route.fulfill({
          status: 401,
          json: { message: 'Authentication required.', code: 'UNAUTHORIZED' },
        });
      }

      const visibleTickets = filterTickets(
        visibleTicketsFor(currentUser, tickets),
        url.searchParams
      );
      return route.fulfill({
        headers: {
          'content-type': 'text/csv',
          'content-disposition': 'attachment; filename="tickets.csv"',
        },
        body: csvFor(visibleTickets),
      });
    }

    if (path === '/api/tickets' && method === 'GET') {
      if (!currentUser) {
        return route.fulfill({
          status: 401,
          json: { message: 'Authentication required.', code: 'UNAUTHORIZED' },
        });
      }

      const visibleTickets = filterTickets(
        visibleTicketsFor(currentUser, tickets),
        url.searchParams
      );
      return route.fulfill({
        json: {
          tickets: visibleTickets,
          data: visibleTickets,
          pagination: {
            page: 1,
            limit: 10,
            total: visibleTickets.length,
            totalPages: 1,
          },
        },
      });
    }

    if (path === '/api/tickets' && method === 'POST') {
      const activeUser = currentUser;
      if (!activeUser) {
        return route.fulfill({
          status: 401,
          json: { message: 'Authentication required.', code: 'UNAUTHORIZED' },
        });
      }

      const body = request.postDataJSON() as unknown;
      // Like the API: what the caller sends is kept (priority and category included), a new
      // ticket is open and unassigned, and its history starts with who created it.
      const requestedPriority = stringFromPayload(body, 'priority');
      const priority =
        requestedPriority && isTicketPriority(requestedPriority) ? requestedPriority : 'medium';
      const slaHours = { low: 72, medium: 48, high: 24, urgent: 4 }[priority];
      const now = Date.now();
      const ticket = {
        ...baseTickets[0],
        _id: '665f0f40d5d4f541f8ef1999',
        ticketNumber: 'TKT-0009',
        __v: 0,
        title: stringFromPayload(body, 'title') ?? '',
        description: stringFromPayload(body, 'description') ?? '',
        category: stringFromPayload(body, 'category') || 'General Support',
        priority,
        status: 'open' as const,
        assignee: 'Unassigned',
        requesterName: activeUser.name,
        requesterEmail: activeUser.email,
        dueAt: new Date(now + slaHours * 60 * 60 * 1000).toISOString(),
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        activity: [
          {
            action: 'ticket_created',
            detail: `Ticket created by ${activeUser.role}`,
            actorName: activeUser.name,
            actorRole: activeUser.role,
            actorEmail: activeUser.email,
            createdAt: new Date(now).toISOString(),
          },
        ],
      };
      tickets = [ticket, ...tickets];
      return route.fulfill({ status: 201, json: { ticket } });
    }

    if (path.startsWith('/api/tickets/') && method === 'PATCH') {
      const activeUser = currentUser;
      if (!activeUser) {
        return route.fulfill({
          status: 401,
          json: { message: 'Authentication required.', code: 'UNAUTHORIZED' },
        });
      }

      const id = path.split('/').pop();
      const patch = request.postDataJSON() as unknown;
      const status = stringFromPayload(patch, 'status');
      const priority = stringFromPayload(patch, 'priority');
      const assignee = stringFromPayload(patch, 'assignee');
      const nextStatus = status && isTicketStatus(status) ? status : undefined;
      const nextPriority = priority && isTicketPriority(priority) ? priority : undefined;
      // Like the API: an edit made against an out-of-date version is refused.
      const current = tickets.find((ticket) => ticket._id === id);
      // Like the API: X-Ticket-Version (what the web app sends) or If-Match, quoted or not.
      const sent = request.headers()['x-ticket-version'] ?? request.headers()['if-match'];
      if (current && sent !== undefined && sent.replace(/^W\/|"/g, '') !== String(current.__v)) {
        return route.fulfill({
          status: 409,
          json: {
            message: 'This ticket changed since you loaded it. Reload it and try again.',
            code: 'VERSION_CONFLICT',
          },
        });
      }
      // One history entry per field that really changed, as the API records them, plus a
      // milestone entry for resolved or closed, or a generic entry when nothing tracked changed.
      const activityFor = (ticket: MockTicket, actor: MockUser) => {
        const at = new Date().toISOString();
        const entry = (action: string, from?: string, to?: string): MockActivity => {
          const built: MockActivity = {
            action,
            actorName: actor.name,
            actorRole: actor.role,
            actorEmail: actor.email,
            createdAt: at,
          };
          if (from !== undefined) built.from = from;
          if (to !== undefined) built.to = to;
          return built;
        };
        const entries: MockActivity[] = [];
        if (nextStatus && nextStatus !== ticket.status) {
          entries.push(entry('status_changed', ticket.status, nextStatus));
        }
        if (nextPriority && nextPriority !== ticket.priority) {
          entries.push(entry('priority_changed', ticket.priority, nextPriority));
        }
        if (assignee !== undefined && assignee !== ticket.assignee) {
          entries.push(entry('assignee_changed', ticket.assignee, assignee));
        }
        if (nextStatus && nextStatus !== ticket.status) {
          if (nextStatus === 'resolved') entries.push(entry('ticket_resolved'));
          if (nextStatus === 'closed') entries.push(entry('ticket_closed'));
        }
        return entries.length > 0 ? entries : [entry('ticket_updated')];
      };
      tickets = tickets.map((ticket) =>
        ticket._id === id
          ? {
              ...ticket,
              ...(nextStatus ? { status: nextStatus } : {}),
              ...(nextPriority ? { priority: nextPriority } : {}),
              ...(assignee !== undefined ? { assignee } : {}),
              __v: ticket.__v + 1,
              activity: [...ticket.activity, ...activityFor(ticket, activeUser)],
            }
          : ticket
      );
      const updated = tickets.find((ticket) => ticket._id === id);
      return route.fulfill({
        headers: { etag: `"${updated?.__v}"` },
        json: { ticket: updated },
      });
    }

    if (path.startsWith('/api/tickets/') && method === 'DELETE') {
      const id = path.split('/').pop();
      tickets = tickets.filter((ticket) => ticket._id !== id);
      return route.fulfill({ status: 204, body: '' });
    }

    return route.fulfill({
      status: 404,
      json: { message: `Unhandled mock route ${method} ${path}` },
    });
  });
}

export async function loginAs(page: Page, role: UserRole): Promise<void> {
  await page.goto('/');
  await page.getByTestId(`demo-login-${role}`).click();
  await page.getByText(`Signed in as ${demoUsers[role].name}.`).waitFor();
}

export { baseTickets, demoUsers };
