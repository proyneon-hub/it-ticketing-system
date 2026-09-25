import { agentModes, type AgentMode } from '../../shared/agent-constants';
import { agentCategories } from '../../shared/ticket-constants';
import type { AgentPolicySettings } from '../domain/agentPolicy';
import { ValidationError } from '../errors';
import * as repository from '../repositories/agentSettingsRepository';

// What the agent may do right now. Read on every step of a run, straight from the database and
// with no cache, so flipping the kill switch stops the next step and not the next deploy or the
// next cache expiry. It is one small document, cheap next to a call to the model.

export interface AgentSettingsValues extends AgentPolicySettings {
  // The most the agent may spend in a day, in US dollars. Runs are refused once it is reached.
  dailyCostCapUsd: number;
  // The most runs one requester's tickets may have in an hour. Past it, the ticket goes to a person.
  // Zero means none are run.
  perRequesterHourlyLimit: number;
}

export const DEFAULT_PER_REQUESTER_HOURLY_LIMIT = 5;

type Env = Record<string, string | undefined>;

const isMode = (value: unknown): value is AgentMode =>
  (agentModes as readonly unknown[]).includes(value);

// What applies when nothing has been stored: shadow mode with nothing allowed to act alone. Two
// environment variables can move the starting point (AGENT_DEFAULT_MODE, AGENT_DAILY_COST_CAP_USD),
// for a deployment that wants a different default before anyone has opened the settings.
export function defaultSettings(env: Env = process.env): AgentSettingsValues {
  const mode = env.AGENT_DEFAULT_MODE?.trim().toLowerCase();
  const cap = Number(env.AGENT_DAILY_COST_CAP_USD);
  return {
    killSwitch: false,
    defaultMode: isMode(mode) ? mode : 'shadow',
    modeByCategory: {},
    autoAllowlist: [],
    dailyCostCapUsd:
      env.AGENT_DAILY_COST_CAP_USD?.trim() && Number.isFinite(cap) && cap >= 0 ? cap : 1,
    perRequesterHourlyLimit: DEFAULT_PER_REQUESTER_HOURLY_LIMIT,
  };
}

// The stored value over the defaults. Anything in the database that is not what it should be
// (a mode that is not a mode, a cap that is not a number) is ignored and the default used, so a
// bad edit cannot switch the agent into a mode nobody chose.
export async function getSettings(env: Env = process.env): Promise<AgentSettingsValues> {
  const defaults = defaultSettings(env);
  const stored = await repository.read();
  if (!stored) return defaults;

  const modeByCategory: Record<string, AgentMode> = {};
  const listed = stored.modeByCategory;
  if (listed && typeof listed === 'object' && !Array.isArray(listed)) {
    for (const [category, mode] of Object.entries(listed)) {
      if (isMode(mode)) modeByCategory[category] = mode;
    }
  }

  return {
    killSwitch: stored.killSwitch === true,
    defaultMode: isMode(stored.defaultMode) ? stored.defaultMode : defaults.defaultMode,
    modeByCategory,
    autoAllowlist: Array.isArray(stored.autoAllowlist)
      ? stored.autoAllowlist.filter((item): item is string => typeof item === 'string')
      : defaults.autoAllowlist,
    dailyCostCapUsd:
      typeof stored.dailyCostCapUsd === 'number' &&
      Number.isFinite(stored.dailyCostCapUsd) &&
      stored.dailyCostCapUsd >= 0
        ? stored.dailyCostCapUsd
        : defaults.dailyCostCapUsd,
    perRequesterHourlyLimit:
      typeof stored.perRequesterHourlyLimit === 'number' &&
      Number.isInteger(stored.perRequesterHourlyLimit) &&
      stored.perRequesterHourlyLimit >= 0
        ? stored.perRequesterHourlyLimit
        : defaults.perRequesterHourlyLimit,
  };
}

export interface SettingsChanges {
  killSwitch?: boolean;
  defaultMode?: AgentMode;
  modeByCategory?: Record<string, AgentMode>;
  autoAllowlist?: string[];
  dailyCostCapUsd?: number;
  perRequesterHourlyLimit?: number;
}

// Validates and stores changes to the settings. Only categories the agent can choose from may be
// given a mode or put on the allowlist, and a cap must be a real, non-negative amount.
export async function updateSettings(
  changes: SettingsChanges,
  updatedBy: string
): Promise<AgentSettingsValues> {
  const known = agentCategories as readonly string[];

  if (changes.defaultMode !== undefined && !isMode(changes.defaultMode)) {
    throw new ValidationError('defaultMode must be off, shadow, assist or auto.');
  }
  for (const [category, mode] of Object.entries(changes.modeByCategory ?? {})) {
    if (!known.includes(category)) throw new ValidationError(`"${category}" is not a category.`);
    if (!isMode(mode))
      throw new ValidationError(`${category}: the mode must be off, shadow, assist or auto.`);
  }
  for (const category of changes.autoAllowlist ?? []) {
    if (!known.includes(category)) throw new ValidationError(`"${category}" is not a category.`);
  }
  if (
    changes.dailyCostCapUsd !== undefined &&
    !(Number.isFinite(changes.dailyCostCapUsd) && changes.dailyCostCapUsd >= 0)
  ) {
    throw new ValidationError('dailyCostCapUsd must be zero or more.');
  }
  if (
    changes.perRequesterHourlyLimit !== undefined &&
    !(Number.isInteger(changes.perRequesterHourlyLimit) && changes.perRequesterHourlyLimit >= 0)
  ) {
    throw new ValidationError('perRequesterHourlyLimit must be a whole number, zero or more.');
  }

  await repository.write(changes, updatedBy);
  return getSettings();
}
