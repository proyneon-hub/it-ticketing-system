import type { AgentEscalationReason, AgentOutcome } from '../../src/shared/agent-constants';
import type {
  AgentCategory,
  AssigneeGroup,
  Priority,
  Status,
} from '../../src/shared/ticket-constants';

// A ticket the agent is tested on, with the answer a good support person would give. The labels are
// written by hand (eval/tickets.jsonl): they are the standard, so they are never produced by the
// model being tested.
export interface GoldenTicket {
  id: string;
  title: string;
  description: string;
  expected_category: AgentCategory;
  expected_priority: Priority;
  expected_group: AssigneeGroup;
  // Resolve it from the knowledge base, or hand it to a person.
  expected_action: 'propose' | 'escalate';
  // For an escalation, why. Not required to match exactly (it is judged separately).
  expected_reason?: AgentEscalationReason;
  // The knowledge-base articles that answer it. Empty exactly when the answer is to escalate.
  relevant_kb_ids: string[];
  tags: string[];
  // Earlier tickets from the same requester, so the agent has a history to look at.
  history?: { title: string; status: Status; category: string }[];
}

// One tool call the agent made, from the run's record.
export interface ToolAttempt {
  tool: string;
  isError: boolean;
  dryRun: boolean;
  // The registry's line: "wrong_ticket: ..." for a refusal, what it did otherwise.
  summary: string;
}

// What the agent did with one ticket.
export interface CaseRun {
  id: string;
  // Set when the run itself failed (the model or the system), so there is no decision to score.
  error?: string;
  outcome: AgentOutcome | 'none';
  reason?: string;
  triage?: { category: string; priority: string; assigneeGroup: string };
  proposal?: { citedKbIds: string[]; confidence: string; replyMarkdown: string };
  escalation?: { group: string | undefined; reason: string | undefined };
  toolCalls: ToolAttempt[];
  steps: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  latencyMs: number;
  model: string;
}

export interface Judgement {
  // Whether every step in the reply can be found in the articles it cites. Null: not judged.
  grounded: boolean | null;
  ungroundedSteps: string[];
}

export interface CaseScore {
  id: string;
  tags: string[];
  action: 'propose' | 'escalate' | 'none';
  errored: boolean;
  actionOk: boolean;
  categoryOk: boolean;
  priorityExact: boolean;
  priorityWithinOne: boolean;
  groupOk: boolean;
  // Only for proposals: did it cite only articles that really cover the issue?
  citationValid: boolean | null;
  // Only for escalations with an expected reason.
  reasonOk: boolean | null;
  // Only for tickets tagged security: a ticket that should have been escalated and was not, and one
  // that was escalated but not to the Security Team.
  securityMissed: boolean | null;
  securityMisrouted: boolean | null;
  // Only for tickets tagged injection: did the agent attempt anything out of policy?
  injectionViolation: boolean | null;
  grounded: boolean | null;
}

export interface CaseResult {
  golden: GoldenTicket;
  run: CaseRun;
  score: CaseScore;
}

export interface Rate {
  n: number;
  hits: number;
  // null when there was nothing to measure.
  rate: number | null;
}

export interface Distribution {
  median: number | null;
  p95: number | null;
  total: number;
}

export interface Summary {
  n: number;
  errors: number;
  category: Rate;
  priorityExact: Rate;
  priorityWithinOne: Rate;
  group: Rate;
  action: Rate;
  escalation: { precision: Rate; recall: Rate };
  security: { n: number; missed: number; misrouted: number; recall: Rate };
  citationValidity: Rate;
  groundedness: Rate;
  injection: { n: number; violations: number; resistance: Rate };
  cost: Distribution;
  latencyMs: Distribution;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  // Share of input tokens that were read from the cache.
  cacheReadShare: number | null;
}

// Where the answers came from. Only `live` and `replay` (of a live recording) measure a model.
export type EvalSource = 'live' | 'replay' | 'offline-oracle';

export interface EvalMeta {
  date: string;
  source: EvalSource;
  // False for the offline oracle, which reads the answers and so measures the harness, not a model.
  measured: boolean;
  model: string;
  promptVersion: string;
  dataset: { file: string; total: number; run: number; subset: string };
  // Set if the run was cut short (it reached the spending limit).
  truncated?: string;
}

export interface EvalReport {
  meta: EvalMeta;
  summary: Summary;
  cases: {
    id: string;
    tags: string[];
    expected: {
      action: string;
      category: string;
      priority: string;
      group: string;
      kb: string[];
      reason?: string | undefined;
    };
    actual: CaseRun;
    score: CaseScore;
  }[];
}
