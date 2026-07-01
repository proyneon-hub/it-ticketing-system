const demoUsers = {
  admin: {
    sub: 'usr_admin',
    name: 'Priya Admin',
    email: 'admin@demo.local',
    role: 'admin',
    demoPassword: 'AdminPass123!',
  },
  technician: {
    sub: 'usr_tech',
    name: 'Theo Technician',
    email: 'tech@demo.local',
    role: 'technician',
    demoPassword: 'TechPass123!',
  },
  user: {
    sub: 'usr_user',
    name: 'Una User',
    email: 'user@demo.local',
    role: 'user',
    demoPassword: 'UserPass123!',
  },
};

const baseTickets = [
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

function statsFor(tickets) {
  const statuses = ['open', 'assigned', 'in-progress', 'resolved', 'closed'];
  const priorities = ['low', 'medium', 'high', 'urgent'];
  const byStatus = Object.fromEntries(statuses.map((status) => [status, 0]));
  const byPriority = Object.fromEntries(priorities.map((priority) => [priority, 0]));

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

async function installApiMocks(page) {
  let currentUser = null;
  let tickets = baseTickets.map((ticket) => ({ ...ticket, activity: [...ticket.activity] }));

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
        return route.fulfill({ status: 401, json: { message: 'Authentication required.' } });
      return route.fulfill({ json: { user: currentUser } });
    }

    if (path === '/api/auth/login' && method === 'POST') {
      const body = request.postDataJSON();
      currentUser = Object.values(demoUsers).find((user) => user.email === body.email);
      return route.fulfill({ json: { token: `token-${currentUser.role}`, user: currentUser } });
    }

    if (path === '/api/tickets/stats') {
      const visibleTickets =
        currentUser?.role === 'user'
          ? tickets.filter((ticket) => ticket.requesterEmail === currentUser.email)
          : tickets;
      return route.fulfill({ json: statsFor(visibleTickets) });
    }

    if (path === '/api/tickets/export') {
      return route.fulfill({
        headers: {
          'content-type': 'text/csv',
          'content-disposition': 'attachment; filename="tickets.csv"',
        },
        body: 'Ticket ID,Title\nTKT-0001,Laptop cannot connect to Wi-Fi\n',
      });
    }

    if (path === '/api/tickets' && method === 'GET') {
      const visibleTickets =
        currentUser?.role === 'user'
          ? tickets.filter((ticket) => ticket.requesterEmail === currentUser.email)
          : tickets;
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
      const body = request.postDataJSON();
      const ticket = {
        ...baseTickets[0],
        _id: '665f0f40d5d4f541f8ef1999',
        ticketNumber: 'TKT-0009',
        title: body.title,
        description: body.description,
        requesterName: currentUser.name,
        requesterEmail: currentUser.email,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      tickets = [ticket, ...tickets];
      return route.fulfill({ status: 201, json: { ticket } });
    }

    if (path.startsWith('/api/tickets/') && method === 'PATCH') {
      const id = path.split('/').pop();
      const patch = request.postDataJSON();
      tickets = tickets.map((ticket) =>
        ticket._id === id
          ? {
              ...ticket,
              ...patch,
              activity: [
                ...ticket.activity,
                {
                  action: patch.status ? 'status_changed' : 'ticket_updated',
                  from: ticket.status,
                  to: patch.status,
                  actorName: currentUser.name,
                  actorRole: currentUser.role,
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : ticket
      );
      return route.fulfill({ json: { ticket: tickets.find((ticket) => ticket._id === id) } });
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

async function loginAs(page, role) {
  await page.goto('/');
  await page.getByTestId(`demo-login-${role}`).click();
  await page.getByText(`Signed in as ${demoUsers[role].name}.`).waitFor();
}

module.exports = {
  baseTickets,
  demoUsers,
  installApiMocks,
  loginAs,
};
