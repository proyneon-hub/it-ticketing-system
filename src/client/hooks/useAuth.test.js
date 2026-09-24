import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api.js';
import { deferred, demoUsers, sessionUser, users } from '../test/fixtures.js';
import { useAuth } from './useAuth.js';

vi.mock('../api.js', () => ({
  fetchDemoUsers: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  onUnauthorized: vi.fn(),
  refreshSession: vi.fn(),
  sessionMayExist: vi.fn(),
  setAuthToken: vi.fn(),
  setSessionHint: vi.fn(),
}));

const onError = vi.fn();
const onSessionExpired = vi.fn();
const setup = () => renderHook(() => useAuth({ onError, onSessionExpired }));

beforeEach(() => {
  vi.clearAllMocks();
  api.sessionMayExist.mockReturnValue(false);
  api.logout.mockResolvedValue(null);
  api.fetchDemoUsers.mockResolvedValue({ users: demoUsers });
});

describe('user shape', () => {
  // Regression (DEF-010): sign-in returns `id` while a token payload carries `sub`. A
  // client that read only one of them showed an empty dashboard after every sign-in, so
  // the hook accepts both and every path yields the same user.
  it('gives a signed-in user, a restored session and a token payload the same shape', async () => {
    api.login.mockResolvedValue({ token: 't', user: users.technician });
    const signedIn = setup();
    await act(async () =>
      signedIn.result.current.login({ email: 'tech@demo.local', password: 'x' })
    );

    api.sessionMayExist.mockReturnValue(true);
    api.refreshSession.mockResolvedValue({ token: 't', user: users.technician });
    const restored = setup();
    await waitFor(() => expect(restored.result.current.user).not.toBeNull());

    api.refreshSession.mockResolvedValue({ token: 't', user: sessionUser(users.technician) });
    const fromPayload = setup();
    await waitFor(() => expect(fromPayload.result.current.user).not.toBeNull());

    const expected = {
      id: 'usr_tech',
      name: 'Theo Technician',
      email: 'tech@demo.local',
      role: 'technician',
    };
    expect(signedIn.result.current.user).toEqual(expected);
    expect(restored.result.current.user).toEqual(expected);
    expect(fromPayload.result.current.user).toEqual(expected);
  });
});

describe('sign-in', () => {
  it('holds the token, remembers a session may exist, keeps the credentials and returns the user', async () => {
    api.login.mockResolvedValue({ token: 'abc', user: users.admin });
    const { result } = setup();
    const credentials = { email: 'admin@demo.local', password: 'AdminPass123!' };

    let returned;
    await act(async () => {
      returned = await result.current.login(credentials);
    });

    expect(api.setAuthToken).toHaveBeenCalledWith('abc');
    expect(api.setSessionHint).toHaveBeenCalledWith(true);
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
    expect(api.setSessionHint).not.toHaveBeenCalledWith(true);
  });
});

describe('sign-out', () => {
  it('ends the session on the server and signs the user out here', async () => {
    api.login.mockResolvedValue({ token: 'abc', user: users.admin });
    const { result } = setup();
    await act(async () => result.current.login({ email: 'admin@demo.local', password: 'x' }));

    await act(async () => result.current.logout());

    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(result.current.user).toBeNull();
    expect(api.setSessionHint).toHaveBeenLastCalledWith(false);
  });

  it('still signs out here when the server cannot be told', async () => {
    api.login.mockResolvedValue({ token: 'abc', user: users.admin });
    api.logout.mockRejectedValue(new Error('offline'));
    const { result } = setup();
    await act(async () => result.current.login({ email: 'admin@demo.local', password: 'x' }));

    await act(async () => result.current.logout());

    expect(result.current.user).toBeNull();
  });
});

describe('restoring a session on page load', () => {
  it('asks the server only when a session may exist, and stays quiet when there is none', async () => {
    const { result } = setup();

    await waitFor(() => expect(api.fetchDemoUsers).toHaveBeenCalled());
    expect(api.refreshSession).not.toHaveBeenCalled();
    expect(result.current.restoring).toBe(false);
  });

  it('restores the user, and reports that it is restoring in the meantime', async () => {
    api.sessionMayExist.mockReturnValue(true);
    const pending = deferred();
    api.refreshSession.mockReturnValue(pending.promise);

    const { result } = setup();
    expect(result.current.restoring).toBe(true);
    expect(result.current.user).toBeNull();

    await act(async () => pending.resolve({ token: 't', user: users.technician }));

    expect(result.current.restoring).toBe(false);
    expect(result.current.user.name).toBe('Theo Technician');
  });

  it('falls back to signed out, without an error message, when the session has ended', async () => {
    api.sessionMayExist.mockReturnValue(true);
    api.refreshSession.mockRejectedValue(new Error('Session expired. Sign in again.'));

    const { result } = setup();

    await waitFor(() => expect(result.current.restoring).toBe(false));
    expect(result.current.user).toBeNull();
    expect(api.setSessionHint).toHaveBeenCalledWith(false);
    expect(onError).not.toHaveBeenCalled();
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

  it('signs the user out and tells the app when the session cannot be renewed', async () => {
    api.login.mockResolvedValue({ token: 'abc', user: users.admin });
    const { result } = setup();
    await act(async () => result.current.login({ email: 'admin@demo.local', password: 'x' }));
    const handler = api.onUnauthorized.mock.calls.at(-1)[0];

    act(() => handler());

    expect(result.current.user).toBeNull();
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(api.setSessionHint).toHaveBeenLastCalledWith(false);
  });
});
