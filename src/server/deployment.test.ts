import fs from 'fs';
import path from 'path';

// Vercel's routing cannot be run here, so what it depends on is checked in the files. Both
// checks come from a production outage found by smoke-testing the deployed site: every route that
// had no file of its own in api/ (sessions, comments, trends, the jobs) answered a platform 404.

const ROOT = path.resolve(__dirname, '../..');
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')) as {
  rewrites: { source: string; destination: string }[];
};

describe('vercel.json', () => {
  test('sends every /api path to the one function that serves the Express app', () => {
    const [first] = vercel.rewrites;
    expect(first).toEqual({ source: '/api/(.*)', destination: '/api' });
    expect(fs.existsSync(path.join(ROOT, 'api/index.js'))).toBe(true);
  });

  test('the single-page-app fallback comes after it and never captures /api', () => {
    const spa = vercel.rewrites.find((rewrite) => rewrite.destination === '/index.html');
    expect(
      vercel.rewrites.indexOf(spa as object as (typeof vercel.rewrites)[number])
    ).toBeGreaterThan(0);
    expect(new RegExp(`^${spa?.source}$`).test('/api/tickets')).toBe(false);
    expect(new RegExp(`^${spa?.source}$`).test('/tickets/123')).toBe(true);
  });
});
