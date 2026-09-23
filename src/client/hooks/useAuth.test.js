import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api.js';
import { demoUsers, sessionUser, users } from '../test/fixtures.js';
import { useAuth } from './useAuth.js';

vi.mock('../api.js', () => ({
  fetchDemoUsers: vi.fn(),
  fetchMe: vi.fn(),
  hasAuthToken: vi.fn(),
  login: vi.fn(),
  onUnauthorized: vi.fn(),
  setAuthToken: vi.fn(),
}));

const onError = vi.fn();
const onSessionExpired = vi.fn();
const setup = () => renderHook(() => useAuth({ onError, onSessionExpired }));

beforeEach(() => {
  vi.clearAllMocks();
  api.hasAuthToken.mockReturnValue(false);
  api.fetchDemoUsers.mockResolvedValue({ users: demoUsers });
});

describe('user shape', () => {
  // Regression: sign-in returns `id` but /auth/me returns `sub`. A client that
  // read only one of them showed an empty dashboard after every sign-in.
  it('gives a signed-in user and a restored session the same shape', async () => {
    api.login.mockResolvedValue({ token: 't', user: users.technician });
    const signedIn = setup();
    await act(async () =>
      signedIn.result.current.login({ email: 'tech@demo.local', password: 'x' })
    );

    api.hasAuthToken.mockReturnValue(true);
    api.fetchMe.mockResolvedValue({ user: sessionUser(users.technician) });
    const restored = setup();
    await waitFor(() => expect(restored.result.current.user).not.toBeNull());

    const expected = {
      id: 'usr_tech',
      name: 'Theo Technician',
      email: 'tech@demo.local',
      role: 'technician',
    };
    expect(signedIn.result.current.user).toEqual(expected);
    expect(restored.result.current.user).toEqual(expected);
  });
});

describe('sign-in', () => {
  it('stores the token, remembers the credentials, and returns the user', async () => {
    api.login.mockResolvedValue({ token: 'abc', user: users.admin });
    const { result } = setup();
    const credentials = { email: 'admin@demo.local', password: 'AdminPass123!' };

    let returned;
    await act(async () => {
      returned = await result.current.login(credentials);
    });

    expect(api.setAuthToken).toHaveBeenCalledWith('abc');
    expect(returned.name).toBe('Priya Admin');
    expect(result.current.credentials).toEqual(credentials);
  });

  it('reports a failed sign-in and stays signed out', async () => {
    const failure = new Error('Invalid email or password.');
    api.login.mockRejectedValue(failure);
    const { result } = setup();

    let returned;
    await act(async () => {
      returned = await result.current.login({ email: 'a', password: 'b' });
    });

    expect(returned).toBeNull();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(result.current.user).toBeNull();
  });

  it('signs out by clearing the token and the user', async () => {
    api.login.mockResolvedValue({ token: 'abc', user: users.admin });
    const { result } = setup();
    await act(async () => result.current.login({ email: 'admin@demo.local', password: 'x' }));

    act(() => result.current.logout());

    expect(result.current.user).toBeNull();
    expect(api.setAuthToken).toHaveBeenLastCalledWith('');
  });
});

describe('demo accounts and session expiry', () => {
  it('loads the demo accounts, and shows none if they cannot be loaded', async () => {
    const loaded = setup();
    await waitFor(() => expect(loaded.result.current.demoUsers).toHaveLength(3));

    api.fetchDemoUsers.mockRejectedValue(new Error('down'));
    const failed = setup();
    await waitFor(() => expect(api.fetchDemoUsers).toHaveBeenCalledTimes(2));
    expect(failed.result.current.demoUsers).toEqual([]);
  });

  it('signs the user out and tells the app when the API rejects the token', async () => {
    api.login.mockResolvedValue({ token: 'abc', user: users.admin });
    const { result } = setup();
    await act(async () => result.current.login({ email: 'admin@demo.local', password: 'x' }));
    const handler = api.onUnauthorized.mock.calls.at(-1)[0];

    act(() => handler());

    expect(result.current.user).toBeNull();
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });
});
