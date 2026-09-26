import { breakerConfig, breakerState, DEFAULT_BREAKER } from './agentBreaker';

const NOW = new Date('2026-06-01T12:00:00Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const failed = (minutes: number) => ({ outcome: 'error', at: ago(minutes) });
const worked = (minutes: number) => ({ outcome: 'proposed', at: ago(minutes) });

describe('breakerState', () => {
  test('is closed with no record at all, and with a few failures', () => {
    expect(breakerState([], NOW)).toEqual({ open: false, consecutiveFailures: 0 });
    expect(breakerState([failed(1), failed(2), failed(3), failed(4)], NOW)).toEqual({
      open: false,
      consecutiveFailures: 4,
    });
  });

  test('opens after five failed runs in a row, and says when it will let a run through again', () => {
    const state = breakerState([failed(1), failed(2), failed(3), failed(4), failed(5)], NOW);
    expect(state).toEqual({
      open: true,
      consecutiveFailures: 5,
      reopensAt: new Date(ago(1).getTime() + DEFAULT_BREAKER.cooldownMs),
    });
  });

  test('a success in the middle of the failures breaks the run of them', () => {
    expect(
      breakerState([failed(1), failed(2), worked(3), failed(4), failed(5), failed(6)], NOW)
    ).toEqual({ open: false, consecutiveFailures: 2 });
  });

  test('every kind of finished run that is not a failure counts as working', () => {
    for (const outcome of ['proposed', 'escalated', 'posted', 'triaged']) {
      const attempts = [
        failed(1),
        failed(2),
        failed(3),
        failed(4),
        { outcome, at: ago(5) },
        failed(6),
      ];
      expect(breakerState(attempts, NOW).consecutiveFailures).toBe(4);
    }
  });

  test('stays open for the cooldown after the latest failure, and lets a run through after it', () => {
    const attempts = (latest: number) => [0, 1, 2, 3, 4].map((n) => failed(latest + n));
    expect(breakerState(attempts(9), NOW).open).toBe(true);
    expect(breakerState(attempts(10), NOW).open).toBe(false);
    expect(breakerState(attempts(11), NOW).open).toBe(false);
    // Closed again only because it is time to probe: the failures are still on the record.
    expect(breakerState(attempts(11), NOW).consecutiveFailures).toBe(5);
  });

  test('a failed probe opens it again for a fresh cooldown, and a good one closes it', () => {
    const old = [11, 12, 13, 14, 15].map(failed);
    expect(breakerState([failed(1), ...old], NOW).open).toBe(true);
    expect(breakerState([worked(1), ...old], NOW)).toEqual({ open: false, consecutiveFailures: 0 });
  });

  test('the limits can be changed', () => {
    const attempts = [failed(1), failed(2)];
    expect(breakerState(attempts, NOW, { failures: 2, cooldownMs: 5 * 60_000 }).open).toBe(true);
    expect(breakerState(attempts, NOW, { failures: 3, cooldownMs: 5 * 60_000 }).open).toBe(false);
    expect(
      breakerState([failed(6), failed(7)], NOW, { failures: 2, cooldownMs: 5 * 60_000 }).open
    ).toBe(false);
  });
});

describe('breakerConfig', () => {
  test('defaults to five failures and ten minutes', () => {
    expect(breakerConfig({})).toEqual({ failures: 5, cooldownMs: 600_000 });
  });

  test('reads the environment, and ignores a value that makes no sense', () => {
    expect(
      breakerConfig({ AGENT_BREAKER_FAILURES: '3', AGENT_BREAKER_COOLDOWN_MS: '30000' })
    ).toEqual({ failures: 3, cooldownMs: 30_000 });
    for (const bad of ['', '0', '-1', 'lots', ' ']) {
      expect(
        breakerConfig({ AGENT_BREAKER_FAILURES: bad, AGENT_BREAKER_COOLDOWN_MS: bad })
      ).toEqual({ failures: 5, cooldownMs: 600_000 });
    }
    expect(breakerConfig({ AGENT_BREAKER_FAILURES: '2.9' }).failures).toBe(2);
  });
});
