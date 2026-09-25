import { kbIdPattern, type AgentCategory } from '../../shared/ticket-constants';
import type { KbArticle, KbSearchResult } from '../../shared/kb-types';
import { assertUniqueIds, snippetFor, type KbArticleInput } from '../domain/kb';
import { NotFoundError, ValidationError } from '../errors';
import * as repository from '../repositories/kbRepository';

// The knowledge base the agent and technicians look answers up in. Read-only over the API: the
// articles come from the files in kb/ through importArticles.

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

export async function searchArticles(query: {
  search?: string | undefined;
  category?: AgentCategory | undefined;
  limit: number;
}): Promise<KbSearchResult[]> {
  const records = await repository.search(query);
  return records.map((record) => ({
    id: record.articleId,
    title: record.title,
    category: record.category,
    lastReviewed: isoDate(record.lastReviewed),
    snippet: snippetFor(record.body, query.search),
  }));
}

export async function getArticle(id: string): Promise<KbArticle> {
  if (!kbIdPattern.test(id)) throw new ValidationError('Invalid article id. Expected KB-006.');
  const record = await repository.findByArticleId(id);
  if (!record) throw new NotFoundError('Article not found.');
  return {
    id: record.articleId,
    title: record.title,
    category: record.category,
    lastReviewed: isoDate(record.lastReviewed),
    appliesTo: record.appliesTo,
    body: record.body,
  };
}

export interface ImportResult {
  created: number;
  modified: number;
  unchanged: number;
  // Articles removed because their files are gone. Only counted with `prune`.
  pruned: number;
}

// Makes the stored articles match `articles`: new ones are created, changed ones replaced,
// unchanged ones left alone. With `prune`, articles that are no longer in the list are removed,
// so a deleted file does not linger in the database; without it nothing is ever deleted.
export async function importArticles(
  articles: KbArticleInput[],
  { prune = false }: { prune?: boolean } = {}
): Promise<ImportResult> {
  assertUniqueIds(articles);
  const written = await repository.upsertMany(articles);
  const pruned = prune ? await repository.deleteExcept(articles.map((a) => a.articleId)) : 0;
  return { ...written, pruned };
}
