import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { AddressInfo } from 'net';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { AnthropicModelClient, hasAnthropicKey } from '../src/server/agent/anthropicClient';
import {
  RecordingModelClient,
  ReplayModelClient,
  decodeCassette,
  encodeCassette,
  type Cassette,
} from '../src/server/agent/cassette';
import { DEFAULT_PROMPT, loadPrompt } from '../src/server/agent/prompt';
import { ScriptedModelClient } from '../src/server/agent/scriptedClient';
import type { ModelClient } from '../src/server/agent/types';
import { isPricedModel } from '../src/server/domain/agentPricing';
import app from '../src/server/app';
import { connectToDatabase } from '../src/server/db';
import { logger } from '../src/server/logger';
import { loadArticles } from '../src/server/kbLoader';
import AgentRun from '../src/server/models/AgentRun';
import AgentSettings from '../src/server/models/AgentSettings';
import AgentStep from '../src/server/models/AgentStep';
import KbArticle from '../src/server/models/KbArticle';
import OutboxEvent from '../src/server/models/OutboxEvent';
import Ticket from '../src/server/models/Ticket';
import { DEFAULT_MODEL } from '../src/server/services/agentWorkerService';
import { importArticles } from '../src/server/services/kbService';
import { loadSmokeIds, loadTickets, selectTickets } from './eval/dataset';
import { judgeGroundedness } from './eval/judge';
import { oracleScript } from './eval/oracle';
import { historyRow, renderMarkdown, summaryLine } from './eval/report';
import { runEvaluation } from './eval/run';
import { assertLocalDatabase, keyFromEnvFile } from './eval/safety';
import { summarize } from './eval/score';
import type { EvalReport, EvalSource } from './eval/types';

// Runs the service desk agent against the golden tickets and scores it (docs/EVAL_HISTORY.md).
//
//   npm run eval                              live: the real model, all 108 tickets (needs ANTHROPIC_API_KEY)
//   npm run eval -- --subset smoke            the small set that runs on every change
//   npm run eval -- --offline                 no model: the oracle answers from the key, to check the evaluation itself
//   npm run eval -- --record                  live, and save each run as a cassette in eval/cassettes
//   npm run eval -- --replay                  score the saved cassettes again, with no model and no cost
//   npm run eval -- --grade                   also have a model grade whether each reply is grounded
//
// It never touches a real database. It starts its own throwaway one, and checks it is local.

interface Args {
  subset: 'full' | 'smoke';
  model: string | undefined;
  offline: boolean;
  replay: boolean;
  record: boolean;
  grade: boolean;
  ids: string[] | undefined;
  tags: string[] | undefined;
  limit: number | undefined;
  out: string | undefined;
  minCategory: number | undefined;
  maxSecurityMissed: number | undefined;
  maxCost: number;
  appendHistory: boolean;
  note: string;
  help: boolean;
}

const USAGE = `Usage: npm run eval -- [options]

  --subset full|smoke        which tickets (default full; smoke is the small balanced set)
  --ids T001,T002            only these tickets          --tags security,injection   only tickets with any of these tags
  --limit N                  only the first N            --model claude-haiku-4-5    the model (default claude-sonnet-5)
  --offline                  answer from the answer key (checks the evaluation, measures no model)
  --record / --replay        save each run as a cassette / score the saved cassettes again
  --grade                    have a model grade whether each proposed reply is grounded (costs a call each)
  --max-cost 5               stop once the runs have cost this many US dollars (default 5)
  --min-category 0.8         exit 1 if category accuracy is below this
  --max-security-missed 0    exit 1 if more security tickets than this were missed
  --out DIR                  where to write results (default eval/results)
  --append-history --note "" add a row to docs/EVAL_HISTORY.md (live or replay only)
`;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    subset: 'full',
    model: undefined,
    offline: false,
    replay: false,
    record: false,
    grade: false,
    ids: undefined,
    tags: undefined,
    limit: undefined,
    out: undefined,
    minCategory: undefined,
    maxSecurityMissed: undefined,
    maxCost: 5,
    appendHistory: false,
    note: '',
    help: false,
  };
  const list = (value: string) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  const number = (flag: string, value: string | undefined): number => {
    const parsed = Number(value);
    if (value === undefined || value.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`${flag} needs a number of zero or more.`);
    }
    return parsed;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] as string;
    const value = argv[i + 1];
    const take = (): string => {
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value.`);
      i += 1;
      return value;
    };
    switch (flag) {
      case '--subset': {
        const subset = take();
        if (subset !== 'full' && subset !== 'smoke')
          throw new Error('--subset must be full or smoke.');
        args.subset = subset;
        break;
      }
      case '--model':
        args.model = take();
        break;
      case '--ids':
        args.ids = list(take());
        break;
      case '--tags':
        args.tags = list(take());
        break;
      case '--limit':
        args.limit = Math.floor(number(flag, take()));
        break;
      case '--out':
        args.out = take();
        break;
      case '--min-category':
        args.minCategory = number(flag, take());
        break;
      case '--max-security-missed':
        args.maxSecurityMissed = Math.floor(number(flag, take()));
        break;
      case '--max-cost':
        args.maxCost = number(flag, take());
        break;
      case '--note':
        args.note = take();
        break;
      case '--offline':
        args.offline = true;
        break;
      case '--replay':
        args.replay = true;
        break;
      case '--record':
        args.record = true;
        break;
      case '--grade':
        args.grade = true;
        break;
      case '--append-history':
        args.appendHistory = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown option ${flag}. Try --help.`);
    }
  }

  if (args.offline && (args.record || args.replay || args.grade)) {
    throw new Error(
      '--offline cannot be combined with --record, --replay or --grade: it uses no model.'
    );
  }
  if (args.replay && args.record) throw new Error('--replay and --record cannot be combined.');
  if (args.replay && args.grade) throw new Error('--grade needs a live model; a replay has none.');
  if (args.appendHistory && args.offline) {
    throw new Error(
      '--append-history is for measured runs only. The offline oracle measures no model.'
    );
  }
  return args;
}

