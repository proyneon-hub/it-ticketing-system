import { expect, test } from '@playwright/test';
import { ApiClient, createApiContext } from '../../utils/apiClient';
import { users } from '../../fixtures/users';

test('health endpoint returns service status', async () => {
  const context = await createApiContext();
  const api = new ApiClient(context);

  const response = await api.health();
  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    ok: true,
    service: 'it-ticketing-system',
  });
  await context.dispose();
});

test('login returns a token and user details', async () => {
  const context = await createApiContext();
  const api = new ApiClient(context);

  const response = await api.login(users.admin.email, users.admin.password);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.token).toEqual(expect.any(String));
  expect(body.user.role).toBe('admin');
  await context.dispose();
});

test('invalid login is rejected', async () => {
  const context = await createApiContext();
  const api = new ApiClient(context);

  const response = await api.login(users.admin.email, 'bad-password');
  expect(response.status()).toBe(401);
  await context.dispose();
});

test('me endpoint rejects missing auth token', async () => {
  const context = await createApiContext();
  const api = new ApiClient(context);

  const response = await api.me();
  expect(response.status()).toBe(401);
  await context.dispose();
});
