export type UserRole = 'admin' | 'technician' | 'user';

export const users = {
  admin: {
    name: 'Priya Admin',
    email: 'admin@demo.local',
    password: 'AdminPass123!',
    role: 'admin',
  },
  technician: {
    name: 'Theo Technician',
    email: 'tech@demo.local',
    password: 'TechPass123!',
    role: 'technician',
  },
  user: {
    name: 'Una User',
    email: 'user@demo.local',
    password: 'UserPass123!',
    role: 'user',
  },
} as const;
