import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import { formatDate, label } from '../lib/format';
import { useNotices } from '../notices/NoticeContext';
import { useChangeRole, useUsers } from '../queries/admin';
import { roles } from '../../shared/ticket-constants';
import type { Role, UserSummary } from '../types';

// Who has which role. The API refuses to demote the last admin, and a role change ends
// that user's sessions, so it applies the next time they refresh.
export default function AdminUsersPage() {
  const { user: me } = useAuth();
  const notices = useNotices();
  const users = useUsers();
  const changeRole = useChangeRole();

  function handleChange(target: UserSummary, role: Role) {
    if (role === target.role) return;
    notices.clear();
    changeRole.mutate(
      { id: target.id, role },
      {
        onSuccess: () => notices.showSuccess(`${target.email} is now ${label(role)}.`),
        onError: (error) => notices.showError(error),
      }
    );
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Users</h2>
        <p>Change a role to change what someone can do. There must always be one admin.</p>
      </div>

      {users.isError && !(users.error as { sessionEnded?: boolean }).sessionEnded ? (
        <Alert
          type="error"
          message={users.error.message}
          requestId={(users.error as { requestId?: string }).requestId}
        />
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {users.isPending ? (
              <tr>
                <td colSpan={4} className="empty-state">
                  Loading users...
                </td>
              </tr>
            ) : (
              (users.data ?? []).map((row) => (
                <tr key={row.id} data-testid="user-row">
                  <td>
                    {row.name}
                    {row.id === me?.id ? <small> (you)</small> : null}
                  </td>
                  <td>{row.email}</td>
                  <td>
                    <select
                      className={`pill ${row.role}`}
                      value={row.role}
                      onChange={(event) => handleChange(row, event.target.value as Role)}
                      disabled={changeRole.isPending}
                      aria-label={`Role for ${row.email}`}
                    >
                      {roles.map((role) => (
                        <option key={role} value={role}>
                          {label(role)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{formatDate(row.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
