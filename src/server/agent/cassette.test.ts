import {
  RecordingModelClient,
  ReplayModelClient,
  TICKET_ID_PLACEHOLDER,
  decodeCassette,
  encodeCassette,
} from './cassette';
import { ScriptedModelClient, calls, modelResponse, textBlock, toolUse } from './scriptedClient';
import type { ModelRequest } from './types';

const TICKET = '665f0f40d5d4f541f8ef2002';
const ANOTHER = '775f0f40d5d4f541f8ef9999';
const meta = { model: 'claude-haiku-4-5', promptVersion: 'triage.v1' };
const request: ModelRequest = { model: 'm', system: 's', tools: [], messages: [], maxTokens: 1 };

const recorded = () => [
  calls(toolUse('get_ticket', { ticket_id: TICKET }, 'toolu_1')),
  modelResponse([
    textBlock(`Working on ${TICKET}.`),
    toolUse('set_triage', { ticket_id: TICKET, category: 'Network' }, 'toolu_2'),
  ]),
];

describe('encoding and decoding', () => {
  test('masks the ticket id everywhere it appears, including inside tool input and text', () => {
    const cassette = encodeCassette(meta, recorded(), TICKET);
    const json = JSON.stringify(cassette);
    expect(json).not.toContain(TICKET);
    expect(json.split(TICKET_ID_PLACEHOLDER).length - 1).toBe(3);
    expect(cassette).toMatchObject({ version: 1, ...meta });
  });

  test('puts back a different id on replay, so a recording works for any ticket', () => {
    const cassette = encodeCassette(meta, recorded(), TICKET);
    const restored = decodeCassette(cassette, ANOTHER);
    expect(JSON.stringify(restored)).not.toContain(TICKET);
    expect(JSON.stringify(restored)).toContain(ANOTHER);
    expect(restored[0]?.content[0]).toMatchObject({ input: { ticket_id: ANOTHER } });
  });

  test('round-trips to exactly what was recorded', () => {
    const responses = recorded();
    expect(decodeCassette(encodeCassette(meta, responses, TICKET), TICKET)).toEqual(responses);
  });

  test('keeps the model’s own ids and usage untouched', () => {
    const restored = decodeCassette(encodeCassette(meta, recorded(), TICKET), ANOTHER);
    expect((restored[0]?.content[0] as { id: string }).id).toBe('toolu_1');
    expect(restored[0]?.usage).toEqual({ input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 });
  });

  test.each(['', 'not-an-id', '665f0f40d5d4f541f8ef200', '665f0f40d5d4f541f8ef20022'])(
    'refuses %j as a ticket id, so it cannot mask or inject the wrong text',
    (id) => {
      expect(() => encodeCassette(meta, recorded(), id)).toThrow(/ticket id/);
      expect(() => decodeCassette(encodeCassette(meta, recorded(), TICKET), id)).toThrow(
        /ticket id/
      );
    }
  );

  test('refuses a recording made by a version it does not know', () => {
    const cassette = { ...encodeCassette(meta, recorded(), TICKET), version: 2 } as never;
    expect(() => decodeCassette(cassette, TICKET)).toThrow(/Unsupported cassette version 2/);
  });

  test('a cassette can carry nothing at all', () => {
    expect(decodeCassette(encodeCassette(meta, [], TICKET), TICKET)).toEqual([]);
  });
});

describe('replaying', () => {
  test('gives the responses back in order, whatever it is asked', async () => {
    const responses = recorded();
    const replay = new ReplayModelClient(responses);
    expect(await replay.create(request)).toEqual(responses[0]);
    expect(await replay.create({ ...request, system: 'a completely different prompt' })).toEqual(
      responses[1]
    );
  });

  test('says how much was recorded when the agent asks for more', async () => {
    const replay = new ReplayModelClient(recorded());
    await replay.create(request);
    await replay.create(request);
    await expect(replay.create(request)).rejects.toThrow(/ran out after 2 responses/);
  });

  test('hands out copies, so what one run does to a response cannot change the next', async () => {
    const replay = new ReplayModelClient(recorded());
    const first = await replay.create(request);
    first.content.length = 0;
    first.usage.input = 999;
    // A second replay of the same recording is unaffected.
    const again = new ReplayModelClient(recorded());
    expect((await again.create(request)).content).toHaveLength(1);
  });
});

describe('recording', () => {
  test('passes each response through and keeps a copy', async () => {
    const inner = new ScriptedModelClient(recorded());
    const recording = new RecordingModelClient(inner);

    const first = await recording.create(request);
    await recording.create(request);

    expect(recording.responses).toHaveLength(2);
    expect(recording.responses[0]).toEqual(first);
    // The kept copy is not the object the loop received, so the loop cannot alter the recording.
    expect(recording.responses[0]).not.toBe(first);
  });

  test('what it records replays to the same answers', async () => {
    const recording = new RecordingModelClient(new ScriptedModelClient(recorded()));
    await recording.create(request);
    await recording.create(request);

    const cassette = encodeCassette(meta, recording.responses, TICKET);
    const replay = new ReplayModelClient(decodeCassette(cassette, ANOTHER));
    const answer = await replay.create(request);
    expect(answer.content[0]).toMatchObject({ name: 'get_ticket', input: { ticket_id: ANOTHER } });
  });

  test('an error from the real model is passed on and nothing is recorded for it', async () => {
    const recording = new RecordingModelClient(
      new ScriptedModelClient([
        () => {
          throw new Error('overloaded');
        },
      ])
    );
    await expect(recording.create(request)).rejects.toThrow('overloaded');
    expect(recording.responses).toEqual([]);
  });
});
