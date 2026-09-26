import type Anthropic from '@anthropic-ai/sdk';
import { emptyUsage, type TokenUsage } from '../domain/agentPricing';
import type { ModelClient, ModelRequest, ModelResponse } from './types';

// A model that says what it is told to. For the loop's tests, and for checking the evaluation's own
// scoring (the "oracle" that reads the answers). It is not a model and measures nothing about one.

export type ScriptStep =
  | ModelResponse
  | ((request: ModelRequest, callNumber: number) => ModelResponse | Promise<ModelResponse>);

export class ScriptedModelClient implements ModelClient {
  readonly requests: ModelRequest[] = [];
  private readonly steps: ScriptStep[];

  constructor(steps: ScriptStep[]) {
    this.steps = [...steps];
  }

  async create(request: ModelRequest): Promise<ModelResponse> {
    // Copied, so what a test looks at later is what was sent, not what the loop has since changed.
    this.requests.push(structuredClone(request));
    const step = this.steps.shift();
    if (!step)
      throw new Error('The scripted model was asked for more responses than it was given.');
    return typeof step === 'function' ? step(request, this.requests.length) : step;
  }

  get callCount(): number {
    return this.requests.length;
  }
}

// A fixed, small amount of usage, so a scripted run has a cost that can be worked out by hand.
export const SCRIPTED_USAGE: TokenUsage = { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 };

let toolCounter = 0;

export const toolUse = (
  name: string,
  input: Record<string, unknown>,
  id: string = `toolu_scripted_${(toolCounter += 1)}`
): Anthropic.ToolUseBlock => ({ type: 'tool_use', id, name, input }) as Anthropic.ToolUseBlock;

export const textBlock = (text: string): Anthropic.TextBlock =>
  ({ type: 'text', text, citations: null }) as Anthropic.TextBlock;

// A response that calls tools (the model wants their results), or ends the turn.
export const modelResponse = (
  content: Anthropic.ContentBlock[],
  {
    stopReason = content.some((block) => block.type === 'tool_use') ? 'tool_use' : 'end_turn',
    usage = SCRIPTED_USAGE,
  }: { stopReason?: string | null; usage?: TokenUsage } = {}
): ModelResponse => ({ content, stopReason, usage: { ...usage } });

export const calls = (...blocks: Anthropic.ToolUseBlock[]): ModelResponse => modelResponse(blocks);

export const noUsage = emptyUsage;
