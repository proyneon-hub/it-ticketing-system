import 'dotenv/config';
import { connectToDatabase } from '../src/server/db';
import { defaultKbDir, loadArticles } from '../src/server/kbLoader';
import { importArticles } from '../src/server/services/kbService';

// Loads the knowledge-base articles in kb/ into the database. The files are the source of truth
// (they are reviewed like code); this makes the database match them. Safe to run again: an
// unchanged article is left alone.
//
//   npm run kb:seed                          add new articles and update changed ones
//   npm run kb:seed -- --prune               also remove articles whose file has gone
//   KB_DIR=path npm run kb:seed              read another directory (default: ./kb)
//   node dist-server/scripts/seed-kb.js      from a build or the Docker image
async function main(): Promise<void> {
  const dir = defaultKbDir();
  const { articles, problems } = loadArticles(dir);

  if (problems.length > 0) {
    console.error(`Not importing: ${problems.length} problem(s) in ${dir}`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  // With --prune, an empty or wrong directory would otherwise delete every article.
  if (articles.length === 0) {
    console.error(`No articles found in ${dir}.`);
    process.exit(1);
  }

  await connectToDatabase();
  const result = await importArticles(articles, { prune: process.argv.includes('--prune') });
  console.log(
    `Knowledge base: ${articles.length} articles read. ` +
      `${result.created} created, ${result.modified} updated, ${result.unchanged} unchanged, ${result.pruned} removed.`
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
