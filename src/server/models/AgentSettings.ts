import mongoose, { type Model } from 'mongoose';
import { agentModes, type AgentMode } from '../../shared/agent-constants';

// The one document that says what the agent may do. It is read on every step of a run, so the
// kill switch works without a deploy. Only fields that have been set are stored: anything missing
// falls back to a default (see agentSettingsService), so a fresh database needs no seeding and
// the agent starts in shadow mode.
export interface AgentSettingsAttrs {
  _id: string;
  killSwitch?: boolean;
  defaultMode?: AgentMode;
  // A mode for a category, in place of the default. Keys are category names.
  modeByCategory?: Record<string, AgentMode>;
  // In auto mode, only these categories may be acted on without a person.
  autoAllowlist?: string[];
  dailyCostCapUsd?: number;
  // The most runs one requester's tickets may have in an hour; past it, tickets wait for a person.
  perRequesterHourlyLimit?: number;
  updatedAt?: Date;
  updatedBy?: string;
}

// There is exactly one, under this id.
export const AGENT_SETTINGS_ID = 'agent';

const agentSettingsSchema = new mongoose.Schema<AgentSettingsAttrs>({
  _id: { type: String, required: true },
  killSwitch: { type: Boolean },
  defaultMode: { type: String, enum: agentModes },
  modeByCategory: { type: mongoose.Schema.Types.Mixed },
  autoAllowlist: { type: [String], default: undefined },
  dailyCostCapUsd: { type: Number, min: 0 },
  perRequesterHourlyLimit: { type: Number, min: 0 },
  updatedAt: { type: Date },
  updatedBy: { type: String, maxlength: 254 },
});

const AgentSettings: Model<AgentSettingsAttrs> =
  (mongoose.models.AgentSettings as Model<AgentSettingsAttrs> | undefined) ||
  mongoose.model<AgentSettingsAttrs>('AgentSettings', agentSettingsSchema);

export default AgentSettings;
