import { useCallback, useMemo, useState } from 'react';

// Holds the single error and success banner shown at the top of the page. An
// error keeps its request id so the alert can show it as a support reference.
export function useNotices() {
  const [error, setErrorState] = useState(null);
  const [success, setSuccess] = useState('');

  const showError = useCallback((cause) => {
    setErrorState(
      cause ? { message: cause.message || String(cause), requestId: cause.requestId || '' } : null
    );
  }, []);

  const clear = useCallback(() => {
    setErrorState(null);
    setSuccess('');
  }, []);

  return useMemo(
    () => ({ error, success, showError, showSuccess: setSuccess, clear }),
    [error, success, showError, clear]
  );
}
