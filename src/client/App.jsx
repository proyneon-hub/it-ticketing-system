import { useEffect, useMemo, useState } from 'react';
import {
  createTicket,
  deleteTicket,
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
  const [filters, setFilters] = useState({ status: '', priority: '', sla: '', search: '' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
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
      setTickets(ticketResult.value.tickets);
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
    const nextFilters = { ...filters, [field]: value };
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
      await loadData();
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
                <button className="ghost-button" onClick={() => loadData()} disabled={loading}>
                  {loading ? 'Refreshing...' : 'Refresh'}
                </button>
                <button className="secondary-button" onClick={handleLogout}>
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <form className="login-form" onSubmit={handleLogin}>
              <strong>Demo login</strong>
              <input
                value={loginForm.email}
                onChange={(event) =>
                  setLoginForm((current) => ({ ...current, email: event.target.value }))
                }
                placeholder="Email"
              />
              <input
                type="password"
                value={loginForm.password}
                onChange={(event) =>
                  setLoginForm((current) => ({ ...current, password: event.target.value }))
                }
                placeholder="Password"
              />
              <button className="primary-button" type="submit">
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
                  value={form.title}
                  onChange={(event) => updateFormField('title', event.target.value)}
                  placeholder="Laptop cannot connect to Wi-Fi"
                  required
                />
              </label>

              <label>
                Description
                <textarea
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

              <button className="primary-button" type="submit" disabled={saving}>
                {saving ? 'Creating...' : 'Create Ticket'}
              </button>
            </form>

            <section className="panel dashboard-card">
              <div className="section-heading horizontal">
                <div>
                  <h2>Ticket Dashboard</h2>
                  <p>Filter tickets, update assignments, and watch SLA risk.</p>
                </div>
              </div>

              <div className="filters">
                <input
                  value={filters.search}
                  onChange={(event) => updateFilter('search', event.target.value)}
                  placeholder="Search tickets..."
                />
                <select
                  value={filters.status}
                  onChange={(event) => updateFilter('status', event.target.value)}
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
                >
                  <option value="">All SLA states</option>
                  <option value="breached">Breached SLA</option>
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
                          <tr key={ticket._id}>
                            <td className="ticket-cell">
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
                                onBlur={(event) => {
                                  if (event.target.value !== ticket.assignee) {
                                    handleTicketPatch(ticket._id, { assignee: event.target.value });
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
                            <td>
                              {user.role === 'admin' ? (
                                <button
                                  className="danger-button"
                                  onClick={() => handleDelete(ticket._id)}
                                >
                                  Delete
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        </>
      )}
    </main>
  );
}
