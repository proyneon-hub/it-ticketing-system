import { render } from '@testing-library/react';
import { createMemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import * as api from '../api';
import App from '../App';
import { routes } from '../routes';
import { demoUsers, emptyStats, makeTicket, makeTrends, ticketPage, users } from './fixtures';

// Sensible answers for every call, so a test overrides only what it is about. Call it
// from beforeEach (after vi.clearAllMocks()).
export function installDefaultApi() {
  vi.mocked(api.sessionMayExist).mockReturnValue(false);
  vi.mocked(api.logout).mockResolvedValue(null);
  vi.mocked(api.fetchComments).mockResolvedValue({ comments: [] });
  vi.mocked(api.fetchTrends).mockResolvedValue(makeTrends());
  vi.mocked(api.fetchDemoUsers).mockResolvedValue({ users: demoUsers });
  vi.mocked(api.fetchTickets).mockResolvedValue(ticketPage([makeTicket()]));
  vi.mocked(api.fetchStats).mockResolvedValue({ ...emptyStats, total: 1, byStatus: { open: 1 } });
  vi.mocked(api.login).mockImplementation(async ({ email }) => {
    const user = Object.values(users).find((candidate) => candidate.email === email);
    if (!user) {
      throw Object.assign(new Error('Invalid demo credentials.'), { requestId: 'req-9' });
    }
    return { token: `token-${user.role}`, user };
  });
}

// The whole app, mounted at `route`, exactly as the browser would run it.
export function renderApp(route = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [route] });
  return { router, ...render(<App router={router} />) };
}

// The app mounted at `route` with a session already in place, as after a page reload: the
// refresh cookie is traded for the given role's user before anything renders.
export function renderSignedInAs(role: keyof typeof users, route = '/tickets') {
  vi.mocked(api.sessionMayExist).mockReturnValue(true);
  vi.mocked(api.refreshSession).mockResolvedValue({ token: `token-${role}`, user: users[role] });
  return renderApp(route);
}
