import { expect, test } from '@playwright/test';
import { buildTicketData } from '../../fixtures/ticketData';
import { ApiClient } from '../../utils/apiClient';
import { users } from '../../fixtures/users';

test('user ticket list is scoped to the signed-in requester', async () => {
  const { client, context } = await ApiClient.forRole('user');

  await client.createTicketAndReturn(buildTicketData({ title: `User scoped ${Date.now()}` }));
  const response = await client.listTickets();
  expect(response.status()).toBe(200);
  const body = await response.json();
  for (const ticket of body.tickets) {
    expect(ticket.requesterEmail).toBe(users.user.email);
  }
  await context.dispose();
});

test('technician cannot delete a ticket through the API', async () => {
  const admin = await ApiClient.forRole('admin');
  const technician = await ApiClient.forRole('technician');
  const created = await admin.client.createTicketAndReturn(buildTicketData());

  const forbidden = await technician.client.deleteTicket(created.ticket._id);
  expect(forbidden.status()).toBe(403);

  const cleanup = await admin.client.deleteTicket(created.ticket._id);
  expect(cleanup.status()).toBe(204);
  await admin.context.dispose();
  await technician.context.dispose();
});
