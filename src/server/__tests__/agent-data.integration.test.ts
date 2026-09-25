// The agent's records against a real database: one run per ticket version however many times it is
// started, safe takeover of a run that failed or died, the cost the daily cap is checked against,
// and the settings that decide what the agent may do.
import mongoose from 'mongoose';
import { connectToDatabase } from '../db';
import AgentRun from '../models/AgentRun';
import AgentSettings from '../models/AgentSettings';
import AgentStep from '../models/AgentStep';
import {
  STALE_RUN_MS,
  beginRun,
  costSince,
  finishRun,
  findRun,
  findRunByKey,
  idempotencyKey,
  recordStep,
  stepsForRun,
  type BeginRunInput,
  type RunResult,
} from '../repositories/agentRunRepository';
import { defaultSettings, getSettings, updateSettings } from '../services/agentSettingsService';
import { startTestDatabase, type TestDatabase } from './helpers';

let mongod: TestDatabase;

beforeAll(async () => {
  mongod = await startTestDatabase();
  await connectToDatabase();
  await Promise.all([AgentRun.init(), AgentStep.init(), AgentSettings.init()]);
}, 300000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    AgentRun.deleteMany({}),
    AgentStep.deleteMany({}),
    AgentSettings.deleteMany({}),
  ]);
});

const newTicketId = () => new mongoose.Types.ObjectId();

const input = (overrides: Partial<BeginRunInput> = {}): BeginRunInput => ({
  ticketId: newTicketId(),
  ticketVersion: 0,
  mode: 'shadow',
  model: 'claude-haiku-4-5',
  promptVersion: 'triage.v1',
  ...overrides,
});

const result = (overrides: Partial<RunResult> = {}): RunResult => ({
  outcome: 'triaged',
  steps: 3,
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0.01,
  latencyMs: 900,
  intendedActions: [],
  ...overrides,
});

const started = async (run: BeginRunInput, now?: Date) => {
  const outcome = await beginRun(run, now);
  if (!('started' in outcome)) throw new Error(`expected a run to start, got ${outcome.skipped}`);
  return outcome.started;
};

describe('starting a run', () => {
  test('creates the run for a ticket version, in the running state', async () => {
    const run = input({ requestId: 'req-1' });
    const record = await started(run);

    expect(record).toMatchObject({
      ticketVersion: 0,
      mode: 'shadow',
      model: 'claude-haiku-4-5',
      promptVersion: 'triage.v1',
      outcome: 'running',
      attempts: 1,
      steps: 0,
      costUsd: 0,
      requestId: 'req-1',
      idempotencyKey: `${run.ticketId}:v0`,
    });
    expect(record.finishedAt).toBeUndefined();
  });

  test('the key is the ticket and its version, so a new version is a new run', async () => {
    expect(idempotencyKey('abc', 3)).toBe('abc:v3');
    const ticketId = newTicketId();
    await started(input({ ticketId, ticketVersion: 0 }));
    await started(input({ ticketId, ticketVersion: 1 }));
    expect(await AgentRun.countDocuments({ ticketId })).toBe(2);
  });

  test('asking again while it runs does nothing: another worker is on it', async () => {
    const run = input();
    await started(run);
    expect(await beginRun(run)).toEqual({ skipped: 'in_progress' });
    expect(await AgentRun.countDocuments({ ticketId: run.ticketId })).toBe(1);
  });

  test('asking again after it finished does nothing, whatever the outcome', async () => {
    for (const outcome of ['triaged', 'proposed', 'escalated', 'aborted'] as const) {
      const run = input();
      const record = await started(run);
      await finishRun(record._id, 1, result({ outcome }));
      expect(await beginRun(run)).toEqual({ skipped: 'done' });
    }
  });

  test('five workers starting the same run at once get exactly one', async () => {
    const run = input();
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => beginRun(run)));

    expect(outcomes.filter((outcome) => 'started' in outcome)).toHaveLength(1);
    expect(outcomes.filter((outcome) => 'skipped' in outcome)).toHaveLength(4);
    expect(await AgentRun.countDocuments({ ticketId: run.ticketId })).toBe(1);
  });
});

