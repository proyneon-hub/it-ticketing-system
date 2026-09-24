// Pure rules behind the trends chart: which days a window covers and how raw daily
// counts become the numbers people read. No database here; the repository supplies
// the counts and the service hands them over.

export const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const DEFAULT_TIME_ZONE = 'UTC';

// True for a name the runtime knows (America/Toronto, UTC), false for anything else.
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return true;
  } catch {
    return false;
  }
}

// The calendar date (YYYY-MM-DD) that `at` falls on in `timeZone`.
export function dayKey(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

// The last `days` calendar days ending today in `timeZone`, oldest first. It counts back
// through the calendar itself (as plain dates), not in 24-hour steps, so a daylight-saving
// change with a 23- or 25-hour day cannot skip or repeat a date.
export function windowDays(now: Date, days: number, timeZone: string): string[] {
  const [year = 0, month = 1, day = 1] = dayKey(now, timeZone).split('-').map(Number);
  const today = Date.UTC(year, month - 1, day);
  return Array.from({ length: days }, (_, index) =>
    new Date(today - (days - 1 - index) * DAY_MS).toISOString().slice(0, 10)
  );
}

// How far back a query has to look to cover every day in the window whatever the
// time zone: one extra day on the front absorbs offsets of up to a day.
export const lookbackStart = (now: Date, days: number): Date =>
  new Date(now.getTime() - (days + 1) * DAY_MS);

export interface OpenedRow {
  _id: string;
  count: number;
}

export interface ResolvedRow {
  _id: string;
  count: number;
  // Sum of (resolvedAt - createdAt) in milliseconds over the day's tickets.
  totalMs: number;
  // How many of the day's tickets were resolved on or before their SLA deadline.
  met: number;
}

export interface Trends {
  days: number;
  timeZone: string;
  series: { date: string; opened: number; resolved: number }[];
  resolution: {
    resolved: number;
    // Mean time to resolve, in hours to one decimal place. Null when nothing was resolved.
    meanHours: number | null;
  };
  sla: {
    resolved: number;
    met: number;
    // Share of resolved tickets that met their deadline, one decimal place. Null when nothing was resolved.
    compliancePercent: number | null;
  };
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

// Turns daily counts into the chart series and the two headline numbers. Days with
// nothing in them appear as zeros, and rows for days outside the window are ignored.
export function buildTrends(
  keys: string[],
  opened: OpenedRow[],
  resolved: ResolvedRow[],
  timeZone: string
): Trends {
  const openedByDay = new Map(opened.map((row) => [row._id, row.count]));
  const resolvedByDay = new Map(resolved.map((row) => [row._id, row]));

  let resolvedTotal = 0;
  let totalMs = 0;
  let met = 0;
  const series = keys.map((date) => {
    const row = resolvedByDay.get(date);
    resolvedTotal += row?.count ?? 0;
    totalMs += row?.totalMs ?? 0;
    met += row?.met ?? 0;
    return { date, opened: openedByDay.get(date) ?? 0, resolved: row?.count ?? 0 };
  });

  return {
    days: keys.length,
    timeZone,
    series,
    resolution: {
      resolved: resolvedTotal,
      meanHours: resolvedTotal > 0 ? round1(totalMs / resolvedTotal / HOUR_MS) : null,
    },
    sla: {
      resolved: resolvedTotal,
      met,
      compliancePercent: resolvedTotal > 0 ? round1((met / resolvedTotal) * 100) : null,
    },
  };
}
