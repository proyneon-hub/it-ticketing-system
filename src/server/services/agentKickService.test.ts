import { logger } from '../logger';
import { kickAgent, shouldKick } from './agentKickService';

const SECRET = 'a-long-enough-secret-for-the-agent-kick-tests';

const vercel = (overrides: Record<string, string | undefined> = {}) => ({
  AGENT_ENABLED: 'true',
  CRON_SECRET: SECRET,
  VERCEL: '1',
  VERCEL_ENV: 'production',
  VERCEL_PROJECT_PRODUCTION_URL: 'desk.example.com',
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shouldKick', () => {
  test('is true only where the agent is on, the job is reachable, and this is Vercel', () => {
    expect(shouldKick(vercel())).toBe(true);
  });

  test.each([
    ['the agent is off', { AGENT_ENABLED: undefined }],
    ['the agent is off (false)', { AGENT_ENABLED: 'false' }],
    ['there is no job secret', { CRON_SECRET: undefined }],
    ['the job secret is too short', { CRON_SECRET: 'short' }],
    ['this is not Vercel, where a worker loop runs the job instead', { VERCEL: undefined }],
  ])('is false when %s', (_why, overrides) => {
    expect(shouldKick(vercel(overrides))).toBe(false);
  });
});

describe('kickAgent', () => {
  const stub = (answer: () => Promise<Response> | Response = () => new Response('{}')) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = ((url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(answer());
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  };
  const kept: Promise<unknown>[] = [];
  const keepAlive = (work: Promise<unknown>) => {
    kept.push(work);
  };
  beforeEach(() => {
    kept.length = 0;
  });

  test('asks the deployment to run the agent job, with the job secret', async () => {
    const { calls, fetchImpl } = stub();
    kickAgent({ env: vercel(), fetchImpl, keepAlive });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://desk.example.com/api/jobs/agent-runs');
    expect(calls[0]?.init).toMatchObject({
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}` },
      redirect: 'error',
    });
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  test('hands the work to the platform to keep alive, and does not wait for it itself', async () => {
    let release: () => void = () => undefined;
    const slow = new Promise<Response>((resolve) => {
      release = () => resolve(new Response('{}'));
    });
    const { fetchImpl } = stub(() => slow);

    // Returns at once, though the request has not finished.
    expect(kickAgent({ env: vercel(), fetchImpl, keepAlive })).toBeUndefined();
    expect(kept).toHaveLength(1);

    release();
    await kept[0];
  });

  test.each([
    ['the agent is off', { AGENT_ENABLED: undefined }],
    ['there is no job secret', { CRON_SECRET: undefined }],
    ['it is not Vercel', { VERCEL: undefined }],
  ])('does nothing at all when %s', (_why, overrides) => {
    const { calls, fetchImpl } = stub();
    kickAgent({ env: vercel(overrides), fetchImpl, keepAlive });
    expect(calls).toEqual([]);
    expect(kept).toEqual([]);
  });

  test('a job that answers with an error is noted, and is not an error for the caller', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { fetchImpl } = stub(() => new Response('no', { status: 503 }));
    kickAgent({ env: vercel(), fetchImpl, keepAlive });
    await kept[0];
    expect(warn).toHaveBeenCalledWith({ status: 503 }, expect.stringContaining('not accepted'));
  });

  test('a request that fails is noted, and never thrown', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const fetchImpl = (() => Promise.reject(new Error('network down'))) as unknown as typeof fetch;
    expect(() => kickAgent({ env: vercel(), fetchImpl, keepAlive })).not.toThrow();
    await expect(kept[0]).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('failed')
    );
  });

  test('even a fetch that throws before it starts cannot break creating a ticket', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const fetchImpl = (() => {
      throw new Error('bad URL');
    }) as unknown as typeof fetch;
    expect(() => kickAgent({ env: vercel(), fetchImpl, keepAlive })).not.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(kept).toEqual([]);
  });

  test('nor can the platform’s own keep-alive failing', () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { fetchImpl } = stub();
    expect(() =>
      kickAgent({
        env: vercel(),
        fetchImpl,
        keepAlive: () => {
          throw new Error('not in a request');
        },
      })
    ).not.toThrow();
  });
});
