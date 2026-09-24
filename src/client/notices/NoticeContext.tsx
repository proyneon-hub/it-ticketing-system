import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

interface ErrorNotice {
  message: string;
  requestId: string;
}

export interface Notices {
  error: ErrorNotice | null;
  success: string;
  showError: (cause: unknown) => void;
  showSuccess: (message: string) => void;
  clear: () => void;
}

const NoticeContext = createContext<Notices | null>(null);

// The one error banner and one success banner at the top of the page. An error keeps
// its request id so the alert can show it as a support reference. Notices belong to
// the page they were raised on (its path): moving to another page clears them, but
// changing a filter or the page number on the same page does not.
export function NoticeProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<ErrorNotice | null>(null);
  const [success, setSuccess] = useState('');

  // Reset when the route changes, using React's "adjust state while rendering" pattern
  // instead of an effect, so the stale banner is never painted on the new page.
  const { pathname } = useLocation();
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setError(null);
    setSuccess('');
  }

  const showError = useCallback((cause: unknown) => {
    if (!cause) {
      setError(null);
      return;
    }
    const failure = cause as { message?: string; requestId?: string; sessionEnded?: boolean };
    // A request that failed because the session ended is already explained by the
    // session-expired notice; showing its raw 401 as well would replace that.
    if (failure.sessionEnded) return;
    setError({ message: failure.message || String(cause), requestId: failure.requestId || '' });
  }, []);

  const clear = useCallback(() => {
    setError(null);
    setSuccess('');
  }, []);

  const value = useMemo<Notices>(
    () => ({ error, success, showError, showSuccess: setSuccess, clear }),
    [error, success, showError, clear]
  );

  return <NoticeContext.Provider value={value}>{children}</NoticeContext.Provider>;
}

export function useNotices(): Notices {
  const value = useContext(NoticeContext);
  if (!value) throw new Error('useNotices must be used inside a NoticeProvider.');
  return value;
}
