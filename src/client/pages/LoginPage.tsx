import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import DemoAccounts from '../components/DemoAccounts';
import { defaultCredentials } from '../constants';
import { useNotices } from '../notices/NoticeContext';
import type { Credentials } from '../types';

interface FromState {
  from?: { pathname: string; search?: string };
}

export default function LoginPage() {
  const { user, demoUsers, login, sessionExpired } = useAuth();
  const { showError, clear } = useNotices();
  const navigate = useNavigate();
  const location = useLocation();
  const [credentials, setCredentials] = useState<Credentials>(defaultCredentials);
  // While this page is handling a sign-in itself it does the navigating (and carries the
  // "Signed in" message with it), so the redirect for someone already signed in must wait.
  const [submitting, setSubmitting] = useState(false);

  // Signed in already: go where the visitor was headed, else the queue.
  const from = (location.state as FromState | null)?.from;
  if (user) {
    // Mid sign-in this page navigates itself, so show nothing rather than a form beside the session.
    if (submitting) return null;
    return <Navigate to={from ? `${from.pathname}${from.search ?? ''}` : '/tickets'} replace />;
  }

  async function signIn(next: Credentials) {
    clear();
    setSubmitting(true);
    try {
      const signedInUser = await login(next);
      navigate(from ? `${from.pathname}${from.search ?? ''}` : '/tickets', {
        replace: true,
        state: { success: `Signed in as ${signedInUser.name}.` },
      });
    } catch (error) {
      setSubmitting(false);
      showError(error);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void signIn(credentials);
  }

  return (
    <>
      <section className="session-card login-card">
        <form className="login-form" onSubmit={handleSubmit}>
          <strong>Demo login</strong>
          <label className="sr-only" htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            data-testid="login-email"
            value={credentials.email}
            onChange={(event) => setCredentials({ ...credentials, email: event.target.value })}
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
            onChange={(event) => setCredentials({ ...credentials, password: event.target.value })}
            placeholder="Password"
          />
          <button className="primary-button" type="submit" data-testid="login-submit">
            Sign in
          </button>
        </form>
      </section>

      <DemoAccounts demoUsers={demoUsers} onSelect={(next) => void signIn(next)} />

      {sessionExpired ? (
        <Alert type="error" message="Your session expired. Sign in again." />
      ) : null}

      <section className="empty-panel">
        <h2>Sign in to open the service desk.</h2>
        <p>
          Use any demo account above to inspect role-based permissions without creating external
          users.
        </p>
      </section>
    </>
  );
}