describe('taking over', () => {
  test('a run that failed can be tried again, counting the attempt and clearing the old result', async () => {
    const run = input();
    const first = await started(run);
    await finishRun(
      first._id,
      1,
      result({
        outcome: 'error',
        outcomeReason: 'the model was unavailable',
        steps: 2,
        costUsd: 0.5,
        triage: { category: 'Network', priority: 'high', assigneeGroup: 'Network Support' },
        escalationSummary: 'old summary',
      })
    );

    const second = await started({ ...run, model: 'claude-sonnet-5', mode: 'assist' });

    expect(second).toMatchObject({
      _id: first._id,
      outcome: 'running',
      attempts: 2,
      steps: 0,
      costUsd: 0,
      model: 'claude-sonnet-5',
      mode: 'assist',
    });
    expect(second.outcomeReason).toBeUndefined();
    expect(second.triage).toBeUndefined();
    expect(second.escalationSummary).toBeUndefined();
    expect(second.finishedAt).toBeUndefined();
    expect(await AgentRun.countDocuments({ ticketId: run.ticketId })).toBe(1);
  });

  test('a run whose worker died is taken over once it has been running too long, and not before', async () => {
    const run = input();
    const now = new Date('2026-09-25T12:00:00Z');
    await started(run, now);

    const justUnder = new Date(now.getTime() + STALE_RUN_MS - 1000);
    expect(await beginRun(run, justUnder)).toEqual({ skipped: 'in_progress' });

    const later = new Date(now.getTime() + STALE_RUN_MS + 1000);
    const taken = await started(run, later);
    expect(taken.attempts).toBe(2);
    expect(taken.startedAt).toEqual(later);
  });

  test('only one of several workers gets to take a failed run over', async () => {
    const run = input();
    const first = await started(run);
    await finishRun(first._id, 1, result({ outcome: 'error' }));

    const outcomes = await Promise.all(Array.from({ length: 5 }, () => beginRun(run)));
    expect(outcomes.filter((outcome) => 'started' in outcome)).toHaveLength(1);
    expect((await findRun(first._id))?.attempts).toBe(2);
  });
});

describe('finishing a run', () => {
  test('records the result and when it finished', async () => {
    const record = await started(input());
    const at = new Date('2026-09-25T12:00:05Z');
    const applied = await finishRun(
      record._id,
      1,
      result({
        outcome: 'proposed',
        steps: 4,
        costUsd: 0.0123,
        triage: { category: 'Network', priority: 'high', assigneeGroup: 'Network Support' },
        proposal: {
          replyMarkdown: 'Try the steps in KB-006.',
          citedKbIds: ['KB-006'],
          confidence: 'high',
          reasoningSummary: 'The article covers it.',
        },
        intendedActions: [{ tool: 'set_triage', summary: 'Network / high' }],
      }),
      at
    );

    expect(applied).toBe(true);
    expect(await findRun(record._id)).toMatchObject({
      outcome: 'proposed',
      steps: 4,
      costUsd: 0.0123,
      finishedAt: at,
      triage: { category: 'Network', priority: 'high', assigneeGroup: 'Network Support' },
      proposal: { citedKbIds: ['KB-006'], confidence: 'high' },
      intendedActions: [{ tool: 'set_triage', summary: 'Network / high' }],
    });
  });

  test('applies once: a second finish does not overwrite the first', async () => {
    const record = await started(input());
    expect(await finishRun(record._id, 1, result({ outcome: 'escalated' }))).toBe(true);
    expect(await finishRun(record._id, 1, result({ outcome: 'triaged' }))).toBe(false);
    expect((await findRun(record._id))?.outcome).toBe('escalated');
  });

  test('a worker that was taken over cannot overwrite the newer attempt', async () => {
    const run = input();
    const first = await started(run);
    await finishRun(first._id, 1, result({ outcome: 'error' }));
    const second = await started(run);

    // The first attempt's worker wakes up late and tries to record its result.
    expect(await finishRun(second._id, 1, result({ outcome: 'triaged', costUsd: 9 }))).toBe(false);
    const stored = await findRun(second._id);
    expect(stored?.outcome).toBe('running');
    expect(stored?.costUsd).toBe(0);

    expect(await finishRun(second._id, 2, result({ outcome: 'triaged' }))).toBe(true);
  });

  test('cuts a long reason down to what the record allows', async () => {
    const record = await started(input());
    await finishRun(record._id, 1, result({ outcome: 'error', outcomeReason: 'x'.repeat(1000) }));
    expect((await findRun(record._id))?.outcomeReason).toHaveLength(300);
  });
});

