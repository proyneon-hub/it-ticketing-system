// Load test for the ticket API, run with k6:
//
//   npm run perf              (against http://127.0.0.1:5000)
//   BASE_URL=... RESULT_LABEL=after-search npm run perf
//
// Start the API against a database seeded with `npm run seed -- --count 10000`
// first. Each virtual user repeats a mix of the calls a support team makes:
// mostly viewing the queue, some filtering and searching, a few new tickets.
// Results for each call are printed and written to perf/results/<label>.json.
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:5000';
const LABEL = __ENV.RESULT_LABEL || 'latest';
const VUS = Number(__ENV.VUS) || 10;
const DURATION = __ENV.DURATION || '30s';

const ACTIONS = ['login', 'list', 'filter', 'search', 'stats', 'create'];

export const options = {
  scenarios: {
    queue: { executor: 'constant-vus', vus: VUS, duration: DURATION },
  },
  // Sub-metrics are only recorded for tags that have a threshold, so each call gets a
  // (generous) one. They exist to produce per-call numbers, not to gate anything.
  thresholds: Object.fromEntries([
    ['http_req_failed', ['rate<0.01']],
    ...ACTIONS.map((name) => [`http_req_duration{name:${name}}`, ['p(95)<5000']]),
  ]),
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'max'],
};

const SEARCH_TERMS = [
  'printer',
  'vpn',
  'outlook',
  'payroll',
  'licence',
  'starter',
  'scanner',
  'docking',
];
const json = { 'Content-Type': 'application/json' };

export function setup() {
  const login = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: 'tech@demo.local', password: 'TechPass123!' }),
    { headers: json }
  );
  if (login.status !== 200) throw new Error(`Sign-in failed with status ${login.status}`);
  return { token: login.json('token') };
}

const pick = (items) => items[Math.floor(Math.random() * items.length)];

export default function (data) {
  const auth = { headers: { ...json, Authorization: `Bearer ${data.token}` } };
  const roll = Math.random();
  let response;
  let name;

  if (roll < 0.05) {
    name = 'login';
    response = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email: 'tech@demo.local', password: 'TechPass123!' }),
      { headers: json, tags: { name } }
    );
  } else if (roll < 0.4) {
    name = 'list';
    const page = 1 + Math.floor(Math.random() * 50);
    response = http.get(`${BASE_URL}/api/tickets?page=${page}&limit=10`, {
      ...auth,
      tags: { name },
    });
  } else if (roll < 0.6) {
    name = 'filter';
    response = http.get(
      `${BASE_URL}/api/tickets?status=open&priority=${pick(['high', 'urgent'])}&sortBy=priority&sortOrder=desc`,
      { ...auth, tags: { name } }
    );
  } else if (roll < 0.85) {
    name = 'search';
    response = http.get(`${BASE_URL}/api/tickets?search=${pick(SEARCH_TERMS)}&limit=10`, {
      ...auth,
      tags: { name },
    });
  } else if (roll < 0.93) {
    name = 'stats';
    response = http.get(`${BASE_URL}/api/tickets/stats`, { ...auth, tags: { name } });
  } else {
    name = 'create';
    response = http.post(
      `${BASE_URL}/api/tickets`,
      JSON.stringify({
        title: `Load test ${Date.now()}`,
        description: 'Created by k6',
        priority: 'low',
      }),
      { ...auth, tags: { name } }
    );
  }

  check(response, { 'status is 2xx': (r) => r.status >= 200 && r.status < 300 });
}

// Per-call latency in milliseconds, plus overall throughput.
export function handleSummary(data) {
  const ms = (metric, stat) => {
    const value = data.metrics[metric] && data.metrics[metric].values[stat];
    return value === undefined ? null : Math.round(value * 100) / 100;
  };

  const calls = {};
  for (const name of ACTIONS) {
    const key = `http_req_duration{name:${name}}`;
    calls[name] = {
      p50: ms(key, 'med'),
      p95: ms(key, 'p(95)'),
      max: ms(key, 'max'),
    };
  }

  const summary = {
    label: LABEL,
    baseUrl: BASE_URL,
    vus: VUS,
    duration: DURATION,
    requests: data.metrics.http_reqs.values.count,
    requestsPerSecond: Math.round(data.metrics.http_reqs.values.rate * 10) / 10,
    failedRate: data.metrics.http_req_failed.values.rate,
    overall: { p50: ms('http_req_duration', 'med'), p95: ms('http_req_duration', 'p(95)') },
    calls,
  };

  const lines = Object.entries(calls).map(
    ([name, c]) => `${name.padEnd(8)} p50 ${c.p50} ms   p95 ${c.p95} ms`
  );
  const text = [
    `\n${LABEL}: ${summary.requests} requests, ${summary.requestsPerSecond} req/s, ${summary.vus} VUs for ${summary.duration}`,
    ...lines,
    `overall  p50 ${summary.overall.p50} ms   p95 ${summary.overall.p95} ms   failed ${(summary.failedRate * 100).toFixed(2)}%\n`,
  ].join('\n');

  return { stdout: text, [`perf/results/${LABEL}.json`]: JSON.stringify(summary, null, 2) };
}
