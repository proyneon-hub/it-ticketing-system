import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Express } from 'express';
import request from 'supertest';

// The three demo accounts every suite signs in with.
export const credentials = {
  admin: ['admin@demo.local', 'AdminPass123!'],
  tech: ['tech@demo.local', 'TechPass123!'],
  user: ['user@demo.local', 'UserPass123!'],
} as const;

export type Account = keyof typeof credentials;
export type Tokens = Record<Account, string>;

// Starts a throwaway MongoDB and points the app at it. Call before touching the database.
export async function startTestDatabase(): Promise<MongoMemoryServer> {
  const mongod = await MongoMemoryServer.create();
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
