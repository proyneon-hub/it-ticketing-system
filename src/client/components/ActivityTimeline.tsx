import { activityLabel, formatDate } from '../lib/format';
import type { Ticket } from '../types';

export default function ActivityTimeline({ ticket }: { ticket: Ticket }) {
  return (
    <div className="activity-panel">
      <h3>Ticket Activity Timeline</h3>
      {ticket.activity?.length ? (
        <ol>
          {ticket.activity.map((activity, index) => (
            <li key={`${ticket._id}-activity-${index}`}>
              <strong>{activityLabel(activity)}</strong>
              {activity.from || activity.to ? (
                <span>
                  {activity.from || '-'} to {activity.to || '-'}
                </span>
              ) : null}
              {activity.detail ? <span>{activity.detail}</span> : null}
              <small>
                {activity.actorName || 'System'} · {formatDate(activity.createdAt)}
              </small>
            </li>
          ))}
        </ol>
      ) : (
        <p>No activity has been recorded for this ticket.</p>
      )}
    </div>
  );
}
