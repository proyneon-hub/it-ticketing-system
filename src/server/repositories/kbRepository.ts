import type { AgentCategory } from '../../shared/ticket-constants';
import type { KbArticleInput } from '../domain/kb';
import { plainWords } from '../domain/search';
import KbArticle, { type KbArticleRecord } from '../models/KbArticle';

// The only module that talks to Mongoose about knowledge-base articles.

export type { KbArticleRecord };

// The articles matching a search, best match first. Without search text they are listed in id
// order, so a category can be browsed. Matches whole words and their other forms (ADR 007).
export function search(criteria: {
  search?: string | undefined;
  category?: AgentCategory | undefined;
  limit: number;
}): Promise<KbArticleRecord[]> {
  const filter = criteria.category ? { category: criteria.category } : {};

  if (!criteria.search) {
    return KbArticle.find(filter)
      .sort({ articleId: 1 })
      .limit(criteria.limit)
      .lean<KbArticleRecord[]>();
  }
  const score = { $meta: 'textScore' } as const;
  return KbArticle.find({ ...filter, $text: { $search: plainWords(criteria.search) } }, { score })
    .sort({ score })
    .limit(criteria.limit)
    .lean<KbArticleRecord[]>();
}

export const findByArticleId = (articleId: string): Promise<KbArticleRecord | null> =>
  KbArticle.findOne({ articleId }).lean<KbArticleRecord>();

// Writes each article, creating it or replacing what is stored under its id. `modified` counts
// only articles whose content actually changed, so importing the same files again reports none.
export async function upsertMany(
  articles: KbArticleInput[]
): Promise<{ created: number; modified: number; unchanged: number }> {
  if (articles.length === 0) return { created: 0, modified: 0, unchanged: 0 };

  const result = await KbArticle.bulkWrite(
    articles.map(({ articleId, ...fields }) => ({
      updateOne: { filter: { articleId }, update: { $set: fields }, upsert: true },
    }))
  );
  const created = result.upsertedCount;
  const modified = result.modifiedCount;
  return { created, modified, unchanged: articles.length - created - modified };
}

// Removes every article whose id is not in `keep`. Returns how many went.
export async function deleteExcept(keep: string[]): Promise<number> {
  const { deletedCount } = await KbArticle.deleteMany({ articleId: { $nin: keep } });
  return deletedCount;
}
