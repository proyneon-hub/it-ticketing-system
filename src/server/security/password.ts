import { randomBytes } from 'crypto';
import { argon2Verify, argon2id } from 'hash-wasm';

// argon2id, the memory-hard password hash OWASP recommends first. These are its
// minimum recommended settings (19 MiB, 2 passes, 1 lane): about 40 ms here, which is
// cheap for one sign-in and expensive for someone guessing millions of passwords.
// hash-wasm is WebAssembly, so it runs the same on Windows, Alpine and Vercel with no
// native build step.
const PARAMS = { parallelism: 1, iterations: 2, memorySize: 19456, hashLength: 32 };

// Longer than any real password; stops a huge input being used to burn CPU.
export const MAX_PASSWORD_LENGTH = 200;

export function hashPassword(password: string): Promise<string> {
  return argon2id({ password, salt: randomBytes(16), ...PARAMS, outputType: 'encoded' });
}

let decoyHash: Promise<string> | undefined;

// True when `password` matches `hash`. With no hash (an unknown account) it still does
// the same amount of work against a decoy, so how long a sign-in takes does not reveal
// whether the email exists.
export async function verifyPassword(
  hash: string | null | undefined,
  password: string
): Promise<boolean> {
  if (password.length > MAX_PASSWORD_LENGTH) return false;

  decoyHash = decoyHash ?? hashPassword('decoy-password-for-unknown-accounts');
  try {
    const matches = await argon2Verify({ password, hash: hash ?? (await decoyHash) });
    return hash ? matches : false;
  } catch (_error) {
    return false; // A malformed stored hash is never a match.
  }
}
