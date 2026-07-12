import type { NewTicketData } from './types';

export const testTickets = {
  monitorFlicker: {
    title: 'Monitor flickers after docking',
    description: 'External monitor flickers when laptop is docked.',
    category: 'Hardware',
    priority: 'medium',
  },
  screenshotCapture: {
    title: 'Screenshot ticket create form',
    description: 'Capture the ticket form for the Playwright artifact.',
    category: 'General Support',
    priority: 'medium',
  },
} satisfies Record<string, NewTicketData>;
