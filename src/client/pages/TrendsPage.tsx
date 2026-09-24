import { useState } from 'react';
import type { ApiError } from '../api';
import Alert from '../components/Alert';
import TrendChart from '../components/TrendChart';
import { useTrends } from '../queries/trends';

const RANGES = [7, 30, 90] as const;

// The browser's own time zone, so "today" ends at the viewer's midnight.
const browserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

// How the queue has been moving: what came in, what went out, how long it took, and how
// often the SLA held. One date range at the top scopes everything below it.
export default function TrendsPage() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [timeZone] = useState(browserTimeZone);
  const query = useTrends(days, timeZone);
  const trends = query.data;

  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Trends</h2>
        <p>Tickets opened and resolved per day, in {timeZone}.</p>
      </div>

      <div className="trend-filters" role="group" aria-label="Date range">
        {RANGES.map((range) => (
          <button
            key={range}
            type="button"
            className={range === days ? 'primary-button' : 'secondary-button'}
            aria-pressed={range === days}
            onClick={() => setDays(range)}
          >
            Last {range} days
          </button>
        ))}
      </div>

      {query.isPending ? <p role="status">Loading trends...</p> : null}
      {query.isError && !(query.error as ApiError).sessionEnded ? (
        <Alert
          type="error"
          message={(query.error as ApiError).message}
          requestId={(query.error as ApiError).requestId}
        />
      ) : null}

      {trends ? (
        <div className={query.isPlaceholderData ? 'trend-content refreshing' : 'trend-content'}>
          <div className="stats-grid" data-testid="trend-stats">
            <article className="stat-card">
              <p>Opened</p>
              <strong>{sum(trends.series.map((day) => day.opened))}</strong>
              <span>in the last {trends.days} days</span>
            </article>
            <article className="stat-card">
              <p>Resolved</p>
              <strong>{trends.resolution.resolved}</strong>
              <span>resolved or closed</span>
            </article>
            <article className="stat-card">
              <p>Mean time to resolve</p>
              <strong>
                {trends.resolution.meanHours === null ? '–' : `${trends.resolution.meanHours} h`}
              </strong>
              <span>from creation to resolution</span>
            </article>
            <article className="stat-card">
              <p>SLA met</p>
              <strong>
                {trends.sla.compliancePercent === null ? '–' : `${trends.sla.compliancePercent}%`}
              </strong>
              <span>
                {trends.sla.resolved === 0
                  ? 'nothing resolved yet'
                  : `${trends.sla.met} of ${trends.sla.resolved} resolved on time`}
              </span>
            </article>
          </div>

          <TrendChart series={trends.series} />
        </div>
      ) : null}
    </section>
  );
}
