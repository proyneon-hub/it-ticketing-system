import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Express } from 'express';
import request, { type Response } from 'supertest';

// The three demo accounts every suite signs in with.
export const credentials = {
  admin: ['admin@demo.local', 'AdminPass123!'],
  tech: ['tech@demo.local', 'TechPass123!'],
  user: ['user@demo.local', 'UserPass123!'],
} as const;

export type Account = keyof typeof credentials;
export type Tokens = Record<Account, string>;

export type TestDatabase = MongoMemoryReplSet;

// Starts a throwaway MongoDB and points the app at it. Call before touching the database.
// It is a one-node replica set, like Atlas, because multi-document transactions (the
// last-admin guard, for one) only exist on a replica set.
export async function startTestDatabase(): Promise<TestDatabase> {
  const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = mongod.getUri();
  return mongod;
}

export async function signInAll(app: Express): Promise<Tokens> {
  const tokens = {} as Tokens;
  for (const [account, [email, password]] of Object.entries(credentials) as [
    Account,
    readonly [string, string],
  ][]) {
    const response = await request(app).post('/api/auth/login').send({ email, password });
    tokens[account] = response.body.token;
  }
  return tokens;
}

export const bearer = (tokens: Tokens, account: Account) => ({
  Authorization: `Bearer ${tokens[account]}`,
});

// The value of a cookie a response set, or undefined if it did not set it.
export function cookieValue(response: Response, name = 'rt'): string | undefined {
  const cookies = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
  const line = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return line?.split(';')[0]?.slice(name.length + 1);
}

// The raw Set-Cookie line for a cookie, including its attributes.
export function cookieLine(response: Response, name = 'rt'): string {
  const cookies = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
  return cookies.find((cookie) => cookie.startsWith(`${name}=`)) ?? '';
}
