// The service desk agent's vocabulary, shared by the server, the worker and (later) the UI, so a
// value can never be added in one place and forgotten in another.

// How much the agent may do for a category. `off`: nothing. `shadow`: it runs and records what it
// would have done, and changes nothing. `assist`: it triages and drafts, a person approves.
// `auto`: it acts alone, for categories on an allowlist only.
export const agentModes = ['off', 'shadow', 'assist', 'auto'] as const;
export type AgentMode = (typeof agentModes)[number];

// The modes a run can be recorded in (`off` never runs).
export type AgentRunMode = Exclude<AgentMode, 'off'>;

// running: the run is in progress (or its worker died). triaged: it set the triage and stopped.
// proposed: it drafted a reply for a person to approve. posted: it replied itself. escalated:
// it handed the ticket to a person with a summary. aborted: it was stopped on purpose (kill
// switch, a cost limit, a step limit). error: something failed; the ticket stays with people.
export const agentOutcomes = [
  'running',
  'triaged',
  'proposed',
  'posted',
  'escalated',
  'aborted',
  'error',
] as const;
export type AgentOutcome = (typeof agentOutcomes)[number];

// A tool's permission tier. The mode decides which tiers may act (domain/agentPolicy.ts).
export const agentToolTiers = ['read', 'write-low', 'write-draft', 'write-high'] as const;
export type AgentToolTier = (typeof agentToolTiers)[number];

// Why the agent handed a ticket to a person. Recorded with the escalation, and what the
// evaluation checks the agent got right.
export const agentEscalationReasons = [
  'security_incident',
  'hardware_damage',
  'account_access_change',
  'out_of_kb_scope',
  'low_confidence',
  'ambiguous_or_multi_issue',
  'distressed_requester',
  'other',
] as const;
export type AgentEscalationReason = (typeof agentEscalationReasons)[number];

export const agentConfidences = ['low', 'medium', 'high'] as const;
export type AgentConfidence = (typeof agentConfidences)[number];

// The models the agent is priced for. A model not listed here cannot be used, so a typo can
// never make a run look free (see domain/agentPricing.ts).
export const agentModels = ['claude-haiku-4-5', 'claude-sonnet-5'] as const;
export type AgentModel = (typeof agentModels)[number];
