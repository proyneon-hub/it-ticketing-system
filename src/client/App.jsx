import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  createTicket,
  deleteTicket,
  exportTickets,
  fetchDemoUsers,
  fetchMe,
  fetchStats,
  fetchTickets,
  login,
  setAuthToken,
  updateTicket,
} from './api.js';

const statuses = ['open', 'assigned', 'in-progress', 'resolved', 'closed'];
const priorities = ['low', 'medium', 'high', 'urgent'];
const sortFields = [
  ['createdAt', 'Newest first'],
  ['ticketNumber', 'Ticket ID'],
  ['priority', 'Priority'],
  ['status', 'Status'],
  ['dueAt', 'SLA due date'],
];

const emptyForm = {
  title: '',
  description: '',
  requesterName: '',
  requesterEmail: '',
  priority: 'medium',
  category: 'General Support',
  assignee: '',
};

function label(value) {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getSlaState(ticket) {
  if (!ticket.dueAt || ['resolved', 'closed'].includes(ticket.status)) return 'met';
  const dueAt = new Date(ticket.dueAt).getTime();
  const now = Date.now();
  if (dueAt < now) return 'breached';
  if (dueAt - now <= 24 * 60 * 60 * 1000) return 'due-soon';
  return 'healthy';
}

function activityLabel(activity) {
  const labels = {
    ticket_created: 'Ticket created',
    ticket_updated: 'Ticket updated',
    status_changed: 'Status changed',
    priority_changed: 'Priority changed',
    assignee_changed: 'Assignee changed',
    ticket_resolved: 'Ticket resolved',
    ticket_closed: 'Ticket closed',
  };
  return labels[activity.action] || label(activity.action || 'activity');
}

function StatCard({ title, value, helper, tone = 'neutral' }) {
  return (
    <section className={`stat-card ${tone}`}>
      <p>{title}</p>
      <strong>{value}</strong>
      {helper ? <span>{helper}</span> : null}
    </section>
  );
}

export default function App() {
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState(null);
  const [user, setUser] = useState(null);
  const [demoUsers, setDemoUsers] = useState([]);
  const [loginForm, setLoginForm] = useState({
    email: 'admin@demo.local',
    password: 'AdminPass123!',
  });
  const [form, setForm] = useState(emptyForm);
  const [filters, setFilters] = useState({
    status: '',
    priority: '',
    sla: '',
    search: '',
    sortBy: 'createdAt',
    sortOrder: 'desc',
    page: 1,
    limit: 10,
  });
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [expandedTicketId, setExpandedTicketId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadData(activeFilters = filters) {
    if (!user) return;

    setLoading(true);
    setError('');

    const [ticketResult, statResult] = await Promise.allSettled([
      fetchTickets(activeFilters),
      fetchStats(),
    ]);

    if (ticketResult.status === 'fulfilled') {
      setTickets(ticketResult.value.data || ticketResult.value.tickets || []);
      setPagination(
        ticketResult.value.pagination || {
          page: 1,
          limit: activeFilters.limit,
          total: 0,
          totalPages: 1,
        }
      );
    } else {
      setTickets([]);
    }

    if (statResult.status === 'fulfilled') {
      setStats(statResult.value);
    } else {
      setStats(null);
    }

    const failedResult = [ticketResult, statResult].find((result) => result.status === 'rejected');
    if (failedResult) setError(failedResult.reason.message);

    setLoading(false);
  }

  useEffect(() => {
    fetchDemoUsers()
      .then((data) => setDemoUsers(data.users))
      .catch(() => setDemoUsers([]));
    fetchMe()
      .then((data) => setUser(data.user))
      .catch(() => setAuthToken(''));
  }, []);

  useEffect(() => {
    if (user) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const activeCount = useMemo(
    () => tickets.filter((ticket) => !['resolved', 'closed'].includes(ticket.status)).length,
    [tickets]
  );

  const breachedVisibleCount = useMemo(
    () => tickets.filter((ticket) => getSlaState(ticket) === 'breached').length,
    [tickets]
  );

  async function handleLogin(event, credentials = loginForm) {
    event?.preventDefault();
    setError('');
    setSuccess('');

    try {
      const data = await login(credentials);
      setAuthToken(data.token);
      setUser(data.user);
      setLoginForm({ email: credentials.email, password: credentials.password });
      setSuccess(`Signed in as ${data.user.name}.`);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleLogout() {
    setAuthToken('');
    setUser(null);
    setTickets([]);
    setStats(null);
    setSuccess('');
  }

  function updateFormField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateFilter(field, value) {
    const nextFilters = { ...filters, [field]: value, page: 1 };
    setFilters(nextFilters);
    loadData(nextFilters);
  }

  function updatePage(nextPage) {
    const page = Math.min(Math.max(nextPage, 1), pagination.totalPages || 1);
    const nextFilters = { ...filters, page };
    setFilters(nextFilters);
    loadData(nextFilters);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await createTicket(form);
      setForm(emptyForm);
      setSuccess('Ticket created successfully.');
      const nextFilters = { ...filters, page: 1 };
      setFilters(nextFilters);
      await loadData(nextFilters);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTicketPatch(id, patch) {
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

  async function handleExport() {
    setExporting(true);
    setError('');
    setSuccess('');

    try {
      const blob = await exportTickets(filters);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'tickets.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setSuccess('Ticket export downloaded.');
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <main className="shell">
      <header className="app-header">
        <div>
          <span className="eyebrow">Production-style service desk</span>
          <h1>IT Ticketing System</h1>
          <p>
            Role-based support queue with SLA tracking, workflow ownership, and a seeded demo
            environment.
          </p>
        </div>
        <div className="session-card">
          {user ? (
            <>
              <span className={`role-badge ${user.role}`}>{label(user.role)}</span>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
              <div className="session-actions">
                <button
                  className="ghost-button"
                  onClick={() => loadData()}
                  disabled={loading}
                  type="button"
                  data-testid="refresh-button"
                >
                  {loading ? 'Refreshing...' : 'Refresh'}
                </button>
                <button
                  className="secondary-button"
                  onClick={handleLogout}
                  type="button"
                  data-testid="logout-button"
                >
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <form className="login-form" onSubmit={handleLogin}>
              <strong>Demo login</strong>
              <label className="sr-only" htmlFor="login-email">
                Email
              </label>
              <input
                id="login-email"
                data-testid="login-email"
                value={loginForm.email}
                onChange={(event) =>
                  setLoginForm((current) => ({ ...current, email: event.target.value }))
                }
                placeholder="Email"
              />
              <label className="sr-only" htmlFor="login-password">
                Password
              </label>
              <input
                id="login-password"
                data-testid="login-password"
                type="password"
                value={loginForm.password}
                onChange={(event) =>
                  setLoginForm((current) => ({ ...current, password: event.target.value }))
                }
                placeholder="Password"
              />
              <button className="primary-button" type="submit" data-testid="login-submit">
                Sign in
              </button>
            </form>
          )}
        </div>
      </header>

      {demoUsers.length > 0 ? (
        <section className="demo-strip">
          {demoUsers.map((demoUser) => (
            <button
              key={demoUser.email}
              type="button"
              className="demo-account"
              data-testid={`demo-login-${demoUser.role}`}
              onClick={() =>
                handleLogin(null, { email: demoUser.email, password: demoUser.demoPassword })
              }
            >
              <span>{label(demoUser.role)}</span>
              <strong>{demoUser.email}</strong>
              <small>{demoUser.demoPassword}</small>
            </button>
          ))}
        </section>
      ) : null}

      {error ? <div className="alert error">{error}</div> : null}
      {success ? <div className="alert success">{success}</div> : null}

      {!user ? (
        <section className="empty-panel">
          <h2>Sign in to open the service desk.</h2>
          <p>
            Use any demo account above to inspect role-based permissions without creating external
            users.
          </p>
        </section>
      ) : (
        <>
          <section className="stats-grid">
            <StatCard
              title="Total Tickets"
              value={stats?.total ?? '-'}
              helper="Scoped to current role"
            />
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

          <section className="workflow-strip">
            {statuses.map((status) => (
              <div key={status} className="workflow-step">
                <span>{label(status)}</span>
                <strong>{stats?.byStatus?.[status] ?? 0}</strong>
              </div>
            ))}
          </section>

          <section className="layout-grid">
            <form className="panel ticket-form" onSubmit={handleSubmit}>
              <div className="section-heading">
                <h2>Create Ticket</h2>
                <p>Requests entered by users are automatically scoped to their account.</p>
              </div>

              <label>
                Title <span>*</span>
                <input
                  data-testid="ticket-title"
                  value={form.title}
                  onChange={(event) => updateFormField('title', event.target.value)}
                  placeholder="Laptop cannot connect to Wi-Fi"
                  required
                />
              </label>

              <label>
                Description
                <textarea
                  data-testid="ticket-description"
                  value={form.description}
                  onChange={(event) => updateFormField('description', event.target.value)}
                  placeholder="Describe the issue, device, business impact, and troubleshooting tried."
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
                    disabled={user.role === 'user'}
                  />
                </label>

                <label>
                  Requester Email
                  <input
                    type="email"
                    value={form.requesterEmail}
                    onChange={(event) => updateFormField('requesterEmail', event.target.value)}
                    placeholder="name@example.com"
                    disabled={user.role === 'user'}
                  />
                </label>
              </div>

              <div className="two-column">
                <label>
                  Priority
                  <select
                    data-testid="ticket-priority"
                    value={form.priority}
                    onChange={(event) => updateFormField('priority', event.target.value)}
                  >
                    {priorities.map((priority) => (
                      <option value={priority} key={priority}>
                        {label(priority)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Category
                  <input
                    value={form.category}
                    onChange={(event) => updateFormField('category', event.target.value)}
                    placeholder="Hardware, Access, Network"
                  />
                </label>
              </div>

              <label>
                Assignee
                <input
                  value={form.assignee}
                  onChange={(event) => updateFormField('assignee', event.target.value)}
                  placeholder="Technician or team"
                  disabled={user.role === 'user'}
                />
              </label>

              <button
                className="primary-button"
                type="submit"
                disabled={saving}
                data-testid="ticket-create-submit"
              >
                {saving ? 'Creating...' : 'Create Ticket'}
              </button>
            </form>

            <section className="panel dashboard-card">
              <div className="section-heading horizontal">
                <div>
                  <h2>Ticket Dashboard</h2>
                  <p>Filter tickets, update assignments, and watch SLA risk.</p>
                </div>
                <button
                  className="secondary-button compact-button"
                  type="button"
                  onClick={handleExport}
                  disabled={exporting || loading}
                  data-testid="ticket-export-button"
                >
                  {exporting ? 'Exporting...' : 'Export CSV'}
                </button>
              </div>

              <div className="filters">
                <input
                  value={filters.search}
                  onChange={(event) => updateFilter('search', event.target.value)}
                  placeholder="Search tickets or TKT ID..."
                  aria-label="Search tickets"
                  data-testid="ticket-search"
                />
                <select
                  value={filters.status}
                  onChange={(event) => updateFilter('status', event.target.value)}
                  aria-label="Filter by status"
                  data-testid="ticket-status-filter"
                >
                  <option value="">All statuses</option>
                  {statuses.map((status) => (
                    <option value={status} key={status}>
                      {label(status)}
                    </option>
                  ))}
                </select>
                <select
                  value={filters.priority}
                  onChange={(event) => updateFilter('priority', event.target.value)}
                  aria-label="Filter by priority"
                >
                  <option value="">All priorities</option>
                  {priorities.map((priority) => (
                    <option value={priority} key={priority}>
                      {label(priority)}
                    </option>
                  ))}
                </select>
                <select
                  value={filters.sla}
                  onChange={(event) => updateFilter('sla', event.target.value)}
                  aria-label="Filter by SLA state"
                >
                  <option value="">All SLA states</option>
                  <option value="breached">Breached SLA</option>
                  <option value="due-soon">Due in 24h</option>
                </select>
                <select
                  value={filters.sortBy}
                  onChange={(event) => updateFilter('sortBy', event.target.value)}
                  aria-label="Sort tickets by"
                >
                  {sortFields.map(([value, name]) => (
                    <option value={value} key={value}>
                      {name}
                    </option>
                  ))}
                </select>
                <select
                  value={filters.sortOrder}
                  onChange={(event) => updateFilter('sortOrder', event.target.value)}
                  aria-label="Sort direction"
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
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
                      <th>SLA</th>
                      <th>Created</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan="7" className="empty-state">
                          Loading tickets...
                        </td>
                      </tr>
                    ) : tickets.length === 0 ? (
                      <tr>
                        <td colSpan="7" className="empty-state">
                          No tickets found.
                        </td>
                      </tr>
                    ) : (
                      tickets.map((ticket) => {
                        const slaState = getSlaState(ticket);

                        return (
                          <Fragment key={ticket._id}>
                            <tr data-testid="ticket-row">
                              <td className="ticket-cell">
                                <span className="ticket-number">
                                  {ticket.ticketNumber || 'Pending ID'}
                                </span>
                                <strong>{ticket.title}</strong>
                                <p>{ticket.description || 'No description provided.'}</p>
                                <small>
                                  {ticket.category || 'General Support'} |{' '}
                                  {ticket.requesterName || 'Unknown requester'}{' '}
                                  {ticket.requesterEmail ? `(${ticket.requesterEmail})` : ''}
                                </small>
                              </td>
                              <td>
                                <select
                                  className={`pill ${ticket.status}`}
                                  value={ticket.status}
                                  onChange={(event) =>
                                    handleTicketPatch(ticket._id, { status: event.target.value })
                                  }
                                  disabled={user.role === 'user'}
                                  aria-label={`Status for ${ticket.ticketNumber || ticket.title}`}
                                  data-testid="ticket-status-select"
                                >
                                  {statuses.map((status) => (
                                    <option value={status} key={status}>
                                      {label(status)}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <select
                                  className={`pill ${ticket.priority}`}
                                  value={ticket.priority}
                                  onChange={(event) =>
                                    handleTicketPatch(ticket._id, { priority: event.target.value })
                                  }
                                  aria-label={`Priority for ${ticket.ticketNumber || ticket.title}`}
                                >
                                  {priorities.map((priority) => (
                                    <option value={priority} key={priority}>
                                      {label(priority)}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <input
                                  className="assignee-input"
                                  defaultValue={ticket.assignee}
                                  aria-label={`Assignee for ${ticket.ticketNumber || ticket.title}`}
                                  onBlur={(event) => {
                                    if (event.target.value !== ticket.assignee) {
                                      handleTicketPatch(ticket._id, {
                                        assignee: event.target.value,
                                      });
                                    }
                                  }}
                                  disabled={user.role === 'user'}
                                />
                              </td>
                              <td>
                                <span className={`sla-chip ${slaState}`}>{label(slaState)}</span>
                                <small className="stacked-date">{formatDate(ticket.dueAt)}</small>
                              </td>
                              <td>{formatDate(ticket.createdAt)}</td>
                              <td className="row-actions">
                                <button
                                  className="secondary-button compact-button"
                                  type="button"
                                  onClick={() =>
                                    setExpandedTicketId((current) =>
                                      current === ticket._id ? '' : ticket._id
                                    )
                                  }
                                  data-testid="ticket-activity-toggle"
                                >
                                  Activity
                                </button>
                                {user.role === 'admin' ? (
                                  <button
                                    className="danger-button compact-button"
                                    type="button"
                                    onClick={() => handleDelete(ticket._id)}
                                    data-testid="ticket-delete-button"
                                  >
                                    Delete
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                            {expandedTicketId === ticket._id ? (
                              <tr className="activity-row" data-testid="ticket-activity-row">
                                <td colSpan="7">
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
                                            {activity.detail ? (
                                              <span>{activity.detail}</span>
                                            ) : null}
                                            <small>
                                              {activity.actorName || 'System'} ·{' '}
                                              {formatDate(activity.createdAt)}
                                            </small>
                                          </li>
                                        ))}
                                      </ol>
                                    ) : (
                                      <p>No activity has been recorded for this ticket.</p>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="pagination-bar" data-testid="ticket-pagination">
                <span>
                  Page {pagination.page} of {pagination.totalPages} · {pagination.total} tickets
                </span>
                <div>
                  <button
                    className="secondary-button compact-button"
                    type="button"
                    onClick={() => updatePage(pagination.page - 1)}
                    disabled={loading || pagination.page <= 1}
                  >
                    Previous
                  </button>
                  <button
                    className="secondary-button compact-button"
                    type="button"
                    onClick={() => updatePage(pagination.page + 1)}
                    disabled={loading || pagination.page >= pagination.totalPages}
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>
          </section>
        </>
      )}
    </main>
  );
}
