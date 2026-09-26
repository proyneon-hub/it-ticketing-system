import { describe, expect, it } from 'vitest';
import { allowedNextStatuses } from './workflow';

describe('allowedNextStatuses', () => {
  it('offers the current status plus the legal moves', () => {
    expect(allowedNextStatuses('open', 'technician')).toEqual([
      'open',
      'assigned',
      'in-progress',
      'pending-user',
      'closed',
    ]);
    expect(allowedNextStatuses('in-progress', 'technician')).toEqual([
      'in-progress',
      'resolved',
      'pending-user',
      'assigned',
    ]);
  });

  it('keeps reopening a closed ticket for admins only', () => {
    expect(allowedNextStatuses('closed', 'admin')).toEqual(['closed', 'in-progress']);
    expect(allowedNextStatuses('closed', 'technician')).toEqual(['closed']);
  });

  it('still lists the current status for a status it does not know', () => {
    expect(allowedNextStatuses('archived', 'admin')).toEqual(['archived']);
  });
});
