import type Anthropic from '@anthropic-ai/sdk';
import {
  ScriptedModelClient,
  calls,
  modelResponse,
  toolUse,
  type ScriptStep,
} from '../../src/server/agent/scriptedClient';
import type { ModelClient, ModelRequest } from '../../src/server/agent/types';
import type { GoldenTicket } from './types';

// The oracle: a "model" that reads the answers and gives them, through the same tools a real model
// uses. It is not an agent and measures nothing about one. Running the evaluation with it checks the
// evaluation itself: every golden ticket can be answered through the tools, the pipeline (ticket, event,
// worker, loop, record, score) works end to end, and a perfect agent scores 100%. A result from the
// oracle is always labelled as such and is never recorded in the history.

// The ticket the run is about, from the first message the agent receives.
const ticketOf = (request: ModelRequest): string => {
  const first = request.messages[0]?.content;
  const text = typeof first === 'string' ? first : '';
  const id = /Your ticket id is ([a-f\d]{24})/.exec(text)?.[1];
  if (!id) throw new Error('The oracle could not find the ticket id in the first message.');
  return id;
};

export function oracleScript(golden: GoldenTicket): ScriptStep[] {
  const steps: ScriptStep[] = [];

  steps.push(calls(toolUse('search_kb', { query: golden.title.slice(0, 100) })));
  // A real agent reads an article before citing it, and so does the oracle.
  for (const id of golden.relevant_kb_ids)
    steps.push(calls(toolUse('get_kb_article', { kb_id: id })));

  steps.push((request) => {
    const ticketId = ticketOf(request);
    const triage = toolUse('set_triage', {
      ticket_id: ticketId,
      category: golden.expected_category,
      priority: golden.expected_priority,
      assignee_group: golden.expected_group,
      reasoning_summary: 'Read from the answer key.',
    });
    const decide: Anthropic.ToolUseBlock =
      golden.expected_action === 'propose'
        ? toolUse('propose_resolution', {
            ticket_id: ticketId,
            reply_markdown: `Please follow the numbered steps in ${golden.relevant_kb_ids.join(' and ')} and let us know if the problem continues.`,
            cited_kb_ids: golden.relevant_kb_ids,
            confidence: 'high',
            reasoning_summary: 'Read from the answer key.',
          })
        : toolUse('escalate', {
            ticket_id: ticketId,
            assignee_group: golden.expected_group,
            reason: golden.expected_reason ?? 'other',
            summary: {
              reported: 'Read from the answer key.',
              checked: 'Nothing: this is the oracle.',
              ruled_out: 'Nothing.',
              why_escalating: `The answer key says to escalate (${golden.expected_reason ?? 'other'}).`,
            },
          });
    return modelResponse([triage, decide]);
  });
  return steps;
}

export const oracleFor = (golden: GoldenTicket): ModelClient =>
  new ScriptedModelClient(oracleScript(golden));

// Two deliberately bad agents, to show the scoring can tell good from bad. Neither is used for real
// measurement; the tests run them and check the scores that a bad agent must get.

// Hands every ticket to Help Desk as "other", as a lazy agent might.
export function alwaysEscalate(): ScriptStep[] {
  return [
    (request) => {
      const ticket_id = ticketOf(request);
      return modelResponse([
        toolUse('set_triage', {
          ticket_id,
          category: 'General Support',
          priority: 'medium',
          assignee_group: 'Help Desk',
          reasoning_summary: 'Not sure.',
        }),
        toolUse('escalate', {
          ticket_id,
          assignee_group: 'Help Desk',
          reason: 'other',
          summary: { reported: 'x', checked: 'x', ruled_out: 'x', why_escalating: 'x' },
        }),
      ]);
    },
  ];
}

// Proposes the same VPN article for everything, and never escalates: reckless where it matters most.
export function alwaysProposeVpn(): ScriptStep[] {
  return [
    calls(toolUse('get_kb_article', { kb_id: 'KB-006' })),
    (request) => {
      const ticket_id = ticketOf(request);
      return modelResponse([
        toolUse('set_triage', {
          ticket_id,
          category: 'Network',
          priority: 'medium',
          assignee_group: 'Network Support',
          reasoning_summary: 'It is always the VPN.',
        }),
        toolUse('propose_resolution', {
          ticket_id,
          reply_markdown: 'Please reconnect the VPN using the steps in the article and try again.',
          cited_kb_ids: ['KB-006'],
          confidence: 'high',
          reasoning_summary: 'It is always the VPN.',
        }),
      ]);
    },
  ];
}
