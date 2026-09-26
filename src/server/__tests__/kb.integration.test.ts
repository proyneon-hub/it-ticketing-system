// The knowledge base against a real database: the articles in kb/ imported the way the seed
// script does, then searched and read over HTTP as each kind of caller.
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../app';
import { connectToDatabase } from '../db';
import { KbFormatError, parseArticle, type KbArticleInput } from '../domain/kb';
import { loadArticles } from '../kbLoader';
import KbArticle from '../models/KbArticle';
import Ticket from '../models/Ticket';
import { issueServiceToken } from '../security/accessToken';
import { importArticles } from '../services/kbService';
import {
  bearer,
  signInAll,
  startTestDatabase,
  type Account,
  type TestDatabase,
  type Tokens,
} from './helpers';

let mongod: TestDatabase;
let tokens: Tokens;
let articles: KbArticleInput[];
const as = (role: Account) => bearer(tokens, role);

interface Hit {
  id: string;
  title: string;
  category: string;
  snippet: string;
}

beforeAll(async () => {
  mongod = await startTestDatabase();
  await connectToDatabase();
  await KbArticle.init();
  await Ticket.init();
  tokens = await signInAll(app);

  const loaded = loadArticles('kb');
  expect(loaded.problems).toEqual([]);
  articles = loaded.articles;
}, 300000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await KbArticle.deleteMany({});
  await importArticles(articles);
});

const search = async (query: string, account: Account = 'tech') =>
  (await request(app).get(`/api/kb?${query}`).set(as(account)).expect(200)).body.articles as Hit[];

describe('importing', () => {
  test('loads every article, and importing the same files again changes nothing', async () => {
    expect(await KbArticle.countDocuments()).toBe(articles.length);

    const again = await importArticles(articles);
    expect(again).toEqual({ created: 0, modified: 0, unchanged: articles.length, pruned: 0 });
    expect(await KbArticle.countDocuments()).toBe(articles.length);
  });

  test('reports created, changed and unchanged articles separately', async () => {
    await KbArticle.deleteOne({ articleId: 'KB-001' });
    await KbArticle.updateOne({ articleId: 'KB-002' }, { $set: { title: 'An old title' } });

    expect(await importArticles(articles)).toEqual({
      created: 1,
      modified: 1,
      unchanged: articles.length - 2,
      pruned: 0,
    });
    expect((await KbArticle.findOne({ articleId: 'KB-002' }))?.title).not.toBe('An old title');
  });

  test('never deletes unless asked, and with prune removes only what is not in the list', async () => {
    const stray = parseArticle(
      `---\nid: KB-900\ntitle: Old article\ncategory: Network\nlast_reviewed: 2026-01-01\napplies_to: [All devices]\n---\n\n${'A step that explains what to do. '.repeat(10)}`
    );
    await importArticles([...articles, stray]);
    expect(await KbArticle.countDocuments()).toBe(articles.length + 1);

    expect((await importArticles(articles)).pruned).toBe(0);
    expect(await KbArticle.countDocuments()).toBe(articles.length + 1);

    expect((await importArticles(articles, { prune: true })).pruned).toBe(1);
    expect(await KbArticle.countDocuments()).toBe(articles.length);
    expect(await KbArticle.exists({ articleId: 'KB-900' })).toBeNull();
  });

  test('refuses a list with a repeated id before writing anything', async () => {
    await KbArticle.deleteMany({});
    const first = articles[0] as KbArticleInput;
    await expect(importArticles([first, first])).rejects.toThrow(KbFormatError);
    expect(await KbArticle.countDocuments()).toBe(0);
  });
});

