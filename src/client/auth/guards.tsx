import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Role } from '../types';
import { useAuth } from './AuthContext';

// Everything under this route needs a signed-in user. While a saved session is being
// restored it says so, instead of flashing the sign-in page; if there is none it sends
// the visitor to sign in, remembering where they were headed.
export function RequireAuth() {
  const { user, restoring } = useAuth();
  const location = useLocation();

  if (restoring) {
    return (
      <section className="empty-panel" role="status">
        <h2>Restoring your session…</h2>
      </section>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

// Everything under this route needs a specific role. The API enforces the same rule; this
// keeps people from landing on a page that could only show them errors.
export function RequireRole({ role }: { role: Role }) {
  const { user } = useAuth();

  if (user?.role !== role) {
    return (
      <section className="empty-panel" role="alert">
        <h2>You do not have access to this page.</h2>
        <p>This area is only available to {role === 'admin' ? 'administrators' : `${role}s`}.</p>
      </section>
    );
  }
  return <Outlet />;
}
