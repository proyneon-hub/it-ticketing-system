import type { ModelClient, ModelRequest, ModelResponse } from './types';

// Recorded model responses, so a test or an evaluation can run the whole agent without the network.
//
// A cassette is the ordered list of responses one run received. It is played back in order,
// whatever the requests are, which is what makes a replay deterministic: it exercises the loop,
// the tools and the scoring against real model output, and says nothing about a prompt that has
// changed since (only a live run can). The ticket's id is different on every run, and the
// model's tool calls carry it, so it is stored as a placeholder and put back on replay.

export const TICKET_ID_PLACEHOLDER = '{{TICKET_ID}}';

export interface Cassette {
  version: 1;
  model: string;
  promptVersion: string;
  responses: ModelResponse[];
}

const ID_PATTERN = /^[a-f\d]{24}$/i;

export function encodeCassette(
  meta: { model: string; promptVersion: string },
  responses: ModelResponse[],
  ticketId: string
): Cassette {
  if (!ID_PATTERN.test(ticketId)) throw new Error('A cassette needs the real ticket id to mask.');
  const masked = JSON.stringify(responses).split(ticketId).join(TICKET_ID_PLACEHOLDER);
  return { version: 1, ...meta, responses: JSON.parse(masked) as ModelResponse[] };
}

export function decodeCassette(cassette: Cassette, ticketId: string): ModelResponse[] {
  if (cassette.version !== 1)
    throw new Error(`Unsupported cassette version ${String(cassette.version)}.`);
  if (!ID_PATTERN.test(ticketId)) throw new Error('A replay needs the real ticket id.');
  const restored = JSON.stringify(cassette.responses).split(TICKET_ID_PLACEHOLDER).join(ticketId);
  return JSON.parse(restored) as ModelResponse[];
}

export class ReplayModelClient implements ModelClient {
  private position = 0;

  constructor(private readonly responses: ModelResponse[]) {}

  async create(_request: ModelRequest): Promise<ModelResponse> {
    const next = this.responses[this.position];
    if (!next) {
      throw new Error(
        `The recording ran out after ${this.responses.length} responses: the agent asked for more than was recorded.`
      );
    }
    this.position += 1;
    return structuredClone(next);
  }
}

// Wraps a real client and keeps every response, to be saved as a cassette afterwards.
export class RecordingModelClient implements ModelClient {
  readonly responses: ModelResponse[] = [];

  constructor(private readonly inner: ModelClient) {}

  async create(request: ModelRequest): Promise<ModelResponse> {
    const response = await this.inner.create(request);
    this.responses.push(structuredClone(response));
    return response;
  }
}
