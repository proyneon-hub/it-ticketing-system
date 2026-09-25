// The knowledge-base text search against the golden tickets, as a guard: the article a ticket needs
// has to keep coming up. The floors sit a little below what was measured (eval/results/retrieval.md,
// docs/adr/013), so an edit to the articles, the index or the search that makes it clearly worse fails
// here, and a change that makes it better is a reason to raise them.
import mongoose from 'mongoose';
import { loadTickets } from '../../../scripts/eval/dataset';
import { measureRetrieval } from '../../../scripts/eval/retrieval';
import { connectToDatabase } from '../db';
import { loadArticles } from '../kbLoader';
import KbArticle from '../models/KbArticle';
import { importArticles, searchArticles } from '../services/kbService';
import { startTestDatabase, type TestDatabase } from './helpers';

let mongod: TestDatabase;

beforeAll(async () => {
  mongod = await startTestDatabase();
  await connectToDatabase();
  await KbArticle.init();
  await importArticles(loadArticles('kb').articles);
}, 300000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const tickets = loadTickets('eval/tickets.jsonl');
const search = async (query: string, limit: number) =>
  (await searchArticles({ search: query, limit })).map((result) => result.id);

describe('finding the right article', () => {
  test('by the ticket title: the first result is right at least 84% of the time, and the top five 90%', async () => {
    const { summary } = await measureRetrieval(tickets, 'title', search);
    expect(summary.n).toBe(62);
    expect(summary.atOne / summary.n).toBeGreaterThanOrEqual(0.84);
    expect(summary.atFive / summary.n).toBeGreaterThanOrEqual(0.9);
    expect(summary.mrr).toBeGreaterThanOrEqual(0.88);
  });

  test('by the title and the description: the top five 93% of the time', async () => {
    const { summary } = await measureRetrieval(tickets, 'title and description', search);
    expect(summary.atFive / summary.n).toBeGreaterThanOrEqual(0.93);
    expect(summary.atThree / summary.n).toBeGreaterThanOrEqual(0.9);
  });

  test('the known misses are still the known misses, so a new one is noticed', async () => {
    const { rows } = await measureRetrieval(tickets, 'title', search);
    const notFound = rows.filter((row) => row.rank === 0).map((row) => row.id);
    // Words the articles do not use (an authenticator, a trial, an intranet) and a ticket in French.
    expect(notFound.sort()).toEqual(['T005', 'T023', 'T065', 'T073', 'T076']);
  });
});
