import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  fetchDemoUsers,
  login as loginRequest,
  logout as logoutRequest,
  onUnauthorized,
  refreshSession,
  sessionMayExist,
  setAuthToken,
  setSessionHint,
} from '../api';
import type { Credentials, DemoUser, User } from '../types';

export interface Auth {
  user: User | null;
  // True while the refresh cookie is being traded for an access token after a reload, so
  // the page can say so instead of flashing the sign-in prompt.
  restoring: boolean;
  // True once a session ended without the user asking (revoked, or it could not be renewed).
  sessionExpired: boolean;
  demoUsers: DemoUser[];
  // Throws the API's error on a failed sign-in, so the caller can show it.
  login: (credentials: Credentials) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

// Sign-in and refresh return the user as `id`, while a token payload carries it as
// `sub`. Normalizing once here means nothing else needs to know about the difference.
function toClientUser({ id, sub, name, email, role }: User & { sub?: string }): User {
  return { id: id ?? sub ?? '', name, email, role };
}

// Owns who is signed in: restoring a session on page load, signing in and out, and
// reacting when the API says the session is over.
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [demoUsers, setDemoUsers] = useState<DemoUser[]>([]);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [restoring, setRestoring] = useState(() => sessionMayExist());

  useEffect(() => {
    let active = true;

    fetchDemoUsers()
      .then((data) => active && setDemoUsers(data.users))
      .catch(() => active && setDemoUsers([]));

    // Only try to restore when this browser signed in before; a first visit has nothing to restore.
    if (sessionMayExist()) {
      refreshSession()
        .then((data) => active && setUser(toClientUser(data.user)))
        .catch(() => setSessionHint(false)) // No usable session: just stay signed out.
        .finally(() => active && setRestoring(false));
    }

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    onUnauthorized(() => {
      setSessionHint(false);
      setUser(null);
      setSessionExpired(true);
      queryClient.clear();
    });
    return () => onUnauthorized(null);
  }, [queryClient]);

  const login = useCallback(
    async (credentials: Credentials) => {
      const data = await loginRequest(credentials);
      setAuthToken(data.token);
      setSessionHint(true);
      // Whoever signs in next starts from a clean slate, never the last user's cached data.
      queryClient.clear();
      const signedInUser = toClientUser(data.user);
      setSessionExpired(false);
      setUser(signedInUser);
      return signedInUser;
    },
    [queryClient]
  );

  const logout = useCallback(async () => {
    // Best effort: signing out here must work even if the server cannot be reached.
    await logoutRequest().catch(() => {});
    setSessionHint(false);
    setSessionExpired(false);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<Auth>(
    () => ({ user, restoring, sessionExpired, demoUsers, login, logout }),
    [user, restoring, sessionExpired, demoUsers, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside an AuthProvider.');
  return value;
}
