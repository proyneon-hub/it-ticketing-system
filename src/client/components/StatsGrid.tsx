import { statuses } from '../constants';
import { label } from '../lib/format';
import type { Stats } from '../types';

interface StatCardProps {
  title: string;
  value: string | number;
  helper?: string;
  tone?: 'neutral' | 'danger' | 'warning';
}

function StatCard({ title, value, helper, tone = 'neutral' }: StatCardProps) {
  return (
    <section className={`stat-card ${tone}`}>
      <p>{title}</p>
      <strong>{value}</strong>
      {helper ? <span>{helper}</span> : null}
    </section>
  );
}

interface StatsGridProps {
  stats: Stats | undefined;
  activeCount: number;
  breachedVisibleCount: number;
}

export function StatsGrid({ stats, activeCount, breachedVisibleCount }: StatsGridProps) {
  return (
    <section className="stats-grid">
      <StatCard title="Total Tickets" value={stats?.total ?? '-'} helper="Scoped to current role" />
      <StatCard
        title="Active Tickets"
        value={activeCount}
        helper="Open, assigned, or in progress"
      />
      <StatCard
        title="SLA Breached"
        value={stats?.sla?.breached ?? breachedVisibleCount}
        helper="Unresolved and overdue"
        tone="danger"
      />
      <StatCard
        title="Due In 24h"
        value={stats?.sla?.dueSoon ?? '-'}
        helper="Needs priority handling"
        tone="warning"
      />
    </section>
  );
}

export function WorkflowStrip({ stats }: { stats: Stats | undefined }) {
  return (
    <section className="workflow-strip">
      {statuses.map((status) => (
        <div key={status} className="workflow-step">
          <span>{label(status)}</span>
          <strong>{stats?.byStatus?.[status] ?? 0}</strong>
        </div>
      ))}
    </section>
  );
}
