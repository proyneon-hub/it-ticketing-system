import type { TokenPayload } from '../auth';
import {
  assertAgentScope,
  assertCanMutateTicket,
  assertHuman,
  requesterOverrides,
  requesterScope,
} from './permissions';

const user = (role: TokenPayload['role'], email = 'una@demo.local'): TokenPayload => ({
  sub: `usr_${role}`,
  name: 'Una User',
  email,
  role,
  exp: 0,
});

const TICKET = '665f0f40d5d4f541f8ef2002';
const OTHER = '665f0f40d5d4f541f8ef2003';
const agent = (): TokenPayload => ({ ...user('agent'), ticketId: TICKET, runId: 'run-1' });

describe('the agent', () => {
  test('may work on the ticket in its token and no other', () => {
    expect(() => assertAgentScope(agent(), TICKET)).not.toThrow();
    expect(() => assertAgentScope(agent(), OTHER)).toThrow(
      expect.objectContaining({ statusCode: 403, message: expect.stringMatching(/started for/) })
    );
  });

  test('is refused a ticket if its token somehow names none', () => {
    const unscoped: TokenPayload = { ...user('agent'), runId: 'run-1' };
    expect(() => assertAgentScope(unscoped, TICKET)).toThrow(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  test('the scope check leaves people alone', () => {
    expect(() => assertAgentScope(user('technician'), OTHER)).not.toThrow();
    expect(() => assertAgentScope(user('user'), OTHER)).not.toThrow();
  });

  test('assertHuman refuses the agent and lets everyone else through', () => {
    expect(() => assertHuman(agent())).toThrow(expect.objectContaining({ statusCode: 403 }));
    for (const role of ['admin', 'technician', 'user'] as const) {
      expect(() => assertHuman(user(role))).not.toThrow();
    }
  });

  test.each(['category', 'priority', 'assignee'])('may set %s', (field) => {
    expect(() =>
      assertCanMutateTicket(agent(), { requesterEmail: 'other@x.com' }, { [field]: 'x' })
    ).not.toThrow();
  });

  test.each(['status', 'title', 'description', 'requesterEmail', 'requesterName', 'dueAt'])(
    'cannot change %s',
    (field) => {
      expect(() =>
        assertCanMutateTicket(agent(), { requesterEmail: 'other@x.com' }, { [field]: 'x' })
      ).toThrow(
        expect.objectContaining({ statusCode: 403, message: expect.stringMatching(/only set/) })
      );
    }
  );

  test('is not restricted to one requester the way a requester is', () => {
    expect(requesterScope(agent())).toBeUndefined();
  });
});

describe('requesterScope', () => {
  test('limits a requester to their own address and leaves staff unrestricted', () => {
    expect(requesterScope(user('user'))).toBe('una@demo.local');
    expect(requesterScope(user('technician'))).toBeUndefined();
    expect(requesterScope(user('admin'))).toBeUndefined();
  });
});

describe('assertCanMutateTicket', () => {
  const own = { requesterEmail: 'una@demo.local' };

  test('staff may change anything on any ticket', () => {
    expect(() =>
      assertCanMutateTicket(
        user('technician'),
        { requesterEmail: 'other@x.com' },
        { status: 'closed' }
      )
    ).not.toThrow();
  });

  test('a requester may edit descriptive fields on their own ticket', () => {
    expect(() =>
      assertCanMutateTicket(user('user'), own, {
        title: 't',
        description: 'd',
        priority: 'high',
        category: 'c',
      })
    ).not.toThrow();
  });

  test("a requester cannot touch someone else's ticket, whatever the fields", () => {
    expect(() =>
      assertCanMutateTicket(user('user'), { requesterEmail: 'other@x.com' }, { title: 't' })
    ).toThrow(
      expect.objectContaining({ statusCode: 403, message: expect.stringMatching(/created/) })
    );
  });

  test('the ownership check ignores letter case in the address', () => {
    expect(() =>
      assertCanMutateTicket(user('user', 'UNA@demo.local'), own, { title: 't' })
    ).not.toThrow();
  });

  test.each(['status', 'assignee', 'requesterEmail', 'requesterName', 'dueAt'])(
    'a requester cannot change %s',
    (field) => {
      expect(() => assertCanMutateTicket(user('user'), own, { [field]: 'x' })).toThrow(
        expect.objectContaining({ statusCode: 403, message: expect.stringMatching(/workflow/) })
      );
    }
  );
});

describe('requesterOverrides', () => {
  test('sets identity from the session and forces an open, unassigned ticket', () => {
    expect(requesterOverrides(user('user'))).toEqual({
      requesterName: 'Una User',
      requesterEmail: 'una@demo.local',
      requesterUserId: 'usr_user',
      status: 'open',
      assignee: 'Unassigned',
    });
  });
});
