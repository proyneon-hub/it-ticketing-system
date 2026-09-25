import fs from 'fs';
import os from 'os';
import path from 'path';
import { agentCategories } from '../shared/ticket-constants';
import { loadArticles } from './kbLoader';

// The articles the agent will quote are content, so they get the checks code gets: they must
// parse, and the set as a whole must hold together. A broken or stray article fails here, in CI,
// and not in the middle of an agent run.
const KB_DIR = path.resolve(__dirname, '../../kb');

describe('the articles in kb/', () => {
  const { articles, problems } = loadArticles(KB_DIR);

  test('every file is a valid article', () => {
    expect(problems).toEqual([]);
  });

  test('there are enough of them to be worth searching', () => {
    expect(articles.length).toBeGreaterThanOrEqual(25);
  });

  test('ids run KB-001, KB-002, ... with no gaps, so a missing file is noticed', () => {
    const ids = articles.map((article) => article.articleId).sort();
    expect(ids).toEqual(ids.map((_, index) => `KB-${String(index + 1).padStart(3, '0')}`));
  });

  test('every category the agent can choose has an article', () => {
    const covered = new Set(articles.map((article) => article.category));
    expect([...agentCategories].filter((category) => !covered.has(category))).toEqual([]);
  });

  test('titles are unique, so a citation is unambiguous to a reader', () => {
    const titles = articles.map((article) => article.title.toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);
  });

  test('every article that points at another points at one that exists', () => {
    const ids = new Set(articles.map((article) => article.articleId));
    const dangling = articles.flatMap((article) =>
      [...article.body.matchAll(/\bKB-\d{3}\b/g)]
        .map((match) => match[0])
        .filter((id) => !ids.has(id) || id === article.articleId)
        .map((id) => `${article.articleId} -> ${id}`)
    );
    expect(dangling).toEqual([]);
  });

  test('no article was last reviewed in the future', () => {
    const tomorrow = Date.now() + 24 * 60 * 60 * 1000;
    expect(articles.filter((article) => article.lastReviewed.getTime() > tomorrow)).toEqual([]);
  });

  test('the two security articles tell the service desk to route, not to troubleshoot', () => {
    for (const id of ['KB-029', 'KB-030']) {
      const body = articles.find((article) => article.articleId === id)?.body ?? '';
      expect(body).toMatch(/Security Team/);
      expect(body).toMatch(/service desk/i);
    }
  });

  test('none of them asks for a password to be sent to anyone', () => {
    for (const article of articles) {
      expect(article.body).not.toMatch(/send (?:us |me )?your password/i);
    }
  });
});

describe('loadArticles', () => {
  let dir: string;
  const valid = (id: string, extra = '') =>
    `---\nid: ${id}\ntitle: Article ${id}\ncategory: Network\nlast_reviewed: 2026-09-01\napplies_to: [All devices]\n---\n\n# Article ${id}\n\n${'This is a step that explains what to do. '.repeat(8)}${extra}\n`;
  const write = (name: string, text: string) => fs.writeFileSync(path.join(dir, name), text);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-test-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('reads every .md file in name order and ignores other files', () => {
    write('kb-002-second.md', valid('KB-002'));
    write('kb-001-first.md', valid('KB-001'));
    write('notes.txt', 'not an article');
    write('README.md.bak', 'not an article either');

    const { articles, problems } = loadArticles(dir);
    expect(problems).toEqual([]);
    expect(articles.map((article) => article.articleId)).toEqual(['KB-001', 'KB-002']);
  });

  test('reports a bad file by name and still loads the good ones', () => {
    write('kb-001-good.md', valid('KB-001'));
    write('kb-002-bad.md', 'no front matter here');

    const { articles, problems } = loadArticles(dir);
    expect(articles.map((article) => article.articleId)).toEqual(['KB-001']);
    expect(problems).toEqual([expect.stringMatching(/^kb-002-bad\.md: .*front-matter/)]);
  });

  test('a file whose name does not start with its id is refused', () => {
    write('kb-005-mislabelled.md', valid('KB-006'));
    const { articles, problems } = loadArticles(dir);
    expect(articles).toEqual([]);
    expect(problems).toEqual([expect.stringMatching(/must start with kb-006-/)]);
  });

  test('two files claiming the same id are refused, naming both', () => {
    write('kb-001-one.md', valid('KB-001'));
    write('kb-001-two.md', valid('KB-001'));
    const { articles, problems } = loadArticles(dir);
    expect(articles).toHaveLength(1);
    expect(problems).toEqual([
      expect.stringMatching(/kb-001-two\.md: KB-001 is already used by kb-001-one\.md/),
    ]);
  });

  test('a directory that does not exist is an error, not an empty knowledge base', () => {
    expect(() => loadArticles(path.join(dir, 'missing'))).toThrow(/ENOENT/);
  });

  test('an empty directory loads nothing and reports no problems', () => {
    expect(loadArticles(dir)).toEqual({ articles: [], problems: [] });
  });
});
