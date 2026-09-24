import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { NoticeProvider, useNotices } from './NoticeContext';

const setup = (startAt = '/') => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[startAt]}>
      <NoticeProvider>{children}</NoticeProvider>
    </MemoryRouter>
  );
  return renderHook(() => ({ notices: useNotices(), navigate: useNavigate() }), { wrapper });
};

describe('error notices', () => {
  it('shows an error with its request id as a support reference, and clears it', () => {
    const { result } = setup();

    act(() =>
      result.current.notices.showError(Object.assign(new Error('Boom.'), { requestId: 'req-1' }))
    );
    expect(result.current.notices.error).toEqual({ message: 'Boom.', requestId: 'req-1' });

    act(() => result.current.notices.showError(null));
    expect(result.current.notices.error).toBeNull();
  });

  // When a session cannot be renewed the app announces that it ended, and then the request
  // that discovered it fails too. That second error must not replace the first.
  it('does not show a failure that only reports the session ending', () => {
    const { result } = setup();
    act(() => result.current.notices.showError(new Error('Your session expired. Sign in again.')));

    act(() =>
      result.current.notices.showError(
        Object.assign(new Error('Authentication required.'), { status: 401, sessionEnded: true })
      )
    );

    expect(result.current.notices.error?.message).toBe('Your session expired. Sign in again.');
  });
});

describe('success notices', () => {
  it('shows a message and clears both kinds together', () => {
    const { result } = setup();

    act(() => {
      result.current.notices.showSuccess('Ticket updated.');
      result.current.notices.showError(new Error('Boom.'));
    });
    expect(result.current.notices.success).toBe('Ticket updated.');

    act(() => result.current.notices.clear());
    expect(result.current.notices.success).toBe('');
    expect(result.current.notices.error).toBeNull();
  });
});

describe('changing filters on the same page', () => {
  it('keeps the notices: creating a ticket resets the list to page 1, and its message must survive', () => {
    const { result } = setup('/tickets');
    act(() => result.current.notices.showSuccess('Ticket created successfully.'));

    act(() => void result.current.navigate('/tickets?page=1', { replace: true }));
    act(() => void result.current.navigate('/tickets?status=open'));

    expect(result.current.notices.success).toBe('Ticket created successfully.');
  });
});

describe('moving between pages', () => {
  it('clears the notices, which belong to the page they were raised on', () => {
    const { result } = setup();
    act(() => {
      result.current.notices.showSuccess('Ticket updated.');
      result.current.notices.showError(new Error('Boom.'));
    });

    act(() => void result.current.navigate('/admin/users'));

    expect(result.current.notices.success).toBe('');
    expect(result.current.notices.error).toBeNull();
  });
});

it('refuses to be used outside its provider', () => {
  expect(() => renderHook(() => useNotices())).toThrow(/NoticeProvider/);
});
