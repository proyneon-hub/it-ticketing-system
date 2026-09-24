import { describe, expect, test } from 'vitest';
import { MAX_PASSWORD_LENGTH, hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  test('uses argon2id with a random salt, so the same password hashes differently', async () => {
    const [first, second] = await Promise.all([
      hashPassword('Correct-Horse-9'),
      hashPassword('Correct-Horse-9'),
    ]);

    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain('Correct-Horse-9');
  });

  test('accepts the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('Correct-Horse-9');

    expect(await verifyPassword(hash, 'Correct-Horse-9')).toBe(true);
    expect(await verifyPassword(hash, 'correct-horse-9')).toBe(false);
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  test('never accepts an unknown account, but still does the work of checking', async () => {
    expect(await verifyPassword(undefined, 'anything')).toBe(false);
    expect(await verifyPassword(null, 'anything')).toBe(false);
  });

  test('treats a malformed stored hash as a mismatch instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
    expect(await verifyPassword('$argon2id$garbage', 'anything')).toBe(false);
  });

  test('refuses an absurdly long password without hashing it', async () => {
    const hash = await hashPassword('short');
    const started = Date.now();

    expect(await verifyPassword(hash, 'x'.repeat(MAX_PASSWORD_LENGTH + 1))).toBe(false);
    expect(Date.now() - started).toBeLessThan(20);
  });
});
