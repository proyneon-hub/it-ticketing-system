import { useCallback, useEffect, useState } from 'react';
import {
  fetchDemoUsers,
  login as loginRequest,
  logout as logoutRequest,
  onUnauthorized,
  refreshSession,
  sessionMayExist,
  setAuthToken,
  setSessionHint,
} from '../api.js';
import { defaultCredentials } from '../constants.js';

// Sign-in and refresh return the user as `id`, while a token payload carries it as
// `sub`. Normalizing once here means nothing else needs to know about the difference.
function toClientUser({ id, sub, name, email, role }) {
  return { id: id ?? sub, name, email, role };
}

// Owns who is signed in: restoring a session on page load, signing in and out, and
// reacting when the API says the session is over.
export function useAuth({ onError, onSessionExpired }) {
  const [user, setUser] = useState(null);
  const [demoUsers, setDemoUsers] = useState([]);
  const [credentials, setCredentials] = useState(defaultCredentials);
  // True while the refresh cookie is being traded for an access token after a reload, so
  // the page can say so instead of flashing the sign-in prompt.
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
      onSessionExpired?.();
    });
    return () => onUnauthorized(null);
  }, [onSessionExpired]);

  const login = useCallback(
    async (nextCredentials) => {
      try {
        const data = await loginRequest(nextCredentials);
        setAuthToken(data.token);
        setSessionHint(true);
        const signedInUser = toClientUser(data.user);
        setUser(signedInUser);
        setCredentials({ email: nextCredentials.email, password: nextCredentials.password });
        return signedInUser;
      } catch (error) {
        onError(error);
        return null;
      }
    },
    [onError]
  );

  const logout = useCallback(async () => {
    // Best effort: signing out here must work even if the server cannot be reached.
    await logoutRequest().catch(() => {});
    setSessionHint(false);
    setUser(null);
  }, []);

  return { user, demoUsers, credentials, setCredentials, login, logout, restoring };
}
