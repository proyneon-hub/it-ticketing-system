import type { TokenPayload } from '../auth';
import { ForbiddenError } from '../errors';
import {
  assertCanPost,
  commentAddedEntry,
  readableVisibilities,
  visibleActivity,
} from './comments';

const user = (role: TokenPayload['role']): TokenPayload => ({
  sub: 'u1',
  exp: 0,
  name: 'Someone',
  email: 'someone@demo.local',
  role,
});

describe('who reads what', () => {
  test.each([
    ['admin', ['public', 'internal']],
    ['technician', ['public', 'internal']],
    ['user', ['public']],
  ] as const)('%s reads %j', (role, expected) => {
    expect(readableVisibilities(role)).toEqual(expected);
  });
});

describe('who may post', () => {
  test.each(['admin', 'technician'] as const)('%s may post an internal note', (role) => {
    expect(() => assertCanPost(user(role), 'internal')).not.toThrow();
  });

  test('a requester may post a public comment but not an internal note', () => {
    expect(() => assertCanPost(user('user'), 'public')).not.toThrow();
    expect(() => assertCanPost(user('user'), 'internal')).toThrow(ForbiddenError);
  });
});

describe('the history entry for a comment', () => {
  test('marks an internal note as internal and never repeats its text', () => {
    const entry = commentAddedEntry(user('technician'), 'internal');
    expect(entry).toMatchObject({ action: 'comment_added', internal: true });
    expect(entry.detail).toBe('Internal note added');
  });

  test('leaves a public comment unmarked', () => {
    const entry = commentAddedEntry(user('user'), 'public');
    expect(entry.internal).toBeUndefined();
    expect(entry.detail).toBe('Comment added');
  });
});

describe('visibleActivity', () => {
  const history = [
    { action: 'ticket_created' },
    { action: 'comment_added', internal: true },
    { action: 'comment_added' },
  ];

  test('drops internal entries for a requester only', () => {
    expect(visibleActivity(history, 'user').map((entry) => entry.action)).toEqual([
      'ticket_created',
      'comment_added',
    ]);
    expect(visibleActivity(history, 'technician')).toHaveLength(3);
    expect(visibleActivity(history, 'admin')).toHaveLength(3);
  });

  test('copes with a ticket that has no history', () => {
    expect(visibleActivity(undefined, 'user')).toEqual([]);
  });
});
