import type Anthropic from '@anthropic-ai/sdk';
import type { ModelClient, ModelRequest, ModelResponse } from './types';

// The real model. The SDK is loaded on first use, not when the server starts: it costs tens of
// milliseconds, and most requests (every one that is not an agent run) never need it.
//
// The system prompt and the tools are the same for every run, and they come first in the
// request, so a cache breakpoint on the system prompt lets every run after the first read them
// from the cache (a tenth of the price of reading them fresh). Whether it took effect is visible
// in the usage: cacheRead above zero on later calls.

// The one call this makes, as a structure rather than the SDK's class: the SDK ships separate type
// declarations for require and import, so the class loaded lazily below is not nominally the same
// type as the one named here, though it is the same thing.
export interface MessagesClient {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): PromiseLike<Anthropic.Message>;
  };
}

export interface AnthropicClientOptions {
  // Defaults to ANTHROPIC_API_KEY, which the SDK reads itself.
  apiKey?: string;
  // For tests: a stand-in for the SDK's client.
  client?: MessagesClient;
}

export class AnthropicModelClient implements ModelClient {
  private client: MessagesClient | undefined;

  constructor(private readonly options: AnthropicClientOptions = {}) {
    this.client = options.client;
  }

  private async sdk(): Promise<MessagesClient> {
    if (this.client) return this.client;
    const { default: Sdk } = await import('@anthropic-ai/sdk');
    const created = new Sdk(this.options.apiKey ? { apiKey: this.options.apiKey } : {});
    this.client = created as unknown as MessagesClient;
    return this.client;
  }

  async create(request: ModelRequest): Promise<ModelResponse> {
    const client = await this.sdk();
    const response = await client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
      tools: request.tools,
      messages: request.messages,
    });

    return {
      content: response.content,
      stopReason: response.stop_reason,
      usage: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        cacheRead: response.usage.cache_read_input_tokens ?? 0,
        cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

// Whether the real model can be used here: there is a key. The worker checks this before it claims
// an event, so a missing key leaves tickets for people instead of failing every run.
export const hasAnthropicKey = (env: Record<string, string | undefined> = process.env): boolean =>
  Boolean(env.ANTHROPIC_API_KEY?.trim());
