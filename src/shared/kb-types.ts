import type { AgentCategory } from './ticket-constants';

// A knowledge-base article as the API sends it. `id` is the article's own id (KB-006), not a
// database id: it is what a reply cites, and what stays the same when the article is re-imported.
export interface KbArticle {
  id: string;
  title: string;
  category: AgentCategory;
  // YYYY-MM-DD: when a person last checked the steps still work.
  lastReviewed: string;
  // What the article covers (an operating system, a product): free text from the article.
  appliesTo: string[];
  // Markdown.
  body: string;
}

// One search hit: enough to decide whether to open the article, without the whole body.
export interface KbSearchResult {
  id: string;
  title: string;
  category: AgentCategory;
  lastReviewed: string;
  snippet: string;
}
