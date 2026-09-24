import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { defaultFilters } from '../constants';
import { useTicketFilters } from './useTicketFilters';

function setup(url = '/tickets') {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  );
  return renderHook(() => ({ ...useTicketFilters(), location: useLocation() }), { wrapper });
}

describe('reading filters from the address', () => {
  it('uses the defaults for a clean address', () => {
    expect(setup().result.current.filters).toEqual(defaultFilters);
  });

  it('reads every filter, the sort and the page', () => {
    const { result } = setup(
      '/tickets?status=open&priority=urgent&sla=breached&search=vpn&sortBy=priority&sortOrder=asc&page=3'
    );

    expect(result.current.filters).toEqual({
      ...defaultFilters,
      status: 'open',
      priority: 'urgent',
      sla: 'breached',
      search: 'vpn',
      sortBy: 'priority',
      sortOrder: 'asc',
      page: 3,
    });
  });

  // The address is user-editable, so nothing in it may reach the API unchecked.
  it.each([
    ['status=nonsense', 'status', ''],
    ['priority=%3Cscript%3E', 'priority', ''],
    ['sla=whenever', 'sla', ''],
    ['sortBy=passwordHash', 'sortBy', 'createdAt'],
    ['sortOrder=sideways', 'sortOrder', 'desc'],
    ['page=0', 'page', 1],
    ['page=-4', 'page', 1],
    ['page=2.5', 'page', 1],
    ['page=abc', 'page', 1],
  ])('falls back to the default for an invalid value (%s)', (query, field, expected) => {
    const { result } = setup(`/tickets?${query}`);

    expect(result.current.filters[field as keyof typeof defaultFilters]).toBe(expected);
  });

  it('does not let the address change the page size', () => {
    expect(setup('/tickets?limit=100').result.current.filters.limit).toBe(defaultFilters.limit);
  });
});

describe('changing filters', () => {
  it('puts only what differs from the defaults in the address', () => {
    const { result } = setup();

    act(() => result.current.setFilter('status', 'assigned'));
    expect(result.current.location.search).toBe('?status=assigned');

    act(() => result.current.setFilter('sortOrder', 'asc'));
    expect(result.current.location.search).toBe('?status=assigned&sortOrder=asc');

    act(() => result.current.setFilter('status', ''));
    expect(result.current.location.search).toBe('?sortOrder=asc');
  });

  it('goes back to the first page when a filter changes', () => {
    const { result } = setup('/tickets?page=4');

    act(() => result.current.setFilter('priority', 'high'));

    expect(result.current.filters.page).toBe(1);
    expect(result.current.location.search).toBe('?priority=high');
  });

  it('changes page without touching the filters', () => {
    const { result } = setup('/tickets?status=open');

    act(() => result.current.setPage(3));

    expect(result.current.location.search).toBe('?status=open&page=3');
    act(() => result.current.setPage(1));
    expect(result.current.location.search).toBe('?status=open');
  });
});
