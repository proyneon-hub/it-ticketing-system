// Prints the API and frontend coverage as a markdown table. CI appends it to the
// job summary:  node scripts/coverage-summary.js >> "$GITHUB_STEP_SUMMARY"
const fs = require('fs');
const path = require('path');

const reports = [
  ['API (Vitest)', 'coverage/server/coverage-summary.json'],
  ['Frontend (Vitest)', 'coverage/client/coverage-summary.json'],
];

const metrics = ['statements', 'branches', 'functions', 'lines'];

function readTotal(file) {
  const fullPath = path.join(__dirname, '..', file);
  if (!fs.existsSync(fullPath)) return null;
  return JSON.parse(fs.readFileSync(fullPath, 'utf8')).total;
}

const rows = reports.map(([name, file]) => {
  const total = readTotal(file);
  const cells = metrics.map((metric) => (total ? `${total[metric].pct}%` : 'n/a'));
  return `| ${name} | ${cells.join(' | ')} |`;
});

console.log('### Test coverage\n');
console.log('| Suite | Statements | Branches | Functions | Lines |');
console.log('| --- | --- | --- | --- | --- |');
console.log(rows.join('\n'));
