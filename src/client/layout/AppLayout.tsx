import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import { label } from '../lib/format';
import { NoticeProvider, useNotices } from '../notices/NoticeContext';

function SessionCard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="session-card">
      <span className={`role-badge ${user.role}`}>{label(user.role)}</span>
      <strong>{user.name}</strong>
      <small>{user.email}</small>
      <div className="session-actions">
        <button
          className="secondary-button"
          onClick={handleLogout}
          type="button"
          data-testid="logout-button"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function MainNav() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <nav className="main-nav" aria-label="Main">
      <NavLink to="/tickets" end={false}>
        Tickets
      </NavLink>
      {user.role !== 'user' ? <NavLink to="/trends">Trends</NavLink> : null}
      {user.role === 'admin' ? (
        <>
          <NavLink to="/admin/agent">Agent</NavLink>
          <NavLink to="/admin/users">Users</NavLink>
          <NavLink to="/admin/audit">Audit log</NavLink>
        </>
      ) : null}
    </nav>
  );
}

function Frame() {
  const { error, success } = useNotices();
  // A page can hand the next page a message (for example after signing in) in the
  // navigation state, which lasts for that one page.
  const carried = (useLocation().state as { success?: string } | null)?.success ?? '';

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
        <SessionCard />
      </header>

      <MainNav />

      {error ? <Alert type="error" message={error.message} requestId={error.requestId} /> : null}
      {success || carried ? <Alert type="success" message={success || carried} /> : null}

      <Outlet />
    </main>
  );
}

// The frame around every page: title, navigation, the signed-in user, and the banner
// where the page's notices appear.
export default function AppLayout() {
  return (
    <NoticeProvider>
      <Frame />
    </NoticeProvider>
  );
}
