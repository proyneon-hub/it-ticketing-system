import { agentCategories, kbIdPattern, type AgentCategory } from '../../shared/ticket-constants';
import { plainWords } from './search';

// Knowledge-base articles are markdown files in kb/, so they are reviewed like code. This is
// the pure part: reading one file's text into a validated article, and cutting a search
// snippet from an article. No files, no database: scripts/seed-kb.ts reads the files and
// kbService stores the result.
//
// A file looks like this:
//
//   ---
//   id: KB-006
//   title: VPN keeps disconnecting
//   category: Network
//   last_reviewed: 2026-09-01
//   applies_to: [Windows, macOS]
//   ---
//
//   # VPN keeps disconnecting
//   ...steps...

export interface KbArticleInput {
  articleId: string;
  title: string;
  category: AgentCategory;
  lastReviewed: Date;
  appliesTo: string[];
  body: string;
}

// A file that is not a valid article. The message says what is wrong, for whoever is editing it.
export class KbFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KbFormatError';
  }
}

export const MAX_TITLE_LENGTH = 120;
export const MAX_BODY_LENGTH = 8000;
// An article shorter than this is a stub, not something an answer can be built on.
export const MIN_BODY_LENGTH = 200;

const FIELDS = ['id', 'title', 'category', 'last_reviewed', 'applies_to'] as const;

function readFrontMatter(markdown: string): { fields: Map<string, string>; body: string } {
  const text = markdown.replace(/\r\n?/g, '\n');
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/.exec(text);
  if (!match) {
    throw new KbFormatError('The file must start with a front-matter block between --- lines.');
  }

  const fields = new Map<string, string>();
  for (const line of (match[1] as string).split('\n')) {
    if (line.trim() === '') continue;
    const pair = /^([a-z_]+):[ \t]*(.*)$/.exec(line);
    if (!pair) throw new KbFormatError(`Front matter line is not "key: value": ${line}`);
    const [, key, value] = pair as unknown as [string, string, string];
    if (!(FIELDS as readonly string[]).includes(key)) {
      throw new KbFormatError(`Unknown front-matter field "${key}". Known: ${FIELDS.join(', ')}.`);
    }
    if (fields.has(key)) throw new KbFormatError(`Front-matter field "${key}" appears twice.`);
    fields.set(key, value.trim());
  }
  return { fields, body: (match[2] as string).trim() };
}

// "[Windows, macOS]" or "Windows, macOS".
function readList(value: string): string[] {
  const inner = value.replace(/^\[/, '').replace(/\]$/, '');
  return inner
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

// A real calendar date written YYYY-MM-DD (2026-02-30 is not one).
function readDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : null;
  if (!date || date.toISOString().slice(0, 10) !== value) {
    throw new KbFormatError(
      `last_reviewed must be a real date written YYYY-MM-DD, not "${value}".`
    );
  }
  return date;
}

// The article in one file's text, or a KbFormatError that names the problem.
export function parseArticle(markdown: string): KbArticleInput {
  const { fields, body } = readFrontMatter(markdown);

  for (const name of FIELDS) {
    if (!fields.get(name)) throw new KbFormatError(`Front-matter field "${name}" is required.`);
  }
  const id = fields.get('id') as string;
  if (!kbIdPattern.test(id)) throw new KbFormatError(`id must look like KB-006, not "${id}".`);

  const title = fields.get('title') as string;
  if (title.length > MAX_TITLE_LENGTH) {
    throw new KbFormatError(`${id}: title must be ${MAX_TITLE_LENGTH} characters or fewer.`);
  }

  const category = fields.get('category') as string;
  if (!(agentCategories as readonly string[]).includes(category)) {
    throw new KbFormatError(
      `${id}: category must be one of ${agentCategories.join(', ')}, not "${category}".`
    );
  }

  const appliesTo = readList(fields.get('applies_to') as string);
  if (appliesTo.length === 0)
    throw new KbFormatError(`${id}: applies_to must name at least one thing.`);

  if (body.length < MIN_BODY_LENGTH) {
    throw new KbFormatError(
      `${id}: the article is too short to be useful (${body.length} characters).`
    );
  }
  if (body.length > MAX_BODY_LENGTH) {
    throw new KbFormatError(`${id}: the article is longer than ${MAX_BODY_LENGTH} characters.`);
  }

  return {
    articleId: id,
    title,
    category: category as AgentCategory,
    lastReviewed: readDate(fields.get('last_reviewed') as string),
    appliesTo,
    body,
  };
}

// Ids are what replies cite, so two articles must never share one.
export function assertUniqueIds(articles: Pick<KbArticleInput, 'articleId'>[]): void {
  const seen = new Set<string>();
  for (const { articleId } of articles) {
    if (seen.has(articleId)) throw new KbFormatError(`Two articles have the id ${articleId}.`);
    seen.add(articleId);
  }
}

const SNIPPET_LENGTH = 200;
// How much text before the first matching word a snippet keeps, so the match has some context.
const LEAD_IN = 50;

// Markdown reduced to plain running text: no heading marks, list markers, emphasis or code ticks.
function plainText(body: string): string {
  return body
    .replace(/^\s*#{1,6}[ \t]+.*(?:\n|$)/, '') // a leading heading is the article's own title
    .replace(/^#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*(?:[-*]|\d+\.)[ \t]+/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// A short piece of the article for a search result: the text around the first word the
// search asked for, or the start of the article when none of them appear.
export function snippetFor(body: string, search?: string, length: number = SNIPPET_LENGTH): string {
  const text = plainText(body);
  if (text.length <= length) return text;

  const words = search
    ? plainWords(search)
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 2)
    : [];
  const lower = text.toLowerCase();
  const hits = words.map((word) => lower.indexOf(word)).filter((index) => index >= 0);

  let start = hits.length > 0 ? Math.max(0, Math.min(...hits) - LEAD_IN) : 0;
  // Begin at a word boundary, so the snippet does not open in the middle of a word.
  if (start > 0) {
    const space = text.indexOf(' ', start);
    start = space === -1 ? start : space + 1;
  }

  let end = start + length;
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    end = space > start ? space : end;
  }
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}
