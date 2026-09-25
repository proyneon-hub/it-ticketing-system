import fs from 'fs';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import path from 'path';
import { connectToDatabase } from '../src/server/db';
import { loadArticles } from '../src/server/kbLoader';
import KbArticle from '../src/server/models/KbArticle';
import { importArticles, searchArticles } from '../src/server/services/kbService';
import { loadTickets } from './eval/dataset';
import { measureRetrieval, renderRetrieval, type Query } from './eval/retrieval';
import { assertLocalDatabase } from './eval/safety';

// Measures the knowledge-base text search against the golden tickets (docs/adr/013).
//
//   npm run eval:retrieval            prints the table and writes eval/results/retrieval.md
//
// It needs no key and costs nothing: no model is involved. It starts its own throwaway database and
// never touches a real one.

async function main(): Promise<number> {
  delete process.env.MONGODB_URI;
  const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  try {
    process.env.MONGODB_URI = mongod.getUri();
    await connectToDatabase();
    assertLocalDatabase(process.env.MONGODB_URI, mongoose.connection.host);
    await KbArticle.init();
    await importArticles(loadArticles().articles);

    const tickets = loadTickets();
    const search = async (query: string, limit: number) =>
      (await searchArticles({ search: query, limit })).map((result) => result.id);

    const results = [];
    for (const kind of ['title', 'title and description'] as Query[]) {
      results.push(await measureRetrieval(tickets, kind, search));
    }
    const text = renderRetrieval(results, {
      date: new Date().toISOString().slice(0, 10),
      total: tickets.length,
    });
    console.log(text);

    const out = path.join(process.cwd(), 'eval', 'results');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'retrieval.md'), text);
    console.log(`Wrote ${path.join(out, 'retrieval.md')}`);
    return 0;
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  }
);
