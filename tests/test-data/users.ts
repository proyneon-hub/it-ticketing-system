import type { TestUser, UserRole } from './types';

export const testUsers: Record<UserRole, TestUser> = {
  admin: {
    name: 'Priya Admin',
    email: process.env.E2E_ADMIN_EMAIL ?? 'admin@demo.local',
    password: process.env.E2E_ADMIN_PASSWORD ?? 'AdminPass123!',
    role: 'admin',
  },
  technician: {
    name: 'Theo Technician',
    email: process.env.E2E_TECH_EMAIL ?? 'tech@demo.local',
    password: process.env.E2E_TECH_PASSWORD ?? 'TechPass123!',
    role: 'technician',
  },
  user: {
    name: 'Una User',
    email: process.env.E2E_USER_EMAIL ?? 'user@demo.local',
    password: process.env.E2E_USER_PASSWORD ?? 'UserPass123!',
    role: 'user',
  },
};
