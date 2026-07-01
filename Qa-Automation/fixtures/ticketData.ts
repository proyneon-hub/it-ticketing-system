export function uniqueTicketTitle(prefix = 'QA automation ticket') {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

export function buildTicketData(overrides: Record<string, string> = {}) {
  return {
    title: uniqueTicketTitle(),
    description: 'Created by the standalone QA automation lab.',
    requesterName: 'Automation Tester',
    requesterEmail: 'automation@example.com',
    priority: 'medium',
    category: 'QA Automation',
    assignee: 'Theo Technician',
    ...overrides,
  };
}
