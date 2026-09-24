import { HOUR_MS } from './sla';
import { csvEscape, csvHeaderLine, ticketToCsvLine } from './csv';

describe('csvEscape', () => {
  test.each([
    [null, ''],
    [undefined, ''],
    [42, '42'],
    ['plain', 'plain'],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['two\nlines', '"two\nlines"'],
    [new Date('2026-01-02T03:04:05.000Z'), '2026-01-02T03:04:05.000Z'],
  ])('%j becomes %j', (value, expected) => {
    expect(csvEscape(value)).toBe(expected);
  });

  test.each(['=SUM(A1)', '+1', '-1', '@cmd', '\tx'])(
    'neutralises the spreadsheet formula %j with a leading apostrophe',
    (value) => {
      expect(csvEscape(value).startsWith("'")).toBe(true);
    }
  );
});

describe('ticketToCsvLine', () => {
  const now = new Date('2026-06-10T12:00:00.000Z').getTime();
  const ticket = {
    _id: { toString: () => '665f0f40d5d4f541f8ef1001' },
    ticketNumber: 'TKT-0001',
    title: 'Printer, second floor',
    status: 'open',
    priority: 'high',
    requesterEmail: 'avery@example.com',
    requesterName: 'Avery',
    assignee: 'Theo',
    createdAt: new Date(now - 5 * HOUR_MS),
    updatedAt: new Date(now - HOUR_MS),
    dueAt: new Date(now - 2 * HOUR_MS),
  } as const;

  test('writes one row in header order and quotes cells that need it', () => {
    expect(csvHeaderLine().split(',')).toHaveLength(10);
    const row = ticketToCsvLine(ticket, now);
    expect(
      row.startsWith('TKT-0001,"Printer, second floor",open,high,avery@example.com,Theo,')
    ).toBe(true);
    expect(row.endsWith(',Yes')).toBe(true);
  });

  test('marks SLA breached only for unresolved tickets past their deadline', () => {
    expect(ticketToCsvLine({ ...ticket, status: 'resolved' }, now).endsWith(',No')).toBe(true);
    expect(
      ticketToCsvLine({ ...ticket, dueAt: new Date(now + HOUR_MS) }, now).endsWith(',No')
    ).toBe(true);
  });

  test('falls back to the id when there is no ticket number, and to the name when there is no email', () => {
    const row = ticketToCsvLine({ ...ticket, ticketNumber: undefined, requesterEmail: '' }, now);
    expect(row.startsWith('665f0f40d5d4f541f8ef1001,')).toBe(true);
    expect(row).toContain(',Avery,');
  });
});
