import { priorities, slaHoursByPriority, type Status } from '../src/shared/ticket-constants';
import type { TicketAttrs } from '../src/shared/ticket-types';

// Synthetic tickets for load tests and screenshots. Deterministic: the same seed
// always produces the same data, so two benchmark runs see identical tickets.

// mulberry32: a tiny seeded random number generator.
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROBLEMS = [
  'VPN client fails to connect',
  'Printer offline on the second floor',
  'Outlook keeps asking for a password',
  'Laptop battery drains within an hour',
  'Cannot access the shared drive',
  'Monitor flickers after waking from sleep',
  'Wi-Fi drops every few minutes',
  'Password reset needed for payroll',
  'Software licence expired for the design suite',
  'New starter needs equipment and accounts',
  'Teams calls have no audio',
  'Keyboard is missing keys',
  'Blue screen after the latest update',
  'Cannot log in to the CRM',
  'Phone will not sync calendar',
  'Scanner produces blank pages',
  'Two-factor codes are not arriving',
  'Slow performance opening large spreadsheets',
  'Docking station not detected',
  'Request access to the finance reports',
];

const CONTEXTS = [
  'Started this morning and blocks their work.',
  'Happens only when working from home.',
  'Reported by several people on the same team.',
  'Reproduced after a restart. Logs attached.',
  'Urgent: needed before a client meeting.',
  'Intermittent and hard to reproduce.',
  'Began after the weekend maintenance window.',
  'Affects a new starter on their first day.',
];

const CATEGORIES = [
  'Network',
  'Access',
  'Hardware',
  'Software',
  'Onboarding',
  'Email',
  'General Support',
];
const ASSIGNEES = [
  'Unassigned',
  'Theo Technician',
  'Network Support',
  'Help Desk',
  'Priya Admin',
  'Sam Field',
];
const FIRST = [
  'Avery',
  'Morgan',
  'Jordan',
  'Riley',
  'Casey',
  'Quinn',
  'Harper',
  'Rowan',
  'Skyler',
  'Devon',
];
const LAST = [
  'Johnson',
  'Lee',
  'Patel',
  'Nguyen',
  'Garcia',
  'Smith',
  'Khan',
  'Brown',
  'Silva',
  'Novak',
];

const DAY_MS = 24 * 60 * 60 * 1000;

const pick = <T>(random: () => number, items: readonly T[]): T =>
  items[Math.floor(random() * items.length)] as T;

// Weighted so most tickets are finished and roughly a third are open work, like a real queue.
const STATUS_WEIGHTS: [Status, number][] = [
  ['open', 14],
  ['assigned', 8],
  ['in-progress', 12],
  ['resolved', 36],
  ['closed', 30],
];

function pickStatus(random: () => number): Status {
  const total = STATUS_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [status, weight] of STATUS_WEIGHTS) {
    roll -= weight;
    if (roll < 0) return status;
  }
  return 'open';
}

// `count` tickets numbered from `firstNumber`, created over the last `days` days.
export function generateTickets(
  count: number,
  { firstNumber = 1, days = 90, seed = 1, now = Date.now() } = {}
): Partial<TicketAttrs>[] {
  const random = rng(seed);

  return Array.from({ length: count }, (_, index) => {
    const status = pickStatus(random);
    const priority = pick(random, priorities);
    const createdAt = new Date(now - random() * days * DAY_MS);
    const first = pick(random, FIRST);
    const last = pick(random, LAST);
    const finished = status === 'resolved' || status === 'closed';
    const assignee = status === 'open' ? 'Unassigned' : pick(random, ASSIGNEES.slice(1));
    // Some finished tickets met their SLA and some did not, so compliance charts have shape.
    const resolvedAt = finished
      ? new Date(
          createdAt.getTime() + random() * 1.6 * slaHoursByPriority[priority] * 60 * 60 * 1000
        )
      : undefined;

    return {
      ticketNumber: `TKT-${String(firstNumber + index).padStart(4, '0')}`,
      title: pick(random, PROBLEMS),
      description: pick(random, CONTEXTS),
      requesterName: `${first} ${last}`,
      // A few requesters are the demo user, so a requester's view is not empty.
      requesterEmail:
        random() < 0.04
          ? 'user@demo.local'
          : `${first}.${last}${index % 40}@example.com`.toLowerCase(),
      status,
      priority,
      assignee,
      category: pick(random, CATEGORIES),
      createdAt,
      ...(resolvedAt ? { resolvedAt } : {}),
      activity: [
        {
          action: 'ticket_created',
          detail: 'Generated sample ticket',
          actorName: 'Priya Admin',
          actorRole: 'admin',
          actorEmail: 'admin@demo.local',
        },
      ],
    };
  });
}
