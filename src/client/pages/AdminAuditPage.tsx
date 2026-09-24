import { useSearchParams } from 'react-router-dom';
import { auditTypes } from '../../shared/ticket-constants';
import Alert from '../components/Alert';
import Pagination from '../components/Pagination';
import { formatDate, label } from '../lib/format';
import { useAuditLog } from '../queries/admin';
import type { AuditQuery, AuditType } from '../types';

const PAGE_SIZE = 25;

function readQuery(params: URLSearchParams): AuditQuery {
  const type = auditTypes.find((candidate) => candidate === params.get('type'));
  const page = Number(params.get('page'));
  return {
    type: type ?? '',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    limit: PAGE_SIZE,
  };
}

// The security audit log, newest first: sign-ins, role changes, deletions, denials.
export default function AdminAuditPage() {
  const [params, setParams] = useSearchParams();
  const query = readQuery(params);
  const audit = useAuditLog(query);

  function update(next: { type?: AuditType | ''; page?: number }) {
    const merged = { ...query, ...next };
    const out = new URLSearchParams();
    if (merged.type) out.set('type', merged.type);
    if (merged.page > 1) out.set('page', String(merged.page));
    setParams(out, { replace: true });
  }

  const events = audit.data?.events ?? [];

  return (
    <section className="panel">
      <div className="section-heading horizontal">
        <div>
          <h2>Audit log</h2>
          <p>Security events, newest first. Read-only.</p>
        </div>
        <select
          value={query.type}
          onChange={(event) => update({ type: event.target.value as AuditType | '', page: 1 })}
          aria-label="Filter by event type"
        >
          <option value="">All events</option>
          {auditTypes.map((type) => (
            <option key={type} value={type}>
              {label(type)}
            </option>
          ))}
        </select>
      </div>

      {audit.isError && !(audit.error as { sessionEnded?: boolean }).sessionEnded ? (
        <Alert
          type="error"
          message={audit.error.message}
          requestId={(audit.error as { requestId?: string }).requestId}
        />
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Event</th>
              <th>Outcome</th>
              <th>Who</th>
              <th>About</th>
              <th>Details</th>
              <th>From</th>
            </tr>
          </thead>
          <tbody>
            {audit.isPending ? (
              <tr>
                <td colSpan={7} className="empty-state">
                  Loading events...
                </td>
              </tr>
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-state">
                  No events recorded.
                </td>
              </tr>
            ) : (
              events.map((event) => (
                <tr key={event._id} data-testid="audit-row">
                  <td>{formatDate(event.at)}</td>
                  <td>{label(event.type)}</td>
                  <td>
                    <span className={`outcome ${event.outcome}`}>{label(event.outcome)}</span>
                  </td>
                  <td>{event.actor?.email ?? '-'}</td>
                  <td>{event.target?.label ?? event.target?.type ?? '-'}</td>
                  <td>{event.detail ?? '-'}</td>
                  <td>{event.ip ?? '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {audit.data ? (
        <Pagination
          pagination={audit.data.pagination}
          loading={audit.isFetching}
          onPage={(page) => update({ page })}
          noun="events"
        />
      ) : null}
    </section>
  );
}
