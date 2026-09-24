// Prints a shields.io "endpoint" JSON for the coverage badge in the README. The
// Pages workflow publishes it as coverage.json, and shields.io renders it, so no
// third-party coverage service or sign-up is needed:
//   node scripts/coverage-badge.js > site/coverage.json
//
// The figure is line coverage across the API and the frontend together (covered
// lines over total lines), read from the reports `npm run test:coverage` writes.
const fs = require('fs');
const path = require('path');

const reports = ['coverage/server/coverage-summary.json', 'coverage/client/coverage-summary.json'];

let covered = 0;
let total = 0;
for (const file of reports) {
  const fullPath = path.join(__dirname, '..', file);
  if (!fs.existsSync(fullPath)) {
    console.error(`Missing ${file}. Run "npm run test:coverage" first.`);
    process.exit(1);
  }
  const { lines } = JSON.parse(fs.readFileSync(fullPath, 'utf8')).total;
  covered += lines.covered;
  total += lines.total;
}

const percent = total === 0 ? 0 : (covered / total) * 100;
const colors = [
  [90, 'brightgreen'],
  [80, 'green'],
  [70, 'yellowgreen'],
  [60, 'yellow'],
];
const color = (colors.find(([min]) => percent >= min) || [0, 'orange'])[1];

console.log(
  JSON.stringify({
    schemaVersion: 1,
    label: 'coverage',
    message: `${Math.round(percent)}%`,
    color,
  })
);
