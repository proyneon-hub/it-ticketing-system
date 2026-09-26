// Text-search syntax is meant for people writing queries, not for a search box: a leading
// minus excludes a word and quotes demand a phrase. Strip both so the input is just words.
// Shared by every text search (tickets, knowledge-base articles).
export function plainWords(search: string): string {
  const words = search
    .replace(/["\\]/g, ' ')
    .replace(/(^|\s)-+/g, '$1')
    .trim();
  return words || search;
}
