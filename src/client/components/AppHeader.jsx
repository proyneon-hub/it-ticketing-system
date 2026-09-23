import { label } from '../lib/format.js';

function SessionCard({ user, loading, onRefresh, onLogout }) {
  return (
    <>
      <span className={`role-badge ${user.role}`}>{label(user.role)}</span>
      <strong>{user.name}</strong>
      <small>{user.email}</small>
      <div className="session-actions">
        <button
          className="ghost-button"
          onClick={onRefresh}
          disabled={loading}
          type="button"
          data-testid="refresh-button"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
        <button
          className="secondary-button"
          onClick={onLogout}
          type="button"
          data-testid="logout-button"
        >
          Sign out
        </button>
      </div>
    </>
  );
}

function LoginForm({ credentials, onChange, onSubmit }) {
  return (
    <form className="login-form" onSubmit={onSubmit}>
      <strong>Demo login</strong>
      <label className="sr-only" htmlFor="login-email">
        Email
      </label>
      <input
        id="login-email"
        data-testid="login-email"
        value={credentials.email}
        onChange={(event) => onChange({ ...credentials, email: event.target.value })}
        placeholder="Email"
      />
      <label className="sr-only" htmlFor="login-password">
        Password
      </label>
      <input
        id="login-password"
        data-testid="login-password"
        type="password"
        value={credentials.password}
        onChange={(event) => onChange({ ...credentials, password: event.target.value })}
        placeholder="Password"
      />
      <button className="primary-button" type="submit" data-testid="login-submit">
        Sign in
      </button>
    </form>
  );
}

export default function AppHeader({
  user,
  loading,
  credentials,
  onCredentialsChange,
  onLogin,
  onLogout,
  onRefresh,
}) {
  return (
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
          <SessionCard user={user} loading={loading} onRefresh={onRefresh} onLogout={onLogout} />
        ) : (
          <LoginForm credentials={credentials} onChange={onCredentialsChange} onSubmit={onLogin} />
        )}
      </div>
    </header>
  );
}
