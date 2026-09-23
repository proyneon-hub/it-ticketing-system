import { useCallback, useEffect, useState } from 'react';
import {
  fetchDemoUsers,
  fetchMe,
  hasAuthToken,
  login as loginRequest,
  onUnauthorized,
  setAuthToken,
} from '../api.js';
import { defaultCredentials } from '../constants.js';

// Sign-in returns the user as `id`, while /auth/me returns the token payload as
// `sub`. Normalizing once here means nothing else needs to know about the difference.
function toClientUser({ id, sub, name, email, role }) {
  return { id: id ?? sub, name, email, role };
}

// Owns who is signed in: restoring a saved session, signing in and out, and
// reacting when the API says the token is no longer valid.
export function useAuth({ onError, onSessionExpired }) {
  const [user, setUser] = useState(null);
  const [demoUsers, setDemoUsers] = useState([]);
  const [credentials, setCredentials] = useState(defaultCredentials);

  useEffect(() => {
    let active = true;

    fetchDemoUsers()
      .then((data) => active && setDemoUsers(data.users))
      .catch(() => active && setDemoUsers([]));

    // Only ask the server who we are if there is a saved session to restore.
    if (hasAuthToken()) {
      fetchMe()
        .then((data) => active && setUser(toClientUser(data.user)))
        .catch(() => setAuthToken(''));
    }

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    onUnauthorized(() => {
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

  const logout = useCallback(() => {
    setAuthToken('');
    setUser(null);
  }, []);

  return { user, demoUsers, credentials, setCredentials, login, logout };
}
