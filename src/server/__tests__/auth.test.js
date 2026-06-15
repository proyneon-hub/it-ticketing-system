const { authenticateDemoUser, issueToken, verifyToken } = require('../auth');

describe('demo auth tokens', () => {
  test('authenticates a seeded admin and verifies the issued token', () => {
    const user = authenticateDemoUser('admin@demo.local', 'AdminPass123!');
    const token = issueToken(user);

    expect(user.role).toBe('admin');
    expect(verifyToken(token)).toMatchObject({
      email: 'admin@demo.local',
      role: 'admin'
    });
  });

  test('rejects invalid credentials and tampered tokens', () => {
    expect(authenticateDemoUser('admin@demo.local', 'wrong')).toBeNull();
    expect(verifyToken('not-a-token')).toBeNull();
  });
});
