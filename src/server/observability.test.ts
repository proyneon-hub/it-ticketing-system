import fs from 'fs';
import path from 'path';
import { registry } from './metrics';

// The Grafana dashboard and the Prometheus config are written by hand and cannot be run in
// a unit test, but they can still drift from the code: a renamed metric would leave a panel
// permanently empty. These checks compare them with what the API actually exports.

const ROOT = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

interface Panel {
  title: string;
  targets: { expr: string }[];
}
const dashboard = JSON.parse(read('ops/grafana/dashboards/it-ticketing.json')) as {
  uid: string;
  panels: Panel[];
};

// Every metric name the registry exposes, including the _bucket, _sum and _count series a
// histogram adds.
async function exportedNames(): Promise<Set<string>> {
  const names = new Set<string>();
  for (const metric of await registry.getMetricsAsJSON()) {
    names.add(metric.name);
    // getMetricsAsJSON reports the type as text ('histogram') although it is typed as an enum.
    if (['histogram', 'summary'].includes(String(metric.type))) {
      for (const suffix of ['_bucket', '_sum', '_count']) names.add(`${metric.name}${suffix}`);
    }
  }
  return names;
}

// Metric-looking words in a PromQL expression (ours all start with one of these).
const OURS = /\b(?:http|tickets|outbox|sla|process|nodejs)_[a-z0-9_]+/g;

describe('the Grafana dashboard', () => {
  test('has a stable id, and titles every panel', () => {
    expect(dashboard.uid).toBe('it-ticketing-overview');
    expect(dashboard.panels.length).toBeGreaterThan(0);
    expect(dashboard.panels.every((panel) => panel.title.length > 0)).toBe(true);
  });

  test('only queries metrics the API exports', async () => {
    const exported = await exportedNames();
    const used = new Set<string>();
    for (const panel of dashboard.panels) {
      for (const target of panel.targets) {
        for (const name of target.expr.match(OURS) ?? []) used.add(name);
      }
    }

    expect(used.size).toBeGreaterThan(5);
    const missing = [...used].filter((name) => !exported.has(name));
    expect(missing).toEqual([]);
  });

  test('has a row of panels for the service desk agent, and they query the agent’s metrics', () => {
    const agent = dashboard.panels.filter((panel) => panel.title.startsWith('Agent:'));
    expect(agent.length).toBeGreaterThanOrEqual(8);
    const text = agent.flatMap((panel) => panel.targets.map((t) => t.expr)).join('\n');
    for (const metric of [
      'agent_kill_switch',
      'agent_cost_usd_today',
      'agent_proposals',
      'agent_events',
      'agent_runs',
      'agent_tool_calls_total',
      'agent_tokens_total',
      'agent_run_duration_seconds_bucket',
    ]) {
      expect(text, metric).toContain(metric);
    }
  });

  test('uses only labels the API attaches', () => {
    const labels = new Set([
      'method',
      'route',
      'status',
      'status_class',
      'le',
      'result',
      'kind',
      'outcome',
      'mode',
      'model',
      'tool',
      'is_error',
      'direction',
    ]);
    const text = dashboard.panels.flatMap((panel) => panel.targets.map((t) => t.expr)).join('\n');
    const byClauses = [...text.matchAll(/by \(([^)]*)\)/g)].flatMap((m) =>
      (m[1] ?? '').split(',').map((label) => label.trim())
    );
    expect(byClauses.filter((label) => !labels.has(label))).toEqual([]);
  });
});

describe('the Prometheus and Compose files', () => {
  test('Prometheus scrapes the path the API serves, with a bearer token from a file', () => {
    const config = read('ops/prometheus/prometheus.yml');
    expect(config).toContain('metrics_path: /api/metrics');
    expect(config).toContain('credentials_file: /tmp/metrics_token');
    expect(config).toContain("targets: ['app:5000']");
  });

  test('the overlay gives the app and Prometheus the same token, long enough to be accepted', () => {
    const compose = read('docker-compose.observability.yml');
    const defaults = [...compose.matchAll(/\$\{METRICS_TOKEN:-([^}]+)\}/g)].map((m) => m[1] ?? '');

    expect(defaults).toHaveLength(2); // The app and Prometheus.
    expect(new Set(defaults).size).toBe(1);
    expect(defaults[0]?.length).toBeGreaterThanOrEqual(32);
  });

  test('the datasource uid the dashboard refers to is the one provisioned', () => {
    const datasource = read('ops/grafana/provisioning/datasources/prometheus.yml');
    const uid = /uid: (\w+)/.exec(datasource)?.[1];
    const panelUids = dashboard.panels.flatMap((panel) => {
      const ds = (panel as unknown as { datasource: { uid: string } }).datasource;
      return ds.uid;
    });
    expect(uid).toBe('prometheus');
    expect(new Set(panelUids)).toEqual(new Set([uid]));
  });
});
