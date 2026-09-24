import type { TokenPayload } from '../auth';
import {
  MAX_ATTEMPTS,
  backoffMs,
  commentEvent,
  createdEvent,
  describeEvent,
  patchEvents,
  slaEvent,
  webhookBody,
  webhookFormat,
} from './outbox';

const tech: TokenPayload = {
  sub: 'u1',
  exp: 0,
  name: 'Theo Technician',
  email: 'tech@demo.local',
  role: 'technician',
};

const ticket = {
  _id: 'abc123',
  ticketNumber: 'TKT-0042',
  title: 'VPN drops',
  status: 'open' as const,
  priority: 'high' as const,
  assignee: 'Unassigned',
};

describe('events', () => {
  test('a created ticket produces one event with a small snapshot and the actor', () => {
    expect(createdEvent(ticket, tech)).toEqual({
      type: 'ticket.created',
      payload: {
        ticket: {
          id: 'abc123',
          number: 'TKT-0042',
          title: 'VPN drops',
          status: 'open',
          priority: 'high',
          assignee: 'Unassigned',
        },
        actor: { name: 'Theo Technician', role: 'technician' },
      },
    });
  });

  test('an edit produces an event per thing that changed, and none when nothing did', () => {
    const before = { status: 'open' as const, assignee: 'Unassigned' };
    const after = { ...ticket, status: 'assigned' as const, assignee: 'Theo Technician' };

    const events = patchEvents(before, after, tech);
    expect(events.map((event) => event.type)).toEqual(['ticket.status_changed', 'ticket.assigned']);
    expect(events[0]?.payload.change).toEqual({ from: 'open', to: 'assigned' });
    expect(events[1]?.payload.change).toEqual({ from: 'Unassigned', to: 'Theo Technician' });

    expect(patchEvents({ status: 'open', assignee: 'Unassigned' }, ticket, tech)).toEqual([]);
  });

  test('handing a ticket back to nobody is not an assignment', () => {
    const events = patchEvents(
      { status: 'assigned', assignee: 'Theo Technician' },
      { ...ticket, status: 'assigned', assignee: 'Unassigned' },
      tech
    );
    expect(events).toEqual([]);
  });

  test('a comment event says who and whether it was internal, and carries no text', () => {
    const event = commentEvent(ticket, tech, 'internal');
    expect(event.type).toBe('ticket.comment_added');
    expect(event.payload.visibility).toBe('internal');
    expect(Object.keys(event.payload).sort()).toEqual(['actor', 'ticket', 'visibility']);
  });

  test('an SLA event has no person behind it', () => {
    expect(slaEvent('breached', ticket, { from: 'high', to: 'urgent' })).toMatchObject({
      type: 'ticket.sla_breached',
      payload: { actor: null, change: { from: 'high', to: 'urgent' } },
    });
    expect(slaEvent('at_risk', ticket).type).toBe('ticket.sla_at_risk');
  });
});

describe('backoff', () => {
  test('doubles from 30 seconds and stops at an hour', () => {
    const middle = 0.5; // No jitter.
    expect([1, 2, 3, 4, 5].map((attempt) => backoffMs(attempt, middle))).toEqual([
      30_000, 60_000, 120_000, 240_000, 480_000,
    ]);
    expect(backoffMs(12, middle)).toBe(3_600_000);
    expect(backoffMs(40, middle)).toBe(3_600_000);
  });

  test('spreads retries by up to 20 percent either way', () => {
    expect(backoffMs(3, 0)).toBe(96_000);
    expect(backoffMs(3, 1)).toBe(144_000);
  });

  test('gives up after six tries', () => {
    expect(MAX_ATTEMPTS).toBe(6);
  });
});

describe('webhook format', () => {
  test.each([
    ['https://discord.com/api/webhooks/1/abc', 'discord'],
    ['https://discordapp.com/api/webhooks/1/abc', 'discord'],
    ['https://hooks.slack.com/services/T/B/x', 'slack'],
    ['https://example.com/hook', 'json'],
    ['https://notdiscord.com/hook', 'json'],
    ['not a url', 'json'],
  ])('%s is %s', (url, format) => {
    expect(webhookFormat(url)).toBe(format);
  });

  test('an explicit format wins', () => {
    expect(webhookFormat('https://example.com/hook', 'slack')).toBe('slack');
    expect(webhookFormat('https://discord.com/x', 'json')).toBe('json');
    expect(webhookFormat('https://discord.com/x', 'nonsense')).toBe('discord');
  });
});

describe('messages', () => {
  const created = createdEvent(ticket, tech).payload;

  test.each([
    ['ticket.created', created, 'New high ticket TKT-0042 "VPN drops" by Theo Technician.'],
    [
      'ticket.status_changed',
      { ...created, change: { from: 'open', to: 'assigned' } },
      'TKT-0042 "VPN drops" moved from open to assigned by Theo Technician.',
    ],
    [
      'ticket.assigned',
      { ...created, ticket: { ...created.ticket, assignee: 'Sam Field' } },
      'TKT-0042 "VPN drops" assigned to Sam Field by Theo Technician.',
    ],
    [
      'ticket.comment_added',
      { ...created, visibility: 'public' },
      'New comment on TKT-0042 "VPN drops" by Theo Technician.',
    ],
    [
      'ticket.comment_added',
      { ...created, visibility: 'internal' },
      'Internal note added to TKT-0042 "VPN drops" by Theo Technician.',
    ],
    [
      'ticket.sla_at_risk',
      { ...created, actor: null },
      'SLA at risk: TKT-0042 "VPN drops" (high, Unassigned) is due within 24 hours.',
    ],
    [
      'ticket.sla_breached',
      { ...created, actor: null, change: { from: 'high', to: 'urgent' } },
      'SLA breached: TKT-0042 "VPN drops" is overdue and was raised from high to urgent.',
    ],
    [
      'ticket.sla_breached',
      { ...created, actor: null },
      'SLA breached: TKT-0042 "VPN drops" is overdue.',
    ],
  ] as const)('%s reads as a sentence', (type, payload, text) => {
    expect(describeEvent(type, payload)).toBe(text);
  });

  test('each service gets the shape it expects', () => {
    expect(webhookBody('discord', 'ticket.created', created)).toMatchObject({
      content: expect.stringContaining('TKT-0042'),
    });
    expect(webhookBody('slack', 'ticket.created', created)).toMatchObject({
      text: expect.stringContaining('TKT-0042'),
    });
    expect(webhookBody('json', 'ticket.created', created)).toMatchObject({
      type: 'ticket.created',
      payload: created,
    });
  });

  test('a title cannot ping a whole channel', () => {
    const hostile = createdEvent(
      { ...ticket, title: '@everyone <!channel> & <@U123>' },
      tech
    ).payload;

    // Discord: no mention in the text may notify anyone.
    expect(webhookBody('discord', 'ticket.created', hostile)).toMatchObject({
      allowed_mentions: { parse: [] },
    });
    // Slack: angle brackets are commands, so they are escaped.
    const slack = webhookBody('slack', 'ticket.created', hostile) as { text: string };
    expect(slack.text).not.toContain('<');
    expect(slack.text).toContain('&lt;!channel&gt;');
    expect(slack.text).toContain('&amp;');
  });
});