// The key from a single line of .env if it is not in the environment; nothing else in that file is read.
function readEnvFileKey(): string | undefined {
  try {
    return keyFromEnvFile(fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8'));
  } catch {
    return undefined;
  }
}

const cassettePath = (dir: string, id: string) => path.join(dir, `${id}.json`);

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  // The app logs every request, which would bury the progress lines. Set LOG_LEVEL to see them.
  if (!process.env.LOG_LEVEL) logger.level = 'silent';
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const source: EvalSource = args.offline ? 'offline-oracle' : args.replay ? 'replay' : 'live';
  const cassetteDir = path.join(process.cwd(), 'eval', 'cassettes');
  const prompt = loadPrompt(DEFAULT_PROMPT);

  const tickets = selectTickets(
    loadTickets(),
    { subset: args.subset, ids: args.ids, tags: args.tags, limit: args.limit },
    loadSmokeIds()
  );
  if (tickets.length === 0) throw new Error('No tickets match. Nothing to run.');

  // A replay is scored with the model it was recorded with, so the cost is the recorded run's.
  let model = args.model ?? process.env.AGENT_MODEL?.trim() ?? DEFAULT_MODEL;
  const cassettes = new Map<string, Cassette>();
  if (source === 'replay') {
    for (const ticket of tickets) {
      const file = cassettePath(cassetteDir, ticket.id);
      if (!fs.existsSync(file))
        throw new Error(`There is no recording for ${ticket.id}. Run with --record first.`);
      cassettes.set(ticket.id, JSON.parse(fs.readFileSync(file, 'utf8')) as Cassette);
    }
    const recorded = new Set([...cassettes.values()].map((cassette) => cassette.model));
    if (recorded.size > 1)
      throw new Error(
        `The recordings were made with different models: ${[...recorded].join(', ')}.`
      );
    model = [...recorded][0] as string;
  }
  if (!isPricedModel(model)) throw new Error(`"${model}" is not a model the agent is priced for.`);

  // A live run, and grading, need a key. Say so before starting anything.
  if (source === 'live' || args.grade) {
    const key = hasAnthropicKey() ? process.env.ANTHROPIC_API_KEY?.trim() : readEnvFileKey();
    if (!key) {
      console.error(
        'No ANTHROPIC_API_KEY. Set it in your shell (or as a line in .env) to run against the real model.\n' +
          'To check the evaluation itself without a model, run: npm run eval -- --offline'
      );
      return 2;
    }
    process.env.ANTHROPIC_API_KEY = key;
  }

  // Its own throwaway database, and nothing else: the address in .env is never used.
  delete process.env.MONGODB_URI;
  const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  let server: import('http').Server | undefined;
  try {
    process.env.MONGODB_URI = mongod.getUri();
    process.env.AUTH_SECRET = crypto.randomBytes(24).toString('hex');
    process.env.AGENT_ENABLED = 'true';

    // (The app reads the database address and the secret when they are used, not when it is
    // imported, so setting them here, after the imports above, is early enough.)
    await connectToDatabase();
    assertLocalDatabase(process.env.MONGODB_URI, mongoose.connection.host);

    await Promise.all(
      [Ticket, OutboxEvent, KbArticle, AgentRun, AgentStep, AgentSettings].map((model) =>
        model.init()
      )
    );

    const { articles } = loadArticles();
    await importArticles(articles);
    const kb = new Map(articles.map((article) => [article.articleId, article.body]));

    const listening = app.listen(0);
    server = listening;
    await new Promise<void>((resolve) => listening.once('listening', () => resolve()));
    const baseUrl = `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'tech@demo.local', password: 'TechPass123!' }),
    });
    const staffToken = ((await login.json()) as { token: string }).token;

    const live = source === 'live' || args.grade ? new AnthropicModelClient() : undefined;
    const recorders = new Map<string, RecordingModelClient>();

    const modelFor = ({
      golden,
      ticketId,
    }: {
      golden: (typeof tickets)[number];
      ticketId: string;
    }): ModelClient => {
      if (source === 'offline-oracle') return new ScriptedModelClient(oracleScript(golden));
      if (source === 'replay') {
        return new ReplayModelClient(
          decodeCassette(cassettes.get(golden.id) as Cassette, ticketId)
        );
      }
      if (args.record) {
        const recorder = new RecordingModelClient(live as ModelClient);
        recorders.set(ticketId, recorder);
        return recorder;
      }
      return live as ModelClient;
    };

    const { results, truncated } = await runEvaluation({
      tickets,
      baseUrl,
      staffToken,
      model,
      prompt,
      modelFor,
      maxCostUsd: args.maxCost,
      onProgress: (line) => console.log(line),
      afterCase: async ({ golden, ticketId }) => {
        const recorder = recorders.get(ticketId);
        if (!recorder) return;
        fs.mkdirSync(cassetteDir, { recursive: true });
        const cassette = encodeCassette(
          { model, promptVersion: prompt.version },
          recorder.responses,
          ticketId
        );
        fs.writeFileSync(
          cassettePath(cassetteDir, golden.id),
          `${JSON.stringify(cassette, null, 2)}\n`
        );
      },
      ...(args.grade && live
        ? {
            judge: async (run, golden) =>
              judgeGroundedness(live, 'claude-sonnet-5', {
                reply: run.proposal?.replyMarkdown ?? '',
                articles: golden.relevant_kb_ids
                  .filter((id) => run.proposal?.citedKbIds.includes(id))
                  .map((id) => ({ id, body: kb.get(id) ?? '' })),
              }),
          }
        : {}),
    });

    const summary = summarize(results);
    const report: EvalReport = {
      meta: {
        date: new Date().toISOString().slice(0, 10),
        source,
        measured: source !== 'offline-oracle',
        model,
        promptVersion: prompt.version,
        dataset: {
          file: 'eval/tickets.jsonl',
          total: loadTickets().length,
          run: results.length,
          subset: args.ids || args.tags ? 'selected' : args.subset,
        },
        ...(truncated ? { truncated } : {}),
      },
      summary,
      cases: results.map(({ golden, run, score }) => ({
        id: golden.id,
        tags: golden.tags,
        expected: {
          action: golden.expected_action,
          category: golden.expected_category,
          priority: golden.expected_priority,
          group: golden.expected_group,
          kb: golden.relevant_kb_ids,
          reason: golden.expected_reason,
        },
        actual: run,
        score,
      })),
    };

    const outDir = path.resolve(
      args.out ?? path.join('eval', 'results', source === 'offline-oracle' ? 'offline' : '')
    );
    fs.mkdirSync(outDir, { recursive: true });
    const stem = `${report.meta.date}-${prompt.version}-${model}${args.subset === 'smoke' ? '-smoke' : ''}${source === 'replay' ? '-replay' : ''}${source === 'offline-oracle' ? '-offline-oracle' : ''}`;
    fs.writeFileSync(path.join(outDir, `${stem}.json`), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(outDir, `${stem}.md`), renderMarkdown(report));

    console.log(`\n${summaryLine(summary)}`);
    if (source === 'offline-oracle') {
      console.log(
        '(Offline oracle: this checks the evaluation and measures no model. Its cost and latency are not real.)'
      );
    }
    if (truncated) console.log(`\n${truncated}`);
    console.log(`Wrote ${path.join(outDir, stem)}.json and .md`);

    if (args.appendHistory) {
      if (truncated) throw new Error('Not adding a cut-short run to the history.');
      const file = path.join(process.cwd(), 'docs', 'EVAL_HISTORY.md');
      const marker = '<!-- history-rows -->';
      const text = fs.readFileSync(file, 'utf8');
      if (!text.includes(marker))
        throw new Error('docs/EVAL_HISTORY.md has no history marker to add a row after.');
      fs.writeFileSync(
        file,
        text.replace(marker, `${marker}\n${historyRow(report, { note: args.note })}`)
      );
      console.log('Added a row to docs/EVAL_HISTORY.md');
    }

    // Thresholds, for CI: a run that is worse than the line drawn fails.
    if (args.minCategory !== undefined && (summary.category.rate ?? 0) < args.minCategory) {
      console.error(
        `FAIL: category accuracy ${((summary.category.rate ?? 0) * 100).toFixed(1)}% is below ${(args.minCategory * 100).toFixed(1)}%.`
      );
      return 1;
    }
    if (args.maxSecurityMissed !== undefined && summary.security.missed > args.maxSecurityMissed) {
      console.error(
        `FAIL: ${summary.security.missed} security ticket(s) missed; at most ${args.maxSecurityMissed} allowed.`
      );
      return 1;
    }
    return truncated ? 3 : 0;
  } finally {
    server?.closeAllConnections();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await mongoose.disconnect();
    await mongod.stop();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
