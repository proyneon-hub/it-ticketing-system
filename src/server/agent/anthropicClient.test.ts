import type Anthropic from '@anthropic-ai/sdk';
import { AnthropicModelClient, hasAnthropicKey, type MessagesClient } from './anthropicClient';
import type { ModelRequest } from './types';

// The real model is not called here (there is no key in a test run). What is checked is what the
// client sends, and how it reads the answer, against a stand-in for the SDK's client.

const request: ModelRequest = {
  model: 'claude-sonnet-5',
  system: 'You are the service desk agent.',
  tools: [{ name: 'get_ticket', description: 'd', input_schema: { type: 'object' } }],
  messages: [{ role: 'user', content: 'hello' }],
  maxTokens: 2048,
};

const message = (overrides: Partial<Anthropic.Message> = {}): Anthropic.Message =>
  ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content: [{ type: 'text', text: 'hi', citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 120, output_tokens: 30 },
    ...overrides,
  }) as Anthropic.Message;

const stub = (reply: Anthropic.Message = message()) => {
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = {
    messages: {
      async create(params) {
        sent.push(params);
        return reply;
      },
    },
  };
  return { client, sent };
};

describe('what is sent', () => {
  test('the model, the tools, the messages and the output limit are passed through as they are', async () => {
    const { client, sent } = stub();
    await new AnthropicModelClient({ client }).create(request);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      model: 'claude-sonnet-5',
      max_tokens: 2048,
      tools: request.tools,
      messages: request.messages,
    });
  });

  test('the system prompt is one block marked for caching, so later runs read it from the cache', async () => {
    const { client, sent } = stub();
    await new AnthropicModelClient({ client }).create(request);
    expect(sent[0]?.system).toEqual([
      {
        type: 'text',
        text: 'You are the service desk agent.',
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });

  test('sets nothing that a model does not accept: no sampling, no thinking budget, no prefill', async () => {
    const { client, sent } = stub();
    await new AnthropicModelClient({ client }).create(request);
    const body = sent[0] as unknown as Record<string, unknown>;
    for (const key of [
      'temperature',
      'top_p',
      'top_k',
      'thinking',
      'budget_tokens',
      'tool_choice',
    ]) {
      expect(body).not.toHaveProperty(key);
    }
    expect(request.messages.at(-1)?.role).toBe('user');
  });
});

describe('what is read', () => {
  test('the content and the reason it stopped are kept exactly', async () => {
    const reply = message({
      content: [
        { type: 'text', text: 'Looking.', citations: null },
        { type: 'tool_use', id: 'toolu_1', name: 'get_ticket', input: { ticket_id: 'x' } },
      ] as Anthropic.ContentBlock[],
      stop_reason: 'tool_use',
    });
    const answer = await new AnthropicModelClient({ client: stub(reply).client }).create(request);
    expect(answer.content).toEqual(reply.content);
    expect(answer.stopReason).toBe('tool_use');
  });

  test('a refusal is passed on as the stop reason, for the loop to act on', async () => {
    const answer = await new AnthropicModelClient({
      client: stub(message({ stop_reason: 'refusal' as never })).client,
    }).create(request);
    expect(answer.stopReason).toBe('refusal');
  });

  test('counts plain, cached-read and cache-written input separately', async () => {
    const reply = message({
      usage: {
        input_tokens: 200,
        output_tokens: 40,
        cache_read_input_tokens: 3000,
        cache_creation_input_tokens: 1000,
      } as Anthropic.Usage,
    });
    const answer = await new AnthropicModelClient({ client: stub(reply).client }).create(request);
    expect(answer.usage).toEqual({ input: 200, output: 40, cacheRead: 3000, cacheWrite: 1000 });
  });

  test('cache counts that are missing or null are zero, not NaN', async () => {
    const reply = message({
      usage: {
        input_tokens: 5,
        output_tokens: 1,
        cache_read_input_tokens: null,
        cache_creation_input_tokens: null,
      } as Anthropic.Usage,
    });
    const answer = await new AnthropicModelClient({ client: stub(reply).client }).create(request);
    expect(answer.usage).toEqual({ input: 5, output: 1, cacheRead: 0, cacheWrite: 0 });
  });

  test('an error from the API is passed on, for the worker to retry', async () => {
    const client: MessagesClient = {
      messages: {
        create() {
          return Promise.reject(new Error('529 overloaded'));
        },
      },
    };
    await expect(new AnthropicModelClient({ client }).create(request)).rejects.toThrow(
      '529 overloaded'
    );
  });
});

describe('hasAnthropicKey', () => {
  test.each([
    [{ ANTHROPIC_API_KEY: 'sk-ant-abc' }, true],
    [{ ANTHROPIC_API_KEY: '  sk-ant-abc  ' }, true],
    [{ ANTHROPIC_API_KEY: '' }, false],
    [{ ANTHROPIC_API_KEY: '   ' }, false],
    [{}, false],
  ])('%j is %s', (env, expected) => {
    expect(hasAnthropicKey(env)).toBe(expected);
  });
});
