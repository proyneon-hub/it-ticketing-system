import mongoose, { type Model, type Types } from 'mongoose';
import {
  agentConfidences,
  agentOutcomes,
  type AgentConfidence,
  type AgentOutcome,
  type AgentRunMode,
} from '../../shared/agent-constants';

export interface AgentProposal {
  replyMarkdown: string;
  citedKbIds: string[];
  confidence: AgentConfidence;
  reasoningSummary: string;
}

// One record of what the agent decided for a ticket in a shadow run, or would have done.
export interface IntendedAction {
  tool: string;
  // A short summary of the input, never the ticket's own text.
  summary: string;
}

// One run of the agent on one version of one ticket. It holds what the agent decided and what it
// cost, and summaries of its steps live in AgentStep. It deliberately holds no ticket description or
// requester text: the ticket is the source of truth for that.
export interface AgentRunAttrs {
  ticketId: Types.ObjectId;
  ticketVersion: number;
  // "<ticketId>:v<version>": one run per ticket version, so an event delivered twice, or a worker
  // that dies and is retried, cannot process a ticket twice.
  idempotencyKey: string;
  mode: AgentRunMode;
  model: string;
  promptVersion: string;
  outcome: AgentOutcome;
  outcomeReason?: string;
  // How many times this run was started: more than one means an earlier try failed or died.
  attempts: number;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  latencyMs: number;
  // The request that created the ticket, so one id links the ticket, the event and the run.
  requestId?: string;
  // The ticket's number and requester, kept on the run so the runs can be listed, and one person's
  // counted, without reading the tickets.
  ticketNumber?: string;
  requesterEmail?: string;
  triage?: { category: string; priority: string; assigneeGroup: string };
  proposal?: AgentProposal;
  escalationSummary?: string;
  intendedActions: IntendedAction[];
  startedAt: Date;
  finishedAt?: Date;
}

export type AgentRunRecord = AgentRunAttrs & { _id: Types.ObjectId };

const agentRunSchema = new mongoose.Schema<AgentRunAttrs>({
  ticketId: { type: mongoose.Schema.Types.ObjectId, required: true },
  ticketVersion: { type: Number, required: true },
  idempotencyKey: { type: String, required: true, unique: true, maxlength: 80 },
  mode: { type: String, enum: ['shadow', 'assist', 'auto'], required: true },
  model: { type: String, required: true, maxlength: 60 },
  promptVersion: { type: String, required: true, maxlength: 40 },
  outcome: { type: String, enum: agentOutcomes, required: true },
  outcomeReason: { type: String, maxlength: 300 },
  attempts: { type: Number, default: 1, required: true },
  steps: { type: Number, default: 0, required: true },
  inputTokens: { type: Number, default: 0, required: true },
  outputTokens: { type: Number, default: 0, required: true },
  cacheReadTokens: { type: Number, default: 0, required: true },
  cacheWriteTokens: { type: Number, default: 0, required: true },
  costUsd: { type: Number, default: 0, required: true },
  latencyMs: { type: Number, default: 0, required: true },
  requestId: { type: String, maxlength: 64 },
  ticketNumber: { type: String, maxlength: 40 },
  requesterEmail: { type: String, lowercase: true, maxlength: 254 },
  triage: {
    category: { type: String, maxlength: 80 },
    priority: { type: String, maxlength: 20 },
    assigneeGroup: { type: String, maxlength: 80 },
  },
  proposal: {
    replyMarkdown: { type: String, maxlength: 4000 },
    citedKbIds: { type: [String], default: undefined },
    confidence: { type: String, enum: agentConfidences },
    reasoningSummary: { type: String, maxlength: 600 },
  },
  escalationSummary: { type: String, maxlength: 2000 },
  intendedActions: {
    type: [
      {
        tool: { type: String, maxlength: 40 },
        summary: { type: String, maxlength: 500 },
        _id: false,
      },
    ],
    default: [],
  },
  startedAt: { type: Date, required: true },
  finishedAt: { type: Date },
});

// A ticket's runs, newest first (the proposal panel and the admin view read this).
agentRunSchema.index({ ticketId: 1, startedAt: -1 });
// How many runs a requester's tickets have had since a given time (the per-requester limit).
agentRunSchema.index({ requesterEmail: 1, startedAt: -1 });
// What was spent since a given time: the daily cost cap sums over this.
agentRunSchema.index({ startedAt: -1 });

const AgentRun: Model<AgentRunAttrs> =
  (mongoose.models.AgentRun as Model<AgentRunAttrs> | undefined) ||
  mongoose.model<AgentRunAttrs>('AgentRun', agentRunSchema);

export default AgentRun;
