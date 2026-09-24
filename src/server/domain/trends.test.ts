import { buildTrends, dayKey, isValidTimeZone, lookbackStart, windowDays } from './trends';

describe('time zones', () => {
  test('recognises real names and rejects others', () => {
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('America/Toronto')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  test('the same instant is a different date in different zones', () => {
    const at = new Date('2026-06-15T02:00:00Z');
    expect(dayKey(at, 'UTC')).toBe('2026-06-15');
    expect(dayKey(at, 'America/Toronto')).toBe('2026-06-14'); // 22:00 the evening before
    expect(dayKey(at, 'Asia/Tokyo')).toBe('2026-06-15');
  });
});

describe('windowDays', () => {
  test('lists the last N calendar days ending today, oldest first', () => {
    expect(windowDays(new Date('2026-06-15T16:00:00Z'), 3, 'America/Toronto')).toEqual([
      '2026-06-13',
      '2026-06-14',
      '2026-06-15',
    ]);
  });

  test('today is the date in the caller’s zone, not in UTC', () => {
    const now = new Date('2026-06-15T02:00:00Z');
    expect(windowDays(now, 1, 'UTC')).toEqual(['2026-06-15']);
    expect(windowDays(now, 1, 'America/Toronto')).toEqual(['2026-06-14']);
  });

  test('crosses month and year ends', () => {
    expect(windowDays(new Date('2027-01-02T12:00:00Z'), 4, 'UTC')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });

  test('does not skip or repeat a date when clocks change', () => {
    // Toronto sprang forward on 2026-03-08 (a 23-hour day) and fell back on 2026-11-01 (25 hours).
    expect(windowDays(new Date('2026-03-09T12:00:00Z'), 4, 'America/Toronto')).toEqual([
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
    ]);
    expect(windowDays(new Date('2026-11-02T12:00:00Z'), 4, 'America/Toronto')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });

  test('a 90-day window has 90 distinct days', () => {
    const keys = windowDays(new Date('2026-11-02T12:00:00Z'), 90, 'America/Toronto');
    expect(new Set(keys).size).toBe(90);
  });

  test('the lookback reaches one day before the window starts', () => {
    const now = new Date('2026-06-15T16:00:00Z');
    expect(lookbackStart(now, 3).toISOString()).toBe('2026-06-11T16:00:00.000Z');
  });
});

describe('buildTrends', () => {
  const keys = ['2026-06-13', '2026-06-14', '2026-06-15'];

  test('fills days with nothing in them with zeros', () => {
    const trends = buildTrends(keys, [{ _id: '2026-06-14', count: 2 }], [], 'UTC');
    expect(trends.series).toEqual([
      { date: '2026-06-13', opened: 0, resolved: 0 },
      { date: '2026-06-14', opened: 2, resolved: 0 },
      { date: '2026-06-15', opened: 0, resolved: 0 },
    ]);
  });

  test('says nothing rather than zero when no ticket was resolved', () => {
    const trends = buildTrends(keys, [], [], 'UTC');
    expect(trends.resolution).toEqual({ resolved: 0, meanHours: null });
    expect(trends.sla).toEqual({ resolved: 0, met: 0, compliancePercent: null });
  });

  test('averages the time to resolve across the whole window and rounds to a tenth', () => {
    const hour = 3_600_000;
    const trends = buildTrends(
      keys,
      [],
      [
        { _id: '2026-06-13', count: 1, totalMs: 17 * hour, met: 1 },
        { _id: '2026-06-15', count: 2, totalMs: 128 * hour, met: 1 },
      ],
      'UTC'
    );
    expect(trends.resolution).toEqual({ resolved: 3, meanHours: 48.3 });
    expect(trends.sla).toEqual({ resolved: 3, met: 2, compliancePercent: 66.7 });
  });

  test('ignores rows for days outside the window', () => {
    const trends = buildTrends(
      keys,
      [{ _id: '2026-06-01', count: 9 }],
      [{ _id: '2026-06-01', count: 9, totalMs: 1, met: 9 }],
      'UTC'
    );
    expect(trends.series.every((day) => day.opened === 0 && day.resolved === 0)).toBe(true);
    expect(trends.resolution.resolved).toBe(0);
  });
});
