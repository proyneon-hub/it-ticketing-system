import 'dotenv/config';
import { connectToDatabase } from '../src/server/db';
import Counter from '../src/server/models/Counter';
import Ticket, { type TicketAttrs } from '../src/server/models/Ticket';
import { ensureDemoUsers } from '../src/server/services/userService';
import { generateTickets } from './sampleData';

// Small set of sample tickets for local demos and portfolio screenshots.
const tickets: Partial<TicketAttrs>[] = [
  {
    ticketNumber: 'TKT-0001',
    title: 'Laptop cannot connect to Wi-Fi',
    description: 'User reports the device drops from the corporate Wi-Fi every few minutes.',
    requesterName: 'Avery Johnson',
    requesterEmail: 'avery@example.com',
    status: 'open',
    priority: 'high',
    category: 'Network',
    assignee: 'Network Support',
    dueAt: new Date(Date.now() + 20 * 60 * 60 * 1000),
    activity: [
      {
        action: 'ticket_created',
        detail: 'Seeded demo ticket',
        actorName: 'Priya Admin',
        actorRole: 'admin',
        actorEmail: 'admin@demo.local',
      },
    ],
  },
  {
    ticketNumber: 'TKT-0002',
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
      {
        action: 'ticket_created',
        detail: 'Seeded breached urgent ticket',
        actorName: 'Priya Admin',
        actorRole: 'admin',
        actorEmail: 'admin@demo.local',
      },
      {
        action: 'status_changed',
        from: 'open',
        to: 'assigned',
        actorName: 'Theo Technician',
        actorRole: 'technician',
        actorEmail: 'tech@demo.local',
      },
    ],
  },
  {
    ticketNumber: 'TKT-0003',
    title: 'VPN client fails after operating system update',
    description: 'Remote employee receives a certificate error when launching the VPN client.',
    requesterName: 'Casey Brown',
    requesterEmail: 'casey@example.com',
    status: 'in-progress',
    priority: 'medium',
    category: 'Endpoint',
    assignee: 'Theo Technician',
    dueAt: new Date(Date.now() + 36 * 60 * 60 * 1000),
    activity: [
      {
        action: 'ticket_created',
        detail: 'Seeded active work item',
        actorName: 'Priya Admin',
        actorRole: 'admin',
        actorEmail: 'admin@demo.local',
      },
      {
        action: 'status_changed',
        from: 'assigned',
        to: 'in-progress',
        actorName: 'Theo Technician',
        actorRole: 'technician',
        actorEmail: 'tech@demo.local',
      },
    ],
  },
  {
    ticketNumber: 'TKT-0004',
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
      {
        action: 'ticket_created',
        detail: 'Seeded resolved ticket',
        actorName: 'Theo Technician',
        actorRole: 'technician',
        actorEmail: 'tech@demo.local',
      },
    ],
  },
  {
    ticketNumber: 'TKT-0005',
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
    activity: [
      {
        action: 'ticket_created',
        detail: 'Seeded closed ticket',
        actorName: 'Priya Admin',
        actorRole: 'admin',
        actorEmail: 'admin@demo.local',
      },
    ],
  },
];

// `--count 10000` pads the demo set with generated tickets, for load tests.
function requestedCount(): number {
  const index = process.argv.indexOf('--count');
  const value = index === -1 ? 0 : Number(process.argv[index + 1]);
  return Number.isInteger(value) && value > tickets.length ? value : tickets.length;
}

async function seed(): Promise<void> {
  // Reuse the same database helper as the API so seeding respects MONGODB_URI,
  // DNS settings, and connection timeout behavior.
  await connectToDatabase();

  // This is intentionally destructive: it clears existing tickets so the sample
  // data is predictable every time the script runs.
  const total = requestedCount();
  const all = [
    ...tickets,
    ...generateTickets(total - tickets.length, { firstNumber: tickets.length + 1 }),
  ];

  await Ticket.deleteMany({});
  // In batches, so a large count does not build one enormous write.
  for (let start = 0; start < all.length; start += 1000) {
    await Ticket.insertMany(all.slice(start, start + 1000));
  }
  await Counter.updateOne({ _id: 'ticket' }, { $set: { seq: all.length } }, { upsert: true });

  // The demo sign-in accounts (created only if missing, so nothing an admin changed is reset).
  await ensureDemoUsers();

  console.log(`Seeded ${all.length} tickets and the demo users.`);
  process.exit(0);
}

// Log failures clearly and exit non-zero so npm/CI knows the seed command failed.
seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