describe('steps', () => {
  test('are kept in order, by attempt and then position', async () => {
    const record = await started(input());
    const base = { runId: record._id, latencyMs: 5 };
    await recordStep({ ...base, attempt: 1, index: 1, kind: 'tool', toolName: 'search_kb' });
    await recordStep({ ...base, attempt: 1, index: 0, kind: 'model', inputTokens: 10 });
    await recordStep({ ...base, attempt: 2, index: 0, kind: 'model' });

    const steps = await stepsForRun(record._id);
    expect(steps.map((step) => [step.attempt, step.index, step.kind])).toEqual([
      [1, 0, 'model'],
      [1, 1, 'tool'],
      [2, 0, 'model'],
    ]);
  });

  test('cut long summaries down rather than storing a ticket’s text', async () => {
    const record = await started(input());
    await expect(
      recordStep({
        runId: record._id,
        attempt: 1,
        index: 0,
        kind: 'tool',
        latencyMs: 1,
        input: 'x'.repeat(501),
      })
    ).rejects.toThrow(/longer than the maximum/);
  });

  test('expire after the retention period, while the run itself is kept', async () => {
    const indexes = await AgentStep.collection.indexes();
    const ttl = indexes.find((index) => index.expireAfterSeconds !== undefined);
    expect(ttl?.key).toEqual({ createdAt: 1 });
    expect(ttl?.expireAfterSeconds).toBe(30 * 86400);

    const runIndexes = await AgentRun.collection.indexes();
    expect(runIndexes.some((index) => index.expireAfterSeconds !== undefined)).toBe(false);
  });
});

describe('the indexes', () => {
  test('a run’s key is unique in the database, not only in the code', async () => {
    const indexes = await AgentRun.collection.indexes();
    const unique = indexes.find((index) => index.key?.idempotencyKey === 1);
    expect(unique?.unique).toBe(true);

    const record = await started(input());
    await expect(
      AgentRun.collection.insertOne({ idempotencyKey: record.idempotencyKey })
    ).rejects.toMatchObject({ code: 11000 });
  });

  test('a run is found by its key', async () => {
    const run = input();
    const record = await started(run);
    expect((await findRunByKey(record.idempotencyKey))?._id).toEqual(record._id);
    expect(await findRunByKey('nope:v0')).toBeNull();
  });
});

describe('what has been spent', () => {
  test('sums the cost of runs since a time, and only those', async () => {
    const since = new Date('2026-09-25T00:00:00Z');
    const day = (hour: number) => new Date(`2026-09-25T${String(hour).padStart(2, '0')}:00:00Z`);
    const yesterday = new Date('2026-09-24T23:00:00Z');

    for (const [when, cost] of [
      [yesterday, 5],
      [day(1), 0.25],
      [day(9), 0.5],
    ] as const) {
      const record = await started(input(), when);
      await finishRun(record._id, 1, result({ costUsd: cost }));
    }

    expect(await costSince(since)).toBeCloseTo(0.75, 10);
    expect(await costSince(day(5))).toBeCloseTo(0.5, 10);
    expect(await costSince(new Date('2026-09-26T00:00:00Z'))).toBe(0);
  });

  test('a run still in progress counts as nothing yet, and nothing spent is zero', async () => {
    expect(await costSince(new Date(0))).toBe(0);
    await started(input());
    expect(await costSince(new Date(0))).toBe(0);
  });
});

