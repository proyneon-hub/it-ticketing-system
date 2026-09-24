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

// A local HTTP server that stands in for a Discord or Slack webhook: it records every body it
// receives and answers with the next status in the queue (200 once the queue is empty, or
// whatever `fallback` is set to).
export interface WebhookStub {
  url: string;
  requests: { path: string; body: unknown }[];
  // Statuses to answer with, one per request, before falling back to `fallback`.
  queue: number[];
  fallback: number;
  reset(): void;
  close(): Promise<void>;
}

export async function startWebhookStub(): Promise<WebhookStub> {
  const { createServer } = await import('http');
  const stub: WebhookStub = {
    url: '',
    requests: [],
    queue: [],
    fallback: 200,
    reset() {
      stub.requests.length = 0;
      stub.queue.length = 0;
      stub.fallback = 200;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };

  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      let body: unknown = raw;
      try {
        body = JSON.parse(raw);
      } catch {
        // Keep the raw text.
      }
      stub.requests.push({ path: req.url ?? '', body });
      res.statusCode = stub.queue.shift() ?? stub.fallback;
      res.end('{}');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  stub.url = `http://127.0.0.1:${port}/hook?token=super-secret-token`;
  return stub;
}
