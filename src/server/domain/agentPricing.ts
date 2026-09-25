import type { AgentModel } from '../../shared/agent-constants';

// What a run costs, worked out from the token counts the API reports. Pure, so it can be checked
// against worked examples. Prices are US dollars per million tokens (Anthropic's published rates
// for each model); update them here when they change.
//
// Prompt caching changes what a token costs: a cached read is a tenth of the input price, and
// writing to the cache (five-minute lifetime) is a quarter more than plain input.
export const PRICES: Record<AgentModel, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 2, output: 10 },
};

export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

// The usage the Messages API reports. `input` counts only tokens that were neither read from nor
// written to the cache; those are counted separately.
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const emptyUsage = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

export const isPricedModel = (model: string): model is AgentModel =>
  Object.prototype.hasOwnProperty.call(PRICES, model);

// The cost in US dollars. Throws for a model with no price: a run must never be recorded as free
// because of a typo, since the daily cost cap depends on this number.
export function costUsd(model: string, usage: TokenUsage): number {
  if (!isPricedModel(model)) throw new Error(`No price is known for the model "${model}".`);
  const price = PRICES[model];
  const inputTokens =
    usage.input +
    usage.cacheRead * CACHE_READ_MULTIPLIER +
    usage.cacheWrite * CACHE_WRITE_MULTIPLIER;
  return (inputTokens * price.input + usage.output * price.output) / 1_000_000;
}