describe('the settings', () => {
  test('are shadow mode with nothing allowed to act alone, when nothing is stored', async () => {
    expect(await getSettings({})).toEqual({
      killSwitch: false,
      defaultMode: 'shadow',
      modeByCategory: {},
      autoAllowlist: [],
      dailyCostCapUsd: 1,
    });
  });

  test('can start elsewhere through the environment, and ignore a value that makes no sense', () => {
    expect(
      defaultSettings({ AGENT_DEFAULT_MODE: 'assist', AGENT_DAILY_COST_CAP_USD: '0.5' })
    ).toMatchObject({
      defaultMode: 'assist',
      dailyCostCapUsd: 0.5,
    });
    expect(defaultSettings({ AGENT_DEFAULT_MODE: ' AUTO ' }).defaultMode).toBe('auto');
    expect(defaultSettings({ AGENT_DAILY_COST_CAP_USD: '0' }).dailyCostCapUsd).toBe(0);

    for (const bad of ['yolo', '', 'constructor']) {
      expect(defaultSettings({ AGENT_DEFAULT_MODE: bad }).defaultMode).toBe('shadow');
    }
    for (const bad of ['', ' ', 'abc', '-3', 'Infinity']) {
      expect(defaultSettings({ AGENT_DAILY_COST_CAP_USD: bad }).dailyCostCapUsd).toBe(1);
    }
  });

  test('what is stored wins over the defaults, field by field', async () => {
    await updateSettings({ defaultMode: 'assist', dailyCostCapUsd: 2.5 }, 'admin@demo.local');
    await updateSettings(
      { modeByCategory: { Email: 'auto' }, autoAllowlist: ['Email'] },
      'admin@demo.local'
    );

    expect(await getSettings({})).toEqual({
      killSwitch: false,
      defaultMode: 'assist',
      modeByCategory: { Email: 'auto' },
      autoAllowlist: ['Email'],
      dailyCostCapUsd: 2.5,
    });
    expect((await AgentSettings.findById('agent'))?.updatedBy).toBe('admin@demo.local');
  });

  test('the kill switch takes effect on the very next read, with no cache in between', async () => {
    expect((await getSettings({})).killSwitch).toBe(false);
    await updateSettings({ killSwitch: true }, 'admin@demo.local');
    expect((await getSettings({})).killSwitch).toBe(true);
    await updateSettings({ killSwitch: false }, 'admin@demo.local');
    expect((await getSettings({})).killSwitch).toBe(false);
  });

  test('anything in the database that is not what it should be is ignored, not obeyed', async () => {
    await AgentSettings.collection.insertOne({
      _id: 'agent' as never,
      killSwitch: 'true',
      defaultMode: 'yolo',
      modeByCategory: { Email: 'yolo', Network: 'auto', Access: 7 },
      autoAllowlist: ['Email', 42, null, 'Software'],
      dailyCostCapUsd: -5,
    });

    expect(await getSettings({})).toEqual({
      killSwitch: false,
      defaultMode: 'shadow',
      modeByCategory: { Network: 'auto' },
      autoAllowlist: ['Email', 'Software'],
      dailyCostCapUsd: 1,
    });
  });

  test('a stored list that is not a list, or a map that is not a map, is ignored', async () => {
    await AgentSettings.collection.insertOne({
      _id: 'agent' as never,
      modeByCategory: ['Email', 'auto'],
      autoAllowlist: 'Email',
    });
    const settings = await getSettings({});
    expect(settings.modeByCategory).toEqual({});
    expect(settings.autoAllowlist).toEqual([]);
  });

  describe('changing them', () => {
    test.each([
      [{ modeByCategory: { Endpoint: 'auto' as const } }, /"Endpoint" is not a category/],
      [{ modeByCategory: { constructor: 'auto' as const } }, /not a category/],
      [{ modeByCategory: { Email: 'yolo' as never } }, /the mode must be/],
      [{ autoAllowlist: ['Email', 'Nope'] }, /"Nope" is not a category/],
      [{ defaultMode: 'yolo' as never }, /defaultMode must be/],
      [{ dailyCostCapUsd: -1 }, /zero or more/],
      [{ dailyCostCapUsd: Number.NaN }, /zero or more/],
    ])('refuses %j', async (changes, message) => {
      await expect(updateSettings(changes, 'admin@demo.local')).rejects.toThrow(message);
      expect(await AgentSettings.countDocuments()).toBe(0);
    });

    test('a refused change leaves the earlier settings as they were', async () => {
      await updateSettings({ defaultMode: 'assist' }, 'admin@demo.local');
      await expect(
        updateSettings({ defaultMode: 'auto', autoAllowlist: ['Nope'] }, 'admin@demo.local')
      ).rejects.toThrow();
      expect((await getSettings({})).defaultMode).toBe('assist');
    });

    test('changes only what it was given', async () => {
      await updateSettings({ defaultMode: 'assist', autoAllowlist: ['Email'] }, 'a@demo.local');
      await updateSettings({ dailyCostCapUsd: 3 }, 'b@demo.local');
      expect(await getSettings({})).toMatchObject({
        defaultMode: 'assist',
        autoAllowlist: ['Email'],
        dailyCostCapUsd: 3,
      });
      expect((await AgentSettings.findById('agent'))?.updatedBy).toBe('b@demo.local');
    });
  });
});
