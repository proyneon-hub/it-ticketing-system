import type { UserRole } from '../test-data/types';

export type LiveCredentials = {
  email: string;
  password: string;
};

export const liveSmokeEnabled = process.env.LIVE_SMOKE_ENABLED === 'true';

export function credentialsFor(
  role: Extract<UserRole, 'admin' | 'technician' | 'user'>
): LiveCredentials | null {
  const values = {
    admin: {
      email: process.env.E2E_ADMIN_EMAIL,
      password: process.env.E2E_ADMIN_PASSWORD,
    },
    technician: {
      email: process.env.E2E_TECH_EMAIL,
      password: process.env.E2E_TECH_PASSWORD,
    },
    user: {
      email: process.env.E2E_USER_EMAIL,
      password: process.env.E2E_USER_PASSWORD,
    },
  } as const;

  const credentials = values[role];
  return credentials.email && credentials.password
    ? { email: credentials.email, password: credentials.password }
    : null;
}

export const liveSmokeDisabledReason =
  'Set LIVE_SMOKE_ENABLED=true only for a dedicated, non-production test environment.';
