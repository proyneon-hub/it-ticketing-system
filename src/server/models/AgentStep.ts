import mongoose, { type Model, type Types } from 'mongoose';

export interface AgentStepAttrs {
  runId: Types.ObjectId;
  // Which try of the run this belongs to (a retried run keeps the history of its earlier tries).
  attempt: number;
  index: number;
  // A call to the model, or a call to a tool.
  kind: 'model' | 'tool';
  toolName?: string;
  // Short summaries, cut to a fixed length. Never the ticket's own text.
  input?: string;
  outputSummary?: string;
  isError?: boolean;
  // A tool call that was only recorded (shadow mode), not carried out.
  dryRun?: boolean;
  stopReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  createdAt: Date;
}

export type AgentStepRecord = AgentStepAttrs & { _id: Types.ObjectId };

const agentStepSchema = new mongoose.Schema<AgentStepAttrs>({
  runId: { type: mongoose.Schema.Types.ObjectId, required: true },
  attempt: { type: Number, required: true },
  index: { type: Number, required: true },
  kind: { type: String, enum: ['model', 'tool'], required: true },
  toolName: { type: String, maxlength: 40 },
  input: { type: String, maxlength: 500 },
  outputSummary: { type: String, maxlength: 500 },
  isError: { type: Boolean },
  dryRun: { type: Boolean },
  stopReason: { type: String, maxlength: 40 },
  inputTokens: { type: Number },
  outputTokens: { type: Number },
  latencyMs: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now, required: true },
});

// A run's steps in the order they happened.
agentStepSchema.index({ runId: 1, attempt: 1, index: 1 });
// Steps are an audit trail, not a permanent record: they expire after AGENT_STEP_RETENTION_DAYS
// (default 30). The run itself, with its outcome and cost, is kept. Changing this later needs
// `npm run db:sync-indexes`.
const retentionDays = Number(process.env.AGENT_STEP_RETENTION_DAYS) || 30;
agentStepSchema.index({ createdAt: 1 }, { expireAfterSeconds: Math.round(retentionDays * 86400) });

const AgentStep: Model<AgentStepAttrs> =
  (mongoose.models.AgentStep as Model<AgentStepAttrs> | undefined) ||
  mongoose.model<AgentStepAttrs>('AgentStep', agentStepSchema);

export default AgentStep;
