import type { DemoUser, Pagination, Stats, Ticket, TicketPage, User } from '../types';

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
