import fs from 'fs';
import path from 'path';
import { agentCategories, assigneeGroups, slaHoursByPriority } from '../../shared/ticket-constants';

// The system prompt is a versioned file (prompts/triage.v1.md) so a change to it is reviewed like
// code, and every run records which version produced it. The lists in it (categories, groups and
// service levels) are not typed into the file: they are filled in from the same constants the
// tools and the API validate against, so the prompt can never name a category the code rejects.

export interface Prompt {
  // The file's name without its extension, such as "triage.v1". Recorded on every run.
  version: string;
  text: string;
}

export const DEFAULT_PROMPT = 'triage.v1';

// Relative to the working directory, like the built client and the knowledge base, because the
// compiled server lives in dist-server/. AGENT_PROMPT_DIR overrides it.
export const defaultPromptDir = (): string =>
  process.env.AGENT_PROMPT_DIR || path.join(process.cwd(), 'prompts');

const list = (items: readonly string[]): string => items.join(', ');

const slaTable = (): string =>
  (Object.entries(slaHoursByPriority) as [string, number][])
    .map(([priority, hours]) => `${priority} ${hours} hours`)
    .join(', ');

const PLACEHOLDERS: Record<string, () => string> = {
  CATEGORIES: () => list(agentCategories),
  ASSIGNEE_GROUPS: () => list(assigneeGroups),
  SLA_TABLE: slaTable,
};

// Fills in the placeholders. Throws on one it does not know, so a typo in the file is found
// when the prompt loads, not when the model reads "{{CATEGORYS}}".
export function renderPrompt(template: string): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_match, name: string) => {
    const fill = PLACEHOLDERS[name];
    if (!fill) throw new Error(`The prompt uses an unknown placeholder {{${name}}}.`);
    return fill();
  });
}

export function loadPrompt(
  version: string = DEFAULT_PROMPT,
  dir: string = defaultPromptDir()
): Prompt {
  if (!/^[a-z0-9.-]+$/.test(version))
    throw new Error(`"${version}" is not a valid prompt version.`);
  const template = fs.readFileSync(path.join(dir, `${version}.md`), 'utf8').replace(/\r\n?/g, '\n');
  return { version, text: renderPrompt(template).trim() };
}
