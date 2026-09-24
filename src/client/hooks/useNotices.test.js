import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useNotices } from './useNotices.js';

describe('error notices', () => {
  it('shows an error with its request id as a support reference, and clears it', () => {
    const { result } = renderHook(() => useNotices());

    act(() => result.current.showError(Object.assign(new Error('Boom.'), { requestId: 'req-1' })));
    expect(result.current.error).toEqual({ message: 'Boom.', requestId: 'req-1' });

    act(() => result.current.showError(null));
    expect(result.current.error).toBeNull();
  });

  // When a session cannot be renewed the app announces that it ended, and then the request
  // that discovered it fails too. That second error must not replace the first.
  it('does not let the failed request overwrite the session-expired notice', () => {
    const { result } = renderHook(() => useNotices());

    act(() => result.current.showError(new Error('Your session expired. Sign in again.')));
    act(() =>
      result.current.showError(
        Object.assign(new Error('Authentication required.'), { status: 401, sessionEnded: true })
      )
    );

    expect(result.current.error.message).toBe('Your session expired. Sign in again.');
  });
});
