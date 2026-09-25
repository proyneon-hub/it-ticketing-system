import fs from 'fs';
import path from 'path';
import { agentEscalationReasons } from '../../src/shared/agent-constants';
import {
  agentCategories,
  assigneeGroups,
  kbIdPattern,
  priorities,
  statuses,
} from '../../src/shared/ticket-constants';
import type { GoldenTicket } from './types';

// Reads and checks the golden set. A label that is a typo (a category that does not exist, a
// knowledge-base article that is not there) would quietly make the agent look wrong, so every row is
// checked when it is loaded and the error names the line and the ticket.

const oneOf = (list: readonly string[], value: unknown): boolean =>
  typeof value === 'string' && list.includes(value);

export function validateGolden(row: unknown, line: number): GoldenTicket {
  const fail = (message: string): never => {
    const id = (row as { id?: unknown })?.id;
    throw new Error(`eval/tickets.jsonl line ${line}${id ? ` (${String(id)})` : ''}: ${message}`);
  };
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return fail('not an object.');
  const g = row as Record<string, unknown>;

  if (typeof g.id !== 'string' || !/^T\d{3}$/.test(g.id)) fail('id must look like T001.');
  if (typeof g.title !== 'string' || g.title.length < 1 || g.title.length > 120) {
    fail('title must be 1 to 120 characters, as a ticket title is.');
  }
  if (
    typeof g.description !== 'string' ||
    g.description.length < 1 ||
    g.description.length > 2000
  ) {
    fail('description must be 1 to 2000 characters, as a ticket description is.');
  }
  if (!oneOf(agentCategories, g.expected_category)) fail('expected_category is not a category.');
  if (!oneOf(priorities, g.expected_priority)) fail('expected_priority is not a priority.');
  if (!oneOf(assigneeGroups, g.expected_group)) fail('expected_group is not an assignee group.');
  if (g.expected_action !== 'propose' && g.expected_action !== 'escalate') {
    fail('expected_action must be propose or escalate.');
  }

  const kb = g.relevant_kb_ids;
  if (!Array.isArray(kb) || !kb.every((id) => typeof id === 'string' && kbIdPattern.test(id))) {
    fail('relevant_kb_ids must be a list of ids like KB-006.');
  }
  if (!Array.isArray(g.tags) || !g.tags.every((tag) => typeof tag === 'string')) {
    fail('tags must be a list of words.');
  }

  // The two kinds of answer have different shapes, and mixing them up is the commonest mistake.
  if (g.expected_action === 'propose') {
    if ((kb as string[]).length === 0)
      fail('a ticket to resolve must name the article that resolves it.');
    if (g.expected_reason !== undefined) fail('a ticket to resolve has no escalation reason.');
  } else {
    if ((kb as string[]).length > 0) fail('a ticket to escalate has no article that resolves it.');
    if (!oneOf(agentEscalationReasons, g.expected_reason)) {
      fail('a ticket to escalate needs expected_reason, one of the escalation reasons.');
    }
  }
  if ((g.tags as string[]).includes('security')) {
    if (g.expected_action !== 'escalate') fail('a security ticket must be escalated.');
    if (g.expected_group !== 'Security Team') fail('a security ticket goes to the Security Team.');
    if (g.expected_category !== 'Security') fail('a security ticket is in the Security category.');
  }

  if (g.history !== undefined) {
    const history = g.history;
    if (
      !Array.isArray(history) ||
      !history.every(
        (h) =>
          typeof h?.title === 'string' &&
          oneOf(statuses, h.status) &&
          typeof h.category === 'string'
      )
    ) {
      fail('history must be a list of { title, status, category }.');
    }
  }
  return g as unknown as GoldenTicket;
}

export function parseTickets(jsonl: string): GoldenTicket[] {
  const tickets: GoldenTicket[] = [];
  const seen = new Set<string>();
  jsonl
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((text, index) => {
      if (text.trim() === '') return;
      let row: unknown;
      try {
        row = JSON.parse(text);
      } catch {
        throw new Error(`eval/tickets.jsonl line ${index + 1}: not valid JSON.`);
      }
      const ticket = validateGolden(row, index + 1);
      if (seen.has(ticket.id)) throw new Error(`eval/tickets.jsonl: ${ticket.id} appears twice.`);
      seen.add(ticket.id);
      tickets.push(ticket);
    });
  return tickets;
}

export const DEFAULT_TICKETS = path.join(process.cwd(), 'eval', 'tickets.jsonl');
export const DEFAULT_SMOKE = path.join(process.cwd(), 'eval', 'smoke.json');

export const loadTickets = (file: string = DEFAULT_TICKETS): GoldenTicket[] =>
  parseTickets(fs.readFileSync(file, 'utf8'));

// The small set that runs on every change to the agent or its prompt.
export function loadSmokeIds(file: string = DEFAULT_SMOKE): string[] {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { ids?: unknown };
  if (!Array.isArray(parsed.ids) || !parsed.ids.every((id) => typeof id === 'string')) {
    throw new Error('eval/smoke.json must be { "ids": ["T001", ...] }.');
  }
  return parsed.ids as string[];
}

export interface Selection {
  subset: 'full' | 'smoke';
  ids?: string[] | undefined;
  tags?: string[] | undefined;
  limit?: number | undefined;
}

// The tickets to run, in dataset order. Naming an id that is not in the set is an error, not an empty
// run, so a typo cannot quietly evaluate nothing.
export function selectTickets(
  all: GoldenTicket[],
  selection: Selection,
  smokeIds: string[] = []
): GoldenTicket[] {
  const known = new Set(all.map((ticket) => ticket.id));
  const wanted = selection.subset === 'smoke' ? smokeIds : selection.ids;

  for (const id of [...(wanted ?? []), ...(selection.ids ?? [])]) {
    if (!known.has(id)) throw new Error(`There is no ticket ${id} in the dataset.`);
  }

  let chosen = all;
  if (wanted && wanted.length > 0) chosen = chosen.filter((ticket) => wanted.includes(ticket.id));
  if (selection.ids && selection.ids.length > 0) {
    chosen = chosen.filter((ticket) => selection.ids?.includes(ticket.id));
  }
  if (selection.tags && selection.tags.length > 0) {
    chosen = chosen.filter((ticket) => selection.tags?.some((tag) => ticket.tags.includes(tag)));
  }
  return selection.limit !== undefined ? chosen.slice(0, selection.limit) : chosen;
}
