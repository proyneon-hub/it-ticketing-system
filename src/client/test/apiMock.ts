import { vi } from 'vitest';

// A stand-in for src/client/api.ts. Tests mount the real components, so this replaces only
// the network:  vi.mock('../api', async () => (await import('../test/apiMock')).apiMockFactory())
export function apiMockFactory() {
  return {
    ApiError: class ApiError extends Error {},
    addComment: vi.fn(),
    changeUserRole: vi.fn(),
    createTicket: vi.fn(),
    deleteTicket: vi.fn(),
    exportTickets: vi.fn(),
    fetchAudit: vi.fn(),
    fetchComments: vi.fn(),
    fetchDemoUsers: vi.fn(),
    fetchMe: vi.fn(),
    fetchStats: vi.fn(),
    fetchTicket: vi.fn(),
    fetchTickets: vi.fn(),
    fetchTrends: vi.fn(),
    fetchUsers: vi.fn(),
    hasAuthToken: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    onUnauthorized: vi.fn(),
    refreshSession: vi.fn(),
    sessionMayExist: vi.fn(),
    setAuthToken: vi.fn(),
    setSessionHint: vi.fn(),
    updateTicket: vi.fn(),
  };
}
