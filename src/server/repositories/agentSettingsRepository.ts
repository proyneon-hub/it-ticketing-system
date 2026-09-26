import AgentSettings, { AGENT_SETTINGS_ID, type AgentSettingsAttrs } from '../models/AgentSettings';

// The only module that talks to Mongoose about the agent's settings.

export type { AgentSettingsAttrs };

// What is stored, or null on a database where nothing has been set yet.
export const read = (): Promise<AgentSettingsAttrs | null> =>
  AgentSettings.findById(AGENT_SETTINGS_ID).lean<AgentSettingsAttrs>();

// Sets the given fields, creating the document if there is none, and leaves the rest as they
// were. Returns what is stored afterwards.
export async function write(
  changes: Partial<Omit<AgentSettingsAttrs, '_id' | 'updatedAt' | 'updatedBy'>>,
  updatedBy: string,
  now: Date = new Date()
): Promise<AgentSettingsAttrs> {
  const stored = await AgentSettings.findByIdAndUpdate(
    AGENT_SETTINGS_ID,
    { $set: { ...changes, updatedAt: now, updatedBy } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean<AgentSettingsAttrs>();
  return stored as AgentSettingsAttrs;
}
