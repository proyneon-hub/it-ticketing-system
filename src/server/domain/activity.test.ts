import type { TokenPayload } from '../auth';
import { activityEntriesForPatch, activityEntry } from './activity';

const tech: TokenPayload = {
  sub: 'usr_tech',
  name: 'Theo Technician',
  email: 'tech@demo.local',
  role: 'technician',
  exp: 0,
};
const existing = { status: 'open', priority: 'medium', assignee: 'Unassigned' } as const;

const actions = (entries: { action: string }[]) => entries.map((entry) => entry.action);

describe('activityEntry', () => {
  test('stamps who acted, and only includes the fields it was given', () => {
    expect(activityEntry(tech, { action: 'ticket_closed' })).toEqual({
      action: 'ticket_closed',
      actorName: 'Theo Technician',
      actorRole: 'technician',
      actorEmail: 'tech@demo.local',
    });
  });

  test('records from and to as text, including an empty previous value', () => {
    expect(activityEntry(tech, { action: 'assignee_changed', from: '', to: 'Una' })).toMatchObject({
      from: '',
      to: 'Una',
    });
  });
});

describe('activityEntriesForPatch', () => {
  test('records each tracked field that actually changed, with the value it replaced', () => {
    const entries = activityEntriesForPatch(tech, existing, {
      status: 'assigned',
      assignee: 'Theo Technician',
    });

    expect(actions(entries)).toEqual(['status_changed', 'assignee_changed']);
    expect(entries[0]).toMatchObject({ from: 'open', to: 'assigned' });
    expect(entries[1]).toMatchObject({ from: 'Unassigned', to: 'Theo Technician' });
  });

  test('ignores a field that is sent but unchanged', () => {
    const entries = activityEntriesForPatch(tech, existing, { priority: 'medium', category: 'X' });

    expect(actions(entries)).toEqual(['ticket_updated']);
    expect(entries[0]?.detail).toBe('Updated priority, category');
  });

  test('resolving and closing add a milestone entry', () => {
    const inProgress = { ...existing, status: 'in-progress' } as const;
    expect(actions(activityEntriesForPatch(tech, inProgress, { status: 'resolved' }))).toEqual([
      'status_changed',
      'ticket_resolved',
    ]);
    const resolved = { ...existing, status: 'resolved' } as const;
    expect(actions(activityEntriesForPatch(tech, resolved, { status: 'closed' }))).toEqual([
      'status_changed',
      'ticket_closed',
    ]);
  });

  test('reopening adds ticket_reopened', () => {
    const resolved = { ...existing, status: 'resolved' } as const;
    expect(actions(activityEntriesForPatch(tech, resolved, { status: 'in-progress' }))).toEqual([
      'status_changed',
      'ticket_reopened',
    ]);
  });

  test('re-sending the current status does not log a milestone again', () => {
    const resolved = { ...existing, status: 'resolved' } as const;
    expect(actions(activityEntriesForPatch(tech, resolved, { status: 'resolved' }))).toEqual([
      'ticket_updated',
    ]);
  });
});
