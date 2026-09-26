import fs from 'fs';
import path from 'path';
import { KbFormatError, parseArticle, type KbArticleInput } from './domain/kb';

// Reads the knowledge-base articles from disk. The one place the files are read, so the seed
// script, the checks on the articles themselves and the evaluation all see the same set.

// Relative to the working directory, like the built client, because the compiled scripts live
// in dist-server/ and would otherwise look in the wrong place. KB_DIR overrides it.
export const defaultKbDir = (): string => process.env.KB_DIR || path.join(process.cwd(), 'kb');

export interface LoadedArticles {
  articles: KbArticleInput[];
  // One line for each file that is not a valid article, naming the file and what is wrong.
  problems: string[];
}

export function loadArticles(dir: string = defaultKbDir()): LoadedArticles {
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort();

  const articles: KbArticleInput[] = [];
  const problems: string[] = [];
  const fileOf = new Map<string, string>();

  for (const file of files) {
    try {
      const article = parseArticle(fs.readFileSync(path.join(dir, file), 'utf8'));
      // The file name carries the id, so a file cannot quietly hold a different article than it says.
      if (!file.toLowerCase().startsWith(`${article.articleId.toLowerCase()}-`)) {
        problems.push(
          `${file}: the file name must start with ${article.articleId.toLowerCase()}-.`
        );
        continue;
      }
      // Ids are what replies cite, so two files must never claim the same one.
      const other = fileOf.get(article.articleId);
      if (other) {
        problems.push(`${file}: ${article.articleId} is already used by ${other}.`);
        continue;
      }
      fileOf.set(article.articleId, file);
      articles.push(article);
    } catch (error) {
      if (!(error instanceof KbFormatError)) throw error;
      problems.push(`${file}: ${error.message}`);
    }
  }
  return { articles, problems };
}
