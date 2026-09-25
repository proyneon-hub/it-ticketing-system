import {
  agentModes,
  type AgentMode,
  type AgentRunMode,
  type AgentToolTier,
} from '../../shared/agent-constants';

// What the agent is allowed to do. Pure rules: no database, no model. The mode for a ticket comes
// from the settings (a default, with a mode for each category), the kill switch beats all of it,
// and the mode then decides, tool tier by tool tier, whether a tool runs, only pretends to, or is
// refused.

export interface AgentPolicySettings {
  // Stops every run at once, without a deploy.
  killSwitch: boolean;
  defaultMode: AgentMode;
  // A category with an entry here uses it instead of the default. Keys are categories.
  modeByCategory: Record<string, AgentMode>;
  // In auto mode, only these categories may be acted on without a person.
  autoAllowlist: string[];
}

export type Disposition =
  // The tool does what it says.
  | 'run'
  // The tool is recorded as what the agent would have done, and changes nothing.
  | 'dry-run'
  // The tool is not allowed in this mode.
  | 'refuse';

const isAgentMode = (value: unknown): value is AgentMode =>
  (agentModes as readonly unknown[]).includes(value);

// The mode for a ticket in `category`, or `off` if the kill switch is on. Category names are
// matched exactly.
//
// A ticket's category is free text a requester types, so it is never trusted to look anything up:
// only a category the settings really list (an own key, not `constructor` or `toString`) with a
// real mode is used, and everything else gets the default. Without that, a requester could pick a
// category that steers the agent into a mode nobody chose.
export function effectiveMode(settings: AgentPolicySettings, category: string): AgentMode {
  if (settings.killSwitch) return 'off';
  const own = Object.prototype.hasOwnProperty.call(settings.modeByCategory, category)
    ? settings.modeByCategory[category]
    : undefined;
  return isAgentMode(own) ? own : settings.defaultMode;
}

// What happens when a tool of `tier` is called in `mode`.
//
//   shadow: reads run; every write is a dry run, so a shadow run shows what assist or auto would
//           have done, without doing it.
//   assist: reads and low-risk writes (triage, escalation, a draft reply) run. Posting a reply
//           is refused: a person approves those, so the agent must propose or escalate instead.
//   auto:   everything runs. Whether the ticket's category may be acted on without a person is a
//           separate check (mayAct), because it depends on the ticket, not the tool.
export function disposition(mode: AgentRunMode, tier: AgentToolTier): Disposition {
  if (tier === 'read') return 'run';
  switch (mode) {
    case 'shadow':
      return 'dry-run';
    case 'assist':
      return tier === 'write-high' ? 'refuse' : 'run';
    case 'auto':
      return 'run';
    default:
      // Not a mode at all (bad data): fail closed, so a write never runs by accident.
      return 'refuse';
  }
}

// Whether the agent may post a reply on its own for a ticket in `category`. Only in auto mode,
// and only for a category on the allowlist.
export function mayPostAlone(
  settings: Pick<AgentPolicySettings, 'autoAllowlist'>,
  mode: AgentRunMode,
  category: string
): boolean {
  return mode === 'auto' && settings.autoAllowlist.includes(category);
}
