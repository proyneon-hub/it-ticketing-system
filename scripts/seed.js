require('dotenv').config();

const { connectToDatabase } = require('../src/server/db');
const Ticket = require('../src/server/models/Ticket');

// Small set of sample tickets for local demos and portfolio screenshots.
const tickets = [
  {
    title: 'Laptop cannot connect to Wi-Fi',
    description: 'User reports the device drops from the corporate Wi-Fi every few minutes.',
    requesterName: 'Avery Johnson',
    requesterEmail: 'avery@example.com',
    status: 'open',
    priority: 'high',
    category: 'Network',
    assignee: 'Network Support',
    dueAt: new Date(Date.now() + 20 * 60 * 60 * 1000),
    activity: [{ action: 'Seeded demo ticket', actorName: 'Priya Admin', actorRole: 'admin' }],
  },
  {
    title: 'Password reset required for payroll app',
    description:
      'Requester is locked out after too many failed login attempts before payroll approval.',
    requesterName: 'Morgan Lee',
    requesterEmail: 'user@demo.local',
    requesterUserId: 'usr_user',
    status: 'assigned',
    priority: 'urgent',
    category: 'Access',
    assignee: 'Theo Technician',
    dueAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    activity: [
      { action: 'Seeded breached urgent ticket', actorName: 'Priya Admin', actorRole: 'admin' },
    ],
  },
  {
    title: 'VPN client fails after operating system update',
    description: 'Remote employee receives a certificate error when launching the VPN client.',
    requesterName: 'Casey Brown',
    requesterEmail: 'casey@example.com',
    status: 'in-progress',
    priority: 'medium',
    category: 'Endpoint',
    assignee: 'Theo Technician',
    dueAt: new Date(Date.now() + 36 * 60 * 60 * 1000),
    activity: [{ action: 'Seeded active work item', actorName: 'Priya Admin', actorRole: 'admin' }],
  },
  {
    title: 'Printer queue stuck on third floor',
    description: 'Print jobs are not clearing from the shared printer queue.',
    requesterName: 'Jamie Smith',
    requesterEmail: 'jamie@example.com',
    status: 'resolved',
    priority: 'low',
    category: 'Hardware',
    assignee: 'Field Tech',
    resolvedAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
    activity: [
      { action: 'Seeded resolved ticket', actorName: 'Theo Technician', actorRole: 'technician' },
    ],
  },
  {
    title: 'New hire software access checklist',
    description:
      'Provision email, file share access, password manager, and CRM seat for Monday start.',
    requesterName: 'Priya Admin',
    requesterEmail: 'admin@demo.local',
    status: 'closed',
    priority: 'medium',
    category: 'Onboarding',
    assignee: 'Help Desk',
    resolvedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    activity: [{ action: 'Seeded closed ticket', actorName: 'Priya Admin', actorRole: 'admin' }],
  },
];

async function seed() {
  // Reuse the same database helper as the API so seeding respects MONGODB_URI,
  // DNS settings, and connection timeout behavior.
  await connectToDatabase();

  // This is intentionally destructive: it clears existing tickets so the sample
  // data is predictable every time the script runs.
  await Ticket.deleteMany({});
  await Ticket.insertMany(tickets);

  console.log(`Seeded ${tickets.length} tickets.`);
  process.exit(0);
}

// Log failures clearly and exit non-zero so npm/CI knows the seed command failed.
seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
