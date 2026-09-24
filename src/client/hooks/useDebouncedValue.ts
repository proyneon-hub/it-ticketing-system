import { useEffect, useState } from 'react';

// Returns `value` only after it has stopped changing for `delayMs`, so typing in
// a search box triggers one request instead of one per keystroke.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
