const HOUR = 60 * 60 * 1000;

export const users = {
  admin: { sub: 'usr_admin', name: 'Priya Admin', email: 'admin@demo.local', role: 'admin' },
  technician: {
    sub: 'usr_tech',
    name: 'Theo Technician',
    email: 'tech@demo.local',
    role: 'technician',
  },
  user: { sub: 'usr_user', name: 'Una User', email: 'user@demo.local', role: 'user' },
};

export const demoUsers = Object.values(users).map(({ sub: _sub, ...user }) => ({
  ...user,
  demoPassword: `${user.role}-password`,
}));

export function makeTicket(overrides = {}) {
  return {
    _id: '665f0f40d5d4f541f8ef1001',
    ticketNumber: 'TKT-0001',
    title: 'Laptop cannot connect to Wi-Fi',
    description: 'Drops from the corporate network.',
    requesterName: 'Avery Johnson',
    requesterEmail: 'avery@example.com',
    status: 'open',
    priority: 'high',
    category: 'Network',
    assignee: 'Network Support',
    dueAt: new Date(Date.now() + 48 * HOUR).toISOString(),
    createdAt: new Date(Date.now() - 4 * HOUR).toISOString(),
    activity: [],
    ...overrides,
  };
}

export const ticketPage = (tickets, pagination = {}) => ({
  data: tickets,
  tickets,
  pagination: { page: 1, limit: 10, total: tickets.length, totalPages: 1, ...pagination },
});

export const emptyStats = {
  total: 0,
  byStatus: {},
  byPriority: {},
  sla: { breached: 0, dueSoon: 0 },
};

// A promise the test resolves by hand, to control the order responses arrive in.
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
