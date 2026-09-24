import type { Page } from '@playwright/test';
import { testUsers } from '../test-data/users';
import type {
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
      const ticket = {
        ...baseTickets[0],
        _id: '665f0f40d5d4f541f8ef1999',
        ticketNumber: 'TKT-0009',
        __v: 0,
        title: stringFromPayload(body, 'title') ?? '',
        description: stringFromPayload(body, 'description') ?? '',
        requesterName: activeUser.name,
        requesterEmail: activeUser.email,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
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
      const ifMatch = request.headers()['if-match'];
      if (current && ifMatch !== undefined && ifMatch !== `"${current.__v}"`) {
        return route.fulfill({
          status: 409,
          json: {
            message: 'This ticket changed since you loaded it. Reload it and try again.',
            code: 'VERSION_CONFLICT',
          },
        });
      }
      tickets = tickets.map((ticket) =>
        ticket._id === id
          ? {
              ...ticket,
              ...(nextStatus ? { status: nextStatus } : {}),
              ...(nextPriority ? { priority: nextPriority } : {}),
              ...(assignee !== undefined ? { assignee } : {}),
              __v: ticket.__v + 1,
              activity: [
                ...ticket.activity,
                {
                  action: nextStatus ? 'status_changed' : 'ticket_updated',
                  from: ticket.status,
                  to: nextStatus,
                  actorName: activeUser.name,
                  actorRole: activeUser.role,
                  createdAt: new Date().toISOString(),
                },
              ],
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
