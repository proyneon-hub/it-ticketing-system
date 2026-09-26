import type { AgentConfidence, AgentMode, AgentOutcome, ProposalStatus } from './agent-constants';

// What the agent's endpoints send, as plain data: the shapes the web app reads and the API
// contract (docs, openapi.json) describes.

export interface AgentTriage {
  category: string;
  priority: string;
  assigneeGroup: string;
}

export interface AgentProposal {
  replyMarkdown: string;
  citedKbIds: string[];
  confidence: AgentConfidence;
  reasoningSummary: string;
}

// GET /tickets/:id/proposal
export interface ProposalView {
  status: ProposalStatus;
  runId: string;
  proposal: AgentProposal;
  triage?: AgentTriage | undefined;
  // The cited articles' titles, so the reviewer can see what the reply is based on.
  citedArticles: { id: string; title: string }[];
}

// GET /agent/settings
export interface AgentSettings {
  killSwitch: boolean;
  defaultMode: AgentMode;
  modeByCategory: Record<string, AgentMode>;
  autoAllowlist: string[];
  dailyCostCapUsd: number;
  perRequesterHourlyLimit: number;
  // Whether this deployment has the agent switched on and a key for the model. Not changeable.
  enabled: boolean;
  model: string;
  spentTodayUsd: number;
}

// PUT /agent/settings: only what is sent changes.
export type AgentSettingsChanges = Partial<
  Pick<
    AgentSettings,
    | 'killSwitch'
    | 'defaultMode'
    | 'modeByCategory'
    | 'autoAllowlist'
    | 'dailyCostCapUsd'
    | 'perRequesterHourlyLimit'
  >
>;

// One row of GET /agent/runs.
export interface AgentRunSummary {
  _id: string;
  ticketId: string;
  ticketNumber?: string | undefined;
  mode: 'shadow' | 'assist' | 'auto';
  model: string;
  promptVersion: string;
  outcome: AgentOutcome;
  outcomeReason?: string | undefined;
  attempts: number;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number | undefined;
  costUsd: number;
  latencyMs: number;
  triage?: AgentTriage | undefined;
  hasProposal: boolean;
  startedAt: string;
  finishedAt?: string | undefined;
}

export interface AgentStepRecord {
  attempt: number;
  index: number;
  kind: 'model' | 'tool';
  toolName?: string | undefined;
  input?: string | undefined;
  outputSummary?: string | undefined;
  isError?: boolean | undefined;
  dryRun?: boolean | undefined;
  stopReason?: string | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  latencyMs: number;
}

// GET /agent/runs/:id
export interface AgentRunDetail {
  run: AgentRunSummary & {
    proposal?: AgentProposal | undefined;
    escalationSummary?: string | undefined;
    intendedActions?: { tool: string; summary: string }[] | undefined;
  };
  steps: AgentStepRecord[];
}