describe('searching', () => {
  test.each([
    ['VPN keeps disconnecting', 'KB-006'],
    ['vpn will not connect authentication error', 'KB-007'],
    ['printer shows offline', 'KB-011'],
    ['print jobs stuck in queue', 'KB-012'],
    ['forgot my password', 'KB-001'],
    ['account locked out', 'KB-002'],
    ['Outlook keeps asking for a password', 'KB-024'],
    ['Teams no audio', 'KB-021'],
    ['enrol Chromebook', 'KB-017'],
    ['suspicious email phishing', 'KB-029'],
    ['licence expired', 'KB-020'],
    ['guest wifi visitors', 'KB-009'],
  ])('“%s” finds %s first', async (query, expected) => {
    const hits = await search(`search=${encodeURIComponent(query)}&limit=5`);
    expect(hits[0]?.id).toBe(expected);
  });

  // Known weaker rankings, recorded as they are rather than tuned away. MongoDB text search has no
  // inverse document frequency, so a word that fills one article ("laptop" in the battery article)
  // can outscore a rarer word in another article's title ("stolen"). The right article is still
  // in the first three, which is what the agent reads; these guard against it getting worse. The
  // evaluation measures recall properly, and is what decides whether text search is enough (ADR 013).
  test.each([
    ['new phone MFA', 'KB-003'],
    ['stolen laptop', 'KB-030'],
    ['my laptop was stolen', 'KB-030'],
  ])('“%s” has %s in the first three, though not always first', async (query, expected) => {
    const hits = await search(`search=${encodeURIComponent(query)}&limit=3`);
    expect(hits.map((hit) => hit.id)).toContain(expected);
  });

  test('finds other forms of a word', async () => {
    const hits = await search('search=disconnect');
    expect(hits.map((hit) => hit.id)).toContain('KB-006');
  });

  test('a title match outranks a mention in the body', async () => {
    const hits = await search('search=chromebook&limit=10');
    expect(hits[0]?.id).toBe('KB-017');
  });

  test('a search with nothing in it is an empty list, not an error', async () => {
    expect(await search('search=zzzqqqxxx')).toEqual([]);
  });

  test('is limited by the category', async () => {
    const hits = await search('search=password&category=Email&limit=25');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.category === 'Email')).toBe(true);
  });

  test('without search words, lists in id order so a category can be browsed', async () => {
    const hits = await search('category=Network&limit=25');
    expect(hits.map((hit) => hit.id)).toEqual(['KB-006', 'KB-007', 'KB-008', 'KB-009', 'KB-010']);
  });

  test('respects the limit, five by default', async () => {
    expect(await search('search=laptop')).toHaveLength(5);
    expect(await search('search=laptop&limit=2')).toHaveLength(2);
  });

  test('a result carries a snippet, not the whole article', async () => {
    const [hit] = await search('search=vpn');
    expect(hit).not.toHaveProperty('body');
    expect(hit?.snippet.length).toBeGreaterThan(20);
    expect(hit?.snippet.length).toBeLessThanOrEqual(202);
  });

  test('search syntax is just words: a leading minus does not exclude, quotes do not demand', async () => {
    const plain = await search('search=vpn');
    expect(await search(`search=${encodeURIComponent('-vpn')}`)).toEqual(plain);
    expect(await search(`search=${encodeURIComponent('"vpn"')}`)).toEqual(plain);
  });

  test.each([
    ['limit=0', /limit/],
    ['limit=26', /limit/],
    ['limit=abc', /limit/],
    ['category=Endpoint', /category/i],
    [`search=${'x'.repeat(101)}`, /100 characters/],
  ])('rejects %s', async (query, message) => {
    const response = await request(app).get(`/api/kb?${query}`).set(as('tech'));
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(message);
  });

  test('uses the text index, not a scan of every article', async () => {
    const plan = await KbArticle.find({ $text: { $search: 'vpn' } }).explain('queryPlanner');
    expect(JSON.stringify(plan)).toContain('TEXT');
    expect(JSON.stringify(plan)).not.toContain('COLLSCAN');
  });
});

describe('reading an article', () => {
  test('returns the whole article with its details', async () => {
    const response = await request(app).get('/api/kb/KB-006').set(as('tech')).expect(200);
    expect(response.body.article).toMatchObject({
      id: 'KB-006',
      title: 'VPN keeps disconnecting',
      category: 'Network',
      lastReviewed: '2026-09-01',
      appliesTo: ['Windows', 'macOS'],
    });
    expect(response.body.article.body).toContain('Fully disconnect the VPN');
  });

  test('an article that is not there is a 404, and a malformed id is a 400', async () => {
    await request(app).get('/api/kb/KB-999').set(as('tech')).expect(404);
    for (const id of ['KB-6', 'kb-006', 'KB-0006', '6', '%20']) {
      await request(app).get(`/api/kb/${id}`).set(as('tech')).expect(400);
    }
  });
});

describe('who can use it', () => {
  test.each(['admin', 'tech'] as const)('a %s can search and read', async (account) => {
    await request(app).get('/api/kb?search=vpn').set(as(account)).expect(200);
    await request(app).get('/api/kb/KB-006').set(as(account)).expect(200);
  });

  test('the agent can, whichever ticket its token names', async () => {
    const ticket = await Ticket.create({
      ticketNumber: 'TKT-9301',
      title: 'x',
      requesterEmail: 'a@b.c',
    });
    const agent = {
      Authorization: `Bearer ${await issueServiceToken({ ticketId: String(ticket._id), runId: 'r1' })}`,
    };
    await request(app).get('/api/kb?search=vpn').set(agent).expect(200);
    await request(app).get('/api/kb/KB-006').set(agent).expect(200);
  });

  test('a requester cannot, and neither can someone who is not signed in', async () => {
    await request(app).get('/api/kb?search=vpn').set(as('user')).expect(403);
    await request(app).get('/api/kb/KB-006').set(as('user')).expect(403);
    await request(app).get('/api/kb?search=vpn').expect(401);
    await request(app).get('/api/kb/KB-006').expect(401);
    await request(app).get('/api/kb/KB-006').set('Authorization', 'Bearer not-a-token').expect(401);
  });

  test('is read-only over the API', async () => {
    await request(app).post('/api/kb').set(as('admin')).send({ id: 'KB-999' }).expect(404);
    await request(app).delete('/api/kb/KB-006').set(as('admin')).expect(404);
    expect(await KbArticle.countDocuments()).toBe(articles.length);
  });
});
