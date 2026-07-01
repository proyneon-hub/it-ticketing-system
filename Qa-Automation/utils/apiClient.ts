import { APIRequestContext, expect, request } from '@playwright/test';
import { users, UserRole } from '../fixtures/users';
import { testConfig } from './testConfig';

type LoginResponse = {
  token: string;
  user: {
    name: string;
    email: string;
    role: UserRole;
  };
};

type TicketResponse = {
  ticket: {
    _id: string;
    ticketNumber?: string;
    title: string;
    requesterEmail?: string;
    status: string;
    priority: string;
  };
};

export async function createApiContext(token?: string) {
  return request.newContext({
    baseURL: testConfig.baseUrl,
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export class ApiClient {
  constructor(private readonly context: APIRequestContext) {}

  static async forRole(role: UserRole) {
    const anonymous = await createApiContext();
    const loginResponse = await anonymous.post('/api/auth/login', {
      data: {
        email: users[role].email,
        password: users[role].password,
      },
    });
    expect(loginResponse.ok()).toBeTruthy();
    const body = (await loginResponse.json()) as LoginResponse;
    await anonymous.dispose();

    const context = await createApiContext(body.token);
    return {
      client: new ApiClient(context),
      context,
      token: body.token,
      user: body.user,
    };
  }

  async health() {
    return this.context.get('/api/health');
  }

  async login(email: string, password: string) {
    return this.context.post('/api/auth/login', { data: { email, password } });
  }

  async me() {
    return this.context.get('/api/auth/me');
  }

  async listTickets(query: Record<string, string | number> = {}) {
    return this.context.get('/api/tickets', { params: query });
  }

  async createTicket(data: Record<string, unknown>) {
    return this.context.post('/api/tickets', { data });
  }

  async patchTicket(id: string, data: Record<string, unknown>) {
    return this.context.patch(`/api/tickets/${id}`, { data });
  }

  async deleteTicket(id: string) {
    return this.context.delete(`/api/tickets/${id}`);
  }

  async createTicketAndReturn(data: Record<string, unknown>) {
    const response = await this.createTicket(data);
    expect(response.status()).toBe(201);
    return (await response.json()) as TicketResponse;
  }
}
