import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { deferred, demoUsers, sessionUser, users } from '../test/fixtures';
import { AuthProvider, useAuth } from './AuthContext';

vi.mock('../api', async () => (await import('../test/apiMock')).apiMockFactory());

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>{children}</AuthProvider>
  </QueryClientProvider>
);
const setup = () => renderHook(() => useAuth(), { wrapper });
const credentials = { email: 'admin@demo.local', password: 'x' };

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient();
  vi.mocked(api.sessionMayExist).mockReturnValue(false);
  vi.mocked(api.logout).mockResolvedValue(null);
  vi.mocked(api.fetchDemoUsers).mockResolvedValue({ users: demoUsers });
});

describe('user shape', () => {
  // Regression (DEF-010): sign-in returns `id` while a token payload carries `sub`. A
  // client that read only one of them showed an empty dashboard after every sign-in, so
  // the provider accepts both and every path yields the same user.
  it('gives a signed-in user, a restored session and a token payload the same shape', async () => {
    vi.mocked(api.login).mockResolvedValue({ token: 't', user: users.technician });
    const signedIn = setup();
    await act(async () => void (await signedIn.result.current.login(credentials)));

    vi.mocked(api.sessionMayExist).mockReturnValue(true);
    vi.mocked(api.refreshSession).mockResolvedValue({ token: 't', user: users.technician });
    const restored = setup();
    await waitFor(() => expect(restored.result.current.user).not.toBeNull());

    vi.mocked(api.refreshSession).mockResolvedValue({
      token: 't',
      user: sessionUser(users.technician) as never,
    });
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
  it('holds the token, remembers a session may exist and returns the user', async () => {
    vi.mocked(api.login).mockResolvedValue({ token: 'abc', user: users.admin });
    const { result } = setup();

    let returned;
    await act(async () => {
      returned = await result.current.login(credentials);
    });

    expect(api.setAuthToken).toHaveBeenCalledWith('abc');
    expect(api.setSessionHint).toHaveBeenCalledWith(true);
    expect(returned).toMatchObject({ name: 'Priya Admin' });
    expect(result.current.user?.role).toBe('admin');
  });

  it('throws the API error for a failed sign-in, and stays signed out', async () => {
    const failure = new Error('Invalid email or password.');
    vi.mocked(api.login).mockRejectedValue(failure);
    const { result } = setup();

    await expect(act(() => result.current.login(credentials))).rejects.toBe(failure);

    expect(result.current.user).toBeNull();
    expect(api.setSessionHint).not.toHaveBeenCalledWith(true);
  });

  it("never shows the previous person's cached data to the next one", async () => {
    queryClient.setQueryData(['tickets', 'list'], { secret: 'someone else' });
    vi.mocked(api.login).mockResolvedValue({ token: 'abc', user: users.user });
    const { result } = setup();

    await act(async () => void (await result.current.login(credentials)));

    expect(queryClient.getQueryData(['tickets', 'list'])).toBeUndefined();
  });
});

describe('sign-out', () => {
  async function signedIn() {
    vi.mocked(api.login).mockResolvedValue({ token: 'abc', user: users.admin });
    const view = setup();
    await act(async () => void (await view.result.current.login(credentials)));
    queryClient.setQueryData(['tickets', 'list'], { data: [] });
    return view;
  }

  it('ends the session on the server, signs out here and forgets cached data', async () => {
    const { result } = await signedIn();

    await act(() => result.current.logout());

    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(result.current.user).toBeNull();
    expect(api.setSessionHint).toHaveBeenLastCalledWith(false);
    expect(queryClient.getQueryData(['tickets', 'list'])).toBeUndefined();
  });

  it('still signs out here when the server cannot be told', async () => {
    const { result } = await signedIn();
    vi.mocked(api.logout).mockRejectedValue(new Error('offline'));

    await act(() => result.current.logout());

    expect(result.current.user).toBeNull();
  });
});

describe('restoring a session on page load', () => {
  it('asks the server only when a session may exist', async () => {
    const { result } = setup();

    await waitFor(() => expect(api.fetchDemoUsers).toHaveBeenCalled());
    expect(api.refreshSession).not.toHaveBeenCalled();
    expect(result.current.restoring).toBe(false);
  });

  it('restores the user, and reports that it is restoring in the meantime', async () => {
    vi.mocked(api.sessionMayExist).mockReturnValue(true);
    const pending = deferred<{ token: string; user: typeof users.technician }>();
    vi.mocked(api.refreshSession).mockReturnValue(pending.promise as never);

    const { result } = setup();
    expect(result.current.restoring).toBe(true);
    expect(result.current.user).toBeNull();

    await act(async () => pending.resolve({ token: 't', user: users.technician }));

    expect(result.current.restoring).toBe(false);
    expect(result.current.user?.name).toBe('Theo Technician');
  });

  it('falls back to signed out, without complaint, when the session has ended', async () => {
    vi.mocked(api.sessionMayExist).mockReturnValue(true);
    vi.mocked(api.refreshSession).mockRejectedValue(new Error('Session expired. Sign in again.'));

    const { result } = setup();

    await waitFor(() => expect(result.current.restoring).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.sessionExpired).toBe(false); // Nothing was lost: there was no session.
    expect(api.setSessionHint).toHaveBeenCalledWith(false);
  });
});

describe('a session that ends while the app is open', () => {
  it('signs the user out, flags it, and forgets cached data', async () => {
    vi.mocked(api.login).mockResolvedValue({ token: 'abc', user: users.admin });
    const { result } = setup();
    await act(async () => void (await result.current.login(credentials)));
    queryClient.setQueryData(['tickets', 'list'], { data: [] });
    const handler = vi.mocked(api.onUnauthorized).mock.calls.at(-1)?.[0];

    act(() => handler?.());

    expect(result.current.user).toBeNull();
    expect(result.current.sessionExpired).toBe(true);
    expect(api.setSessionHint).toHaveBeenLastCalledWith(false);
    expect(queryClient.getQueryData(['tickets', 'list'])).toBeUndefined();
  });

  it('is not flagged once the user signs in again', async () => {
    vi.mocked(api.login).mockResolvedValue({ token: 'abc', user: users.admin });
    const { result } = setup();
    await act(async () => void (await result.current.login(credentials)));
    act(() => vi.mocked(api.onUnauthorized).mock.calls.at(-1)?.[0]?.());
    expect(result.current.sessionExpired).toBe(true);

    await act(async () => void (await result.current.login(credentials)));

    expect(result.current.sessionExpired).toBe(false);
  });
});

it('loads the demo accounts, and shows none if they cannot be loaded', async () => {
  const loaded = setup();
  await waitFor(() => expect(loaded.result.current.demoUsers).toHaveLength(3));

  vi.mocked(api.fetchDemoUsers).mockRejectedValue(new Error('down'));
  const failed = setup();
  await waitFor(() => expect(api.fetchDemoUsers).toHaveBeenCalledTimes(2));
  expect(failed.result.current.demoUsers).toEqual([]);
});

it('refuses to be used outside its provider', () => {
  expect(() => renderHook(() => useAuth())).toThrow(/AuthProvider/);
});
