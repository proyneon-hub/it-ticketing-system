import { expect, test } from '@playwright/test';
import { buildTicketData } from '../../fixtures/ticketData';
import { ApiClient, createApiContext } from '../../utils/apiClient';

test('protected ticket list rejects missing auth', async () => {
  const context = await createApiContext();
  const api = new ApiClient(context);

  const response = await api.listTickets();
  expect(response.status()).toBe(401);
  await context.dispose();
});

test('create ticket validates required title', async () => {
  const { client, context } = await ApiClient.forRole('admin');

  const response = await client.createTicket({ description: 'Missing required title.' });
  expect(response.status()).toBe(400);
  const body = await response.json();
  expect(body.message).toContain('Title is required');
  await context.dispose();
});

test('admin can create, update, list, and delete a ticket through the API', async () => {
  const { client, context } = await ApiClient.forRole('admin');
  const created = await client.createTicketAndReturn(buildTicketData({ priority: 'high' }));

  const patch = await client.patchTicket(created.ticket._id, {
    status: 'in-progress',
    priority: 'urgent',
  });
  expect(patch.status()).toBe(200);

  const list = await client.listTickets({
    search: created.ticket.ticketNumber || created.ticket.title,
  });
  expect(list.status()).toBe(200);
  const listBody = await list.json();
  expect(listBody.tickets.length).toBeGreaterThanOrEqual(1);

  const deleted = await client.deleteTicket(created.ticket._id);
  expect(deleted.status()).toBe(204);
  await context.dispose();
});
