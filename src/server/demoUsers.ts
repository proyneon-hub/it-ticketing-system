import type { Role } from '../shared/ticket-constants';

// The three accounts the live demo signs in with. Their passwords are public on
// purpose (the sign-in page has one-click buttons), so they are ordinary data here.
// They are stored like any other user, hashed, and only created when missing: a role
// an admin has changed is never reset.
export interface DemoUser {
  name: string;
  email: string;
  password: string;
  role: Role;
}

export const demoUsers: DemoUser[] = [
  { name: 'Priya Admin', email: 'admin@demo.local', password: 'AdminPass123!', role: 'admin' },
  {
    name: 'Theo Technician',
    email: 'tech@demo.local',
    password: 'TechPass123!',
    role: 'technician',
  },
  { name: 'Una User', email: 'user@demo.local', password: 'UserPass123!', role: 'user' },
];
