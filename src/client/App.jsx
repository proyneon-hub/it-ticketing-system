import { useEffect, useMemo, useState } from 'react';
import { createTicket, deleteTicket, fetchStats, fetchTickets, updateTicket } from './api.js';

// These lists mirror the backend enum values. Keeping them centralized makes the
// form controls, filters, and inline table editors consistent.
const statuses = ['open', 'in-progress', 'resolved', 'closed'];
const priorities = ['low', 'medium', 'high', 'urgent'];

// Initial state for the create-ticket form. Resetting to this object clears the
// form after a successful submission.
const emptyForm = {
  title: '',
  description: '',
  requesterName: '',
  requesterEmail: '',
  priority: 'medium',
  assignee: ''
};

function label(value) {
  // Converts API values like "in-progress" into display labels like "In Progress".
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDate(value) {
  // Missing dates are shown as a placeholder instead of rendering "Invalid Date".
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function StatCard({ title, value, helper }) {
  // Small reusable component for the dashboard summary metrics.
  return (
    <section className="card stat-card">
      <p>{title}</p>
      <strong>{value}</strong>
      {helper ? <span>{helper}</span> : null}
    </section>
  );
}

export default function App() {
  // Main API-backed data.
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState(null);

  // Local UI state for form inputs, filters, and request feedback.
  const [form, setForm] = useState(emptyForm);
  const [filters, setFilters] = useState({ status: '', priority: '', search: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadData(activeFilters = filters) {
    // Refresh tickets and stats together. The optional activeFilters parameter
    // lets filter changes fetch with the new values immediately.
    setLoading(true);
    setError('');

    // allSettled allows one request to fail while still using the other result.
    const [ticketResult, statResult] = await Promise.allSettled([
      fetchTickets(activeFilters),
      fetchStats()
    ]);

    if (ticketResult.status === 'fulfilled') {
      setTickets(ticketResult.value.tickets);
    } else {
      setTickets([]);
    }

    if (statResult.status === 'fulfilled') {
      setStats(statResult.value);
    } else {
      setStats(null);
    }

    // Show the first API error to the user while keeping the page mounted.
    const failedResult = [ticketResult, statResult].find((result) => result.status === 'rejected');
    if (failedResult) {
      setError(failedResult.reason.message);
    }

    setLoading(false);
  }

  useEffect(() => {
    // Load the dashboard once when the component first mounts.
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derived value for the "Active Tickets" stat card. Memoizing avoids
  // recalculating unless the tickets array changes.
  const activeCount = useMemo(
    () => tickets.filter((ticket) => !['resolved', 'closed'].includes(ticket.status)).length,
    [tickets]
  );

  function updateFormField(field, value) {
    // Merge one changed form field into the current form state.
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateFilter(field, value) {
    // Build the next filter object before calling loadData so the API request
    // uses the latest value instead of waiting for React state to settle.
    const nextFilters = { ...filters, [field]: value };
    setFilters(nextFilters);
    loadData(nextFilters);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    // Disable the submit button and clear old messages while creating the ticket.
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await createTicket(form);
      setForm(emptyForm);
      setSuccess('Ticket created successfully.');
      // Reload both table data and stats so the dashboard reflects the new ticket.
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTicketPatch(id, patch) {
    // Used by inline table editors. The patch contains only the field that
    // changed, such as { priority: "urgent" }.
    setError('');
    setSuccess('');

    try {
      await updateTicket(id, patch);
      setSuccess('Ticket updated.');
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    // Ask for confirmation because deleting a ticket is permanent in this app.
    const confirmed = window.confirm('Delete this ticket? This cannot be undone.');
    if (!confirmed) return;

    setError('');
    setSuccess('');

    try {
      await deleteTicket(id);
      setSuccess('Ticket deleted.');
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="shell">
      {/* Header area with a manual refresh button for reloading API data. */}
      <header className="hero">
        <div>
          <span className="eyebrow">Full Stack Portfolio Project</span>
          <h1>IT Ticketing System</h1>
          <p>
            Create, prioritize, assign, track, and resolve IT support tickets from one simple dashboard.
          </p>
        </div>
        <button className="ghost-button" onClick={() => loadData()} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      {/* Summary metrics combine server-provided stats with client-derived counts. */}
      <section className="stats-grid">
        <StatCard title="Total Tickets" value={stats?.total ?? '—'} helper="All time" />
        <StatCard title="Active Tickets" value={activeCount} helper="Open or in progress" />
        <StatCard title="High / Urgent" value={(stats?.byPriority?.high ?? 0) + (stats?.byPriority?.urgent ?? 0)} helper="Needs attention" />
        <StatCard title="Resolved" value={stats?.byStatus?.resolved ?? 0} helper="Completed" />
      </section>

      {error ? <div className="alert error">{error}</div> : null}
      {success ? <div className="alert success">{success}</div> : null}

      <section className="layout-grid">
        {/* Controlled form for creating a new ticket. */}
        <form className="card ticket-form" onSubmit={handleSubmit}>
          <div className="section-heading">
            <h2>Create Ticket</h2>
            <p>Add a new support request.</p>
          </div>

          <label>
            Title <span>*</span>
            <input
              value={form.title}
              onChange={(event) => updateFormField('title', event.target.value)}
              placeholder="Example: Laptop cannot connect to Wi-Fi"
              required
            />
          </label>

          <label>
            Description
            <textarea
              value={form.description}
              onChange={(event) => updateFormField('description', event.target.value)}
              placeholder="Describe the issue, affected device, and what has been tried."
              rows="4"
            />
          </label>

          <div className="two-column">
            <label>
              Requester Name
              <input
                value={form.requesterName}
                onChange={(event) => updateFormField('requesterName', event.target.value)}
                placeholder="Name"
              />
            </label>

            <label>
              Requester Email
              <input
                type="email"
                value={form.requesterEmail}
                onChange={(event) => updateFormField('requesterEmail', event.target.value)}
                placeholder="name@example.com"
              />
            </label>
          </div>

          <div className="two-column">
            <label>
              Priority
              <select value={form.priority} onChange={(event) => updateFormField('priority', event.target.value)}>
                {priorities.map((priority) => (
                  <option value={priority} key={priority}>{label(priority)}</option>
                ))}
              </select>
            </label>

            <label>
              Assignee
              <input
                value={form.assignee}
                onChange={(event) => updateFormField('assignee', event.target.value)}
                placeholder="Technician name"
              />
            </label>
          </div>

          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? 'Creating...' : 'Create Ticket'}
          </button>
        </form>

        {/* Ticket list and inline editors. This section is backed by /api/tickets. */}
        <section className="card dashboard-card">
          <div className="section-heading horizontal">
            <div>
              <h2>Ticket Dashboard</h2>
              <p>Filter tickets and update status, priority, or assignee.</p>
            </div>
          </div>

          {/* Changing any filter immediately reloads the tickets from the API. */}
          <div className="filters">
            <input
              value={filters.search}
              onChange={(event) => updateFilter('search', event.target.value)}
              placeholder="Search tickets..."
            />
            <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
              <option value="">All statuses</option>
              {statuses.map((status) => (
                <option value={status} key={status}>{label(status)}</option>
              ))}
            </select>
            <select value={filters.priority} onChange={(event) => updateFilter('priority', event.target.value)}>
              <option value="">All priorities</option>
              {priorities.map((priority) => (
                <option value={priority} key={priority}>{label(priority)}</option>
              ))}
            </select>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Assignee</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="6" className="empty-state">Loading tickets...</td></tr>
                ) : tickets.length === 0 ? (
                  <tr><td colSpan="6" className="empty-state">No tickets found.</td></tr>
                ) : (
                  tickets.map((ticket) => (
                    <tr key={ticket._id}>
                      <td className="ticket-cell">
                        <strong>{ticket.title}</strong>
                        <p>{ticket.description || 'No description provided.'}</p>
                        <small>{ticket.requesterName || 'Unknown requester'} {ticket.requesterEmail ? `• ${ticket.requesterEmail}` : ''}</small>
                      </td>
                      <td>
                        {/* Status updates are saved immediately through PATCH /api/tickets/:id. */}
                        <select
                          className={`pill ${ticket.status}`}
                          value={ticket.status}
                          onChange={(event) => handleTicketPatch(ticket._id, { status: event.target.value })}
                        >
                          {statuses.map((status) => (
                            <option value={status} key={status}>{label(status)}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {/* Priority uses the same inline update flow as status. */}
                        <select
                          className={`pill ${ticket.priority}`}
                          value={ticket.priority}
                          onChange={(event) => handleTicketPatch(ticket._id, { priority: event.target.value })}
                        >
                          {priorities.map((priority) => (
                            <option value={priority} key={priority}>{label(priority)}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="assignee-input"
                          defaultValue={ticket.assignee}
                          onBlur={(event) => {
                            // Save assignee edits on blur, but skip the API call
                            // when the value did not actually change.
                            if (event.target.value !== ticket.assignee) {
                              handleTicketPatch(ticket._id, { assignee: event.target.value });
                            }
                          }}
                        />
                      </td>
                      <td>{formatDate(ticket.createdAt)}</td>
                      <td>
                        <button className="danger-button" onClick={() => handleDelete(ticket._id)}>Delete</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}
