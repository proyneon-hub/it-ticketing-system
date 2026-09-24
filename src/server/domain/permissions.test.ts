import type { TokenPayload } from '../auth';
import { assertCanMutateTicket, requesterOverrides, requesterScope } from './permissions';

const user = (role: TokenPayload['role'], email = 'una@demo.local'): TokenPayload => ({
  sub: `usr_${role}`,
  name: 'Una User',
  email,
  role,
  exp: 0,
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
