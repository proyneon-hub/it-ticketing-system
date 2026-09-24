import { Navigate, type RouteObject } from 'react-router-dom';
import { RequireAuth, RequireRole } from './auth/guards';
import AppLayout from './layout/AppLayout';
import AdminAuditPage from './pages/AdminAuditPage';
import AdminUsersPage from './pages/AdminUsersPage';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';
import TicketDetailPage from './pages/TicketDetailPage';

// Every page, and who may open it. Anything under RequireAuth needs a signed-in user;
// the admin pages also need the admin role. Kept as data so the tests can mount the
// exact same tree the app runs.
export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <Navigate to="/tickets" replace /> },
      { path: '/login', element: <LoginPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/tickets', element: <DashboardPage /> },
          { path: '/tickets/:id', element: <TicketDetailPage /> },
          {
            element: <RequireRole role="admin" />,
            children: [
              { path: '/admin/users', element: <AdminUsersPage /> },
              { path: '/admin/audit', element: <AdminAuditPage /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
