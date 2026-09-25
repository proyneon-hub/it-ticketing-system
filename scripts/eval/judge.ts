import type { ModelClient } from '../../src/server/agent/types';
import type { Judgement } from './types';

// Groundedness: can every step in a proposed reply be found in the articles it cites? A model grades
// this, against a rubric, because matching wording is not enough (a step can be paraphrased) and
// reading 30 replies by hand for every run is not practical. The grader is itself a model, so its
// verdicts are checked: twenty replies are also read by a person (eval/hand-checks.md), and the two are
// compared before the number is trusted.

const RUBRIC = `You check whether a support reply is grounded in the knowledge-base articles it cites.

You are given a reply written for a person who raised an IT ticket, and the full text of each article the reply cites.

Go through the reply and list every instruction, step, setting, menu name, address, limit, policy or promise it contains. A step is GROUNDED if the cited articles say it, in the same words or clearly the same meaning. It is UNGROUNDED if no cited article says it, if it contradicts an article, or if it adds a specific detail an article does not contain. General courtesy (a greeting, "let us know if it continues") is not a step and is ignored.

Answer with JSON only, in exactly this shape and nothing else:
{"grounded": true|false, "ungrounded_steps": ["short quote of each ungrounded step"]}

"grounded" is true only if there are no ungrounded steps.`;

export interface JudgeInput {
  reply: string;
  articles: { id: string; body: string }[];
}

// The first JSON object in the text, or null. Models sometimes wrap it in a sentence or a code fence.
function firstJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function judgeGroundedness(
  client: ModelClient,
  model: string,
  input: JudgeInput
): Promise<Judgement> {
  const articles = input.articles.map((a) => `## ${a.id}\n${a.body}`).join('\n\n');
  const response = await client.create({
    model,
    system: RUBRIC,
    tools: [],
    messages: [
      {
        role: 'user',
        content: `# Reply\n${input.reply}\n\n# Cited articles\n${articles || '(none)'}`,
      },
    ],
    maxTokens: 800,
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { text: string }).text)
    .join('\n');
  const parsed = firstJsonObject(text) as { grounded?: unknown; ungrounded_steps?: unknown } | null;

  // An answer that is not the shape asked for is "not judged", never a guess in either direction.
  if (!parsed || typeof parsed.grounded !== 'boolean')
    return { grounded: null, ungroundedSteps: [] };
  const steps = Array.isArray(parsed.ungrounded_steps)
    ? parsed.ungrounded_steps.filter((step): step is string => typeof step === 'string')
    : [];
  // Consistent with its own list: it cannot call a reply grounded and list an ungrounded step.
  return { grounded: parsed.grounded && steps.length === 0, ungroundedSteps: steps };
}
