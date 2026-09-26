import {
  AGENT_LOCK_MS,
  DEFAULT_MODEL,
  agentApiBaseUrl,
  agentModel,
  startOfUtcDay,
} from './agentWorkerService';
import { STALE_RUN_MS } from '../repositories/agentRunRepository';

describe('agentApiBaseUrl', () => {
  test('is the address that was configured, if there is one', () => {
    expect(
      agentApiBaseUrl({
        AGENT_API_BASE_URL: ' http://app:5000 ',
        VERCEL_ENV: 'production',
        VERCEL_PROJECT_PRODUCTION_URL: 'desk.example.com',
        VERCEL_URL: 'desk-abc.vercel.app',
      })
    ).toBe('http://app:5000');
  });

  test('on Vercel production, is the production address', () => {
    expect(
      agentApiBaseUrl({
        VERCEL_ENV: 'production',
        VERCEL_PROJECT_PRODUCTION_URL: 'desk.example.com',
        VERCEL_URL: 'desk-abc.vercel.app',
      })
    ).toBe('https://desk.example.com');
  });

  test('on any other Vercel deployment, is that deployment’s own address', () => {
    expect(agentApiBaseUrl({ VERCEL_ENV: 'preview', VERCEL_URL: 'desk-abc.vercel.app' })).toBe(
      'https://desk-abc.vercel.app'
    );
    expect(
      agentApiBaseUrl({
        VERCEL_ENV: 'preview',
        VERCEL_PROJECT_PRODUCTION_URL: 'desk.example.com',
        VERCEL_URL: 'desk-abc.vercel.app',
      })
    ).toBe('https://desk-abc.vercel.app');
  });

  test('elsewhere, is this machine on the app’s port', () => {
    expect(agentApiBaseUrl({})).toBe('http://127.0.0.1:5000');
    expect(agentApiBaseUrl({ PORT: '8080' })).toBe('http://127.0.0.1:8080');
  });

  test('a blank setting is not a setting', () => {
    expect(agentApiBaseUrl({ AGENT_API_BASE_URL: '   ' })).toBe('http://127.0.0.1:5000');
  });

  test('never depends on anything a request could carry', () => {
    // The address comes only from configuration, so a spoofed Host header cannot redirect the
    // agent's token: nothing here takes a request.
    expect(agentApiBaseUrl.length).toBeLessThanOrEqual(1);
  });
});

describe('agentModel', () => {
  test('is Sonnet by default, and what is configured otherwise', () => {
    expect(agentModel({})).toBe(DEFAULT_MODEL);
    expect(DEFAULT_MODEL).toBe('claude-sonnet-5');
    expect(agentModel({ AGENT_MODEL: 'claude-haiku-4-5' })).toBe('claude-haiku-4-5');
    expect(agentModel({ AGENT_MODEL: '  claude-haiku-4-5 ' })).toBe('claude-haiku-4-5');
    expect(agentModel({ AGENT_MODEL: '' })).toBe(DEFAULT_MODEL);
    expect(agentModel({ AGENT_MODEL: '   ' })).toBe(DEFAULT_MODEL);
  });
});

describe('startOfUtcDay', () => {
  test.each([
    ['2026-09-25T00:00:00.000Z', '2026-09-25T00:00:00.000Z'],
    ['2026-09-25T13:45:10.123Z', '2026-09-25T00:00:00.000Z'],
    ['2026-09-25T23:59:59.999Z', '2026-09-25T00:00:00.000Z'],
    ['2026-12-31T23:30:00.000Z', '2026-12-31T00:00:00.000Z'],
    ['2027-01-01T00:00:00.001Z', '2027-01-01T00:00:00.000Z'],
  ])('%s starts its day at %s', (now, expected) => {
    expect(startOfUtcDay(new Date(now)).toISOString()).toBe(expected);
  });

  test('is UTC whatever the machine’s own time zone is', () => {
    // 23:30 UTC is already tomorrow in Toronto's neighbour zones; the cap's day does not move.
    expect(startOfUtcDay(new Date('2026-09-25T23:30:00Z')).getUTCDate()).toBe(25);
  });
});

describe('the lock on an event', () => {
  test('outlasts the time after which a run is considered dead, so a takeover is always allowed', () => {
    // If it did not, a worker that claimed a dead worker's event could find that run still looking
    // alive by a few milliseconds and give up on it.
    expect(AGENT_LOCK_MS).toBeGreaterThan(STALE_RUN_MS);
  });
});
