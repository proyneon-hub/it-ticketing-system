require('dotenv').config();

const { connectToDatabase } = require('../src/server/db');
const Ticket = require('../src/server/models/Ticket');

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
  await connectToDatabase();
  await Ticket.deleteMany({});
  await Ticket.insertMany(tickets);
  console.log(`Seeded ${tickets.length} tickets.`);
  process.exit(0);
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
