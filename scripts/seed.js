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
    assignee: 'Network Support'
  },
  {
    title: 'Password reset required',
    description: 'Requester is locked out after too many failed login attempts.',
    requesterName: 'Morgan Lee',
    requesterEmail: 'morgan@example.com',
    status: 'in-progress',
    priority: 'medium',
    assignee: 'Help Desk'
  },
  {
    title: 'Printer queue stuck on third floor',
    description: 'Print jobs are not clearing from the shared printer queue.',
    requesterName: 'Jamie Smith',
    requesterEmail: 'jamie@example.com',
    status: 'resolved',
    priority: 'low',
    assignee: 'Field Tech'
  }
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
