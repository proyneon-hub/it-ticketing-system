import type Anthropic from '@anthropic-ai/sdk';
import type {
  AgentConfidence,
  AgentEscalationReason,
  AgentOutcome,
  AgentRunMode,
} from '../../shared/agent-constants';
import type { KbArticle, KbSearchResult } from '../../shared/kb-types';
import type { AssigneeGroup, AgentCategory, Priority } from '../../shared/ticket-constants';
import type { Comment, Ticket } from '../../shared/ticket-types';
import type { AgentPolicySettings } from '../domain/agentPolicy';
import type { TokenUsage } from '../domain/agentPricing';

// Everything the agent needs from outside is an interface here, and is handed in. The agent never
// imports the database, a repository or a service: it reaches the ticketing system the way a
// person's browser does, through its API, so every write it makes goes through the same
// validation, permissions and concurrency rules (docs/adr/009). Tests give it fakes.

// --- The model -----------------------------------------------------------------------------

export interface ModelRequest {
  model: string;
  system: string;
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  maxTokens: number;
}

export interface ModelResponse {
  content: Anthropic.ContentBlock[];
  // end_turn, tool_use, max_tokens, refusal, ...
  stopReason: string | null;
  usage: TokenUsage;
}

export interface ModelClient {
  create(request: ModelRequest): Promise<ModelResponse>;
}

// --- The ticketing system, through its API --------------------------------------------------

export interface TicketSearch {
  search?: string | undefined;
  requesterEmail?: string | undefined;
  limit?: number | undefined;
}

export interface AgentApi {
  getTicket(id: string): Promise<Ticket>;
  getComments(id: string): Promise<Comment[]>;
  listTickets(query: TicketSearch): Promise<Ticket[]>;
  searchKb(query: {
    search: string;
    category?: AgentCategory | undefined;
    limit?: number | undefined;
  }): Promise<KbSearchResult[]>;
  getKbArticle(id: string): Promise<KbArticle>;
  // Applies the triage to the ticket. A ticket someone else has already assigned keeps its owner.
  // If the ticket changes while this is happening it reads it again and tries once more, and then
  // gives up with an ApiError that says so (409).
  setTriage(id: string, triage: Triage): Promise<void>;
  // Answers the ticket with the reply, without a person approving it first (auto mode). The server
  // decides whether that is allowed and refuses (403) where it is not.
  postResolution(input: {
    ticketId: string;
    replyMarkdown: string;
    citedKbIds: string[];
    confidence: AgentConfidence;
  }): Promise<void>;
  // Hands the ticket to a group, and leaves the summary for whoever picks it up.
  escalate(input: {
    ticketId: string;
    assigneeGroup: AssigneeGroup;
    reason: AgentEscalationReason;
    summary: string;
  }): Promise<void>;
}

// --- Recording ------------------------------------------------------------------------------

export interface StepRecord {
  index: number;
  kind: 'model' | 'tool';
  toolName?: string | undefined;
  // Short summaries, never the ticket's own text.
  input?: string | undefined;
  outputSummary?: string | undefined;
  isError?: boolean | undefined;
  dryRun?: boolean | undefined;
  stopReason?: string | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  latencyMs: number;
}

export interface RunRecorder {
  step(record: StepRecord): Promise<void>;
}

// --- The run --------------------------------------------------------------------------------

export interface Triage {
  category: AgentCategory;
  priority: Priority;
  assigneeGroup: AssigneeGroup;
}

export type DecisionKind = 'proposed' | 'posted' | 'escalated';

export interface Decision {
  kind: DecisionKind;
  proposal?: {
    replyMarkdown: string;
    citedKbIds: string[];
    confidence: AgentConfidence;
    reasoningSummary: string;
  };
  escalationSummary?: string;
  escalationGroup?: AssigneeGroup;
}

export interface IntendedAction {
  tool: string;
  summary: string;
}

// What has happened so far in one run. The registry's checks are made against this.
export interface RunState {
  // What the server knows about the ticket. The model cannot change any of it.
  ticket: { number: string; title: string; category: string; requesterEmail: string };
  // Articles that came back from a search, and articles read in full. A citation must be of an
  // article that was read in full in this run.
  retrievedKb: Set<string>;
  readKb: Set<string>;
  triage?: Triage;
  decision?: Decision;
  intended: IntendedAction[];
  // The categories the agent may act on alone, read from the settings at each step.
  autoAllowlist: string[];
}

export interface RunLimits {
  maxSteps: number;
  // Tokens (all kinds) one run may use before it is stopped and handed to a person.
  maxTokens: number;
  // Reply length the model may write in one call.
  maxOutputTokens: number;
}

export interface RunContext {
  ticketId: string;
  runId: string;
  mode: AgentRunMode;
  model: string;
  // The system prompt, the same for every run (see prompt.ts).
  system: string;
  // The request that created the ticket: passed on to every API call so one id links the chain.
  requestId?: string | undefined;
  api: AgentApi;
  modelClient: ModelClient;
  recorder: RunRecorder;
  limits: RunLimits;
  // Read fresh on every step, so the kill switch stops the next step. Includes the daily cap.
  settings(): Promise<AgentPolicySettings & { dailyCostCapUsd: number }>;
  // What the agent has spent today before this run, in US dollars.
  spentTodayUsd(): Promise<number>;
  now(): number;
}

export interface RunOutcome {
  outcome: Exclude<AgentOutcome, 'running' | 'error'>;
  reason?: string | undefined;
  steps: number;
  usage: TokenUsage;
  costUsd: number;
  latencyMs: number;
  triage?: Triage | undefined;
  proposal?: Decision['proposal'] | undefined;
  escalationSummary?: string | undefined;
  intended: IntendedAction[];
}
