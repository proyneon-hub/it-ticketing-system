import { useCallback, useMemo } from 'react';
import Alert from './components/Alert.jsx';
import AppHeader from './components/AppHeader.jsx';
import DemoAccounts from './components/DemoAccounts.jsx';
import { StatsGrid, WorkflowStrip } from './components/StatsGrid.jsx';
import TicketDashboard from './components/TicketDashboard.jsx';
import TicketForm from './components/TicketForm.jsx';
import { terminalStatuses } from './constants.js';
import { useAuth } from './hooks/useAuth.js';
import { useNotices } from './hooks/useNotices.js';
import { useTickets } from './hooks/useTickets.js';
import { getSlaState } from './lib/format.js';

export default function App() {
  const notices = useNotices();
  const { error, success, showError, showSuccess, clear } = notices;

  const handleSessionExpired = useCallback(() => {
    showError(new Error('Your session expired. Sign in again.'));
  }, [showError]);

  const auth = useAuth({ onError: showError, onSessionExpired: handleSessionExpired });
  const { user } = auth;

  const tickets = useTickets({ user, onError: showError, onSuccess: showSuccess });

  const activeCount = useMemo(
    () => tickets.tickets.filter((ticket) => !terminalStatuses.includes(ticket.status)).length,
    [tickets.tickets]
  );
  const breachedVisibleCount = useMemo(
    () => tickets.tickets.filter((ticket) => getSlaState(ticket) === 'breached').length,
    [tickets.tickets]
  );

  async function signIn(credentials) {
    clear();
    const signedInUser = await auth.login(credentials);
    if (signedInUser) showSuccess(`Signed in as ${signedInUser.name}.`);
  }

  function handleLogout() {
    auth.logout();
    showSuccess('');
  }

  return (
    <main className="shell">
      <AppHeader
        user={user}
        loading={tickets.loading}
        credentials={auth.credentials}
        onCredentialsChange={auth.setCredentials}
        onLogin={(event) => {
          event.preventDefault();
          signIn(auth.credentials);
        }}
        onLogout={handleLogout}
        onRefresh={tickets.refresh}
      />

      <DemoAccounts demoUsers={auth.demoUsers} onSelect={signIn} />

      {error ? <Alert type="error" message={error.message} requestId={error.requestId} /> : null}
      {success ? <Alert type="success" message={success} /> : null}

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
          <StatsGrid
            stats={tickets.stats}
            activeCount={activeCount}
            breachedVisibleCount={breachedVisibleCount}
          />
          <WorkflowStrip stats={tickets.stats} />

          <section className="layout-grid">
            <TicketForm role={user.role} saving={tickets.saving} onCreate={tickets.create} />
            <TicketDashboard
              role={user.role}
              tickets={tickets.tickets}
              filters={tickets.filters}
              pagination={tickets.pagination}
              loading={tickets.loading}
              exporting={tickets.exporting}
              onFilterChange={tickets.updateFilter}
              onPage={tickets.updatePage}
              onPatch={tickets.patch}
              onDelete={tickets.remove}
              onExport={tickets.exportCsv}
            />
          </section>
        </>
      )}
    </main>
  );
}
