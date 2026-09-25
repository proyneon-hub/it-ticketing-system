import type { EvalReport, Rate, Summary } from './types';

// Turns a report into the summary a person reads. Every number here came from the run; nothing is
// estimated. A result from the offline oracle says so at the top, and so does one that was cut short.

const pct = (r: Rate): string =>
  r.rate === null ? 'n/a' : `${(r.rate * 100).toFixed(1)}% (${r.hits}/${r.n})`;
const usd = (value: number | null): string => (value === null ? 'n/a' : `$${value.toFixed(4)}`);
const secs = (ms: number | null): string => (ms === null ? 'n/a' : `${(ms / 1000).toFixed(1)} s`);

export function renderMarkdown(report: EvalReport): string {
  const { meta, summary: s } = report;
  const lines: string[] = [];

  lines.push(`# Evaluation: ${meta.model}, prompt ${meta.promptVersion}, ${meta.date}`);
  lines.push('');
  if (!meta.measured) {
    lines.push(
      '> **This is not a measurement of a model.** It was produced by the offline oracle, which reads the answer key and answers through the same tools. It checks that the evaluation works (every ticket can be answered, and a perfect agent scores 100%). The cost and latency below are not real.'
    );
    lines.push('');
  }
  if (meta.truncated) {
    lines.push(`> **Cut short:** ${meta.truncated}`);
    lines.push('');
  }
  lines.push(
    `Source: ${meta.source}. Tickets: ${meta.dataset.run} of ${meta.dataset.total} (${meta.dataset.subset}) from \`${meta.dataset.file}\`.`
  );
  lines.push('');
  lines.push('| Metric | Result |');
  lines.push('| --- | --- |');
  lines.push(`| Category accuracy | ${pct(s.category)} |`);
  lines.push(`| Priority, exact | ${pct(s.priorityExact)} |`);
  lines.push(`| Priority, within one level | ${pct(s.priorityWithinOne)} |`);
  lines.push(`| Assignee group | ${pct(s.group)} |`);
  lines.push(`| Right action (resolve or escalate) | ${pct(s.action)} |`);
  lines.push(`| Escalation precision | ${pct(s.escalation.precision)} |`);
  lines.push(`| Escalation recall | ${pct(s.escalation.recall)} |`);
  lines.push(
    `| **Security tickets missed** (must be 0) | **${s.security.missed}** of ${s.security.n} (${s.security.misrouted} escalated to the wrong group) |`
  );
  lines.push(`| Citation validity | ${pct(s.citationValidity)} |`);
  lines.push(`| Step groundedness (model-graded) | ${pct(s.groundedness)} |`);
  lines.push(
    `| Injection tickets with no out-of-policy call | ${pct(s.injection.resistance)} (${s.injection.violations} violation${s.injection.violations === 1 ? '' : 's'}) |`
  );
  lines.push(`| Cost per ticket, median / p95 | ${usd(s.cost.median)} / ${usd(s.cost.p95)} |`);
  lines.push(`| Cost, total | ${usd(s.cost.total)} |`);
  lines.push(
    `| Latency per ticket, median / p95 | ${secs(s.latencyMs.median)} / ${secs(s.latencyMs.p95)} |`
  );
  lines.push(
    `| Cached share of input tokens | ${s.cacheReadShare === null ? 'n/a' : `${(s.cacheReadShare * 100).toFixed(1)}%`} |`
  );
  lines.push(`| Runs that failed | ${s.errors} of ${s.n} |`);
  lines.push('');

  const wrong = report.cases.filter(
    (c) =>
      !c.score.actionOk ||
      !c.score.categoryOk ||
      c.score.citationValid === false ||
      c.score.injectionViolation
  );
  if (wrong.length > 0) {
    lines.push('## Tickets to look at');
    lines.push('');
    lines.push('| Ticket | Tags | Expected | Got | Note |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const c of wrong) {
      const got = `${c.score.action}${c.actual.triage ? ` (${c.actual.triage.category}/${c.actual.triage.priority})` : ''}`;
      const notes = [
        c.actual.error ? `error: ${c.actual.error.slice(0, 80)}` : '',
        c.score.citationValid === false ? 'citation' : '',
        c.score.injectionViolation ? 'out-of-policy call' : '',
        c.score.securityMissed ? 'SECURITY MISSED' : '',
      ]
        .filter(Boolean)
        .join('; ');
      lines.push(
        `| ${c.id} | ${c.tags.join(', ')} | ${c.expected.action} (${c.expected.category}/${c.expected.priority}) | ${got} | ${notes} |`
      );
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

// One row for docs/EVAL_HISTORY.md.
export function historyRow(report: EvalReport, { note = '' }: { note?: string } = {}): string {
  const { meta, summary: s } = report;
  const cell = (r: Rate) => (r.rate === null ? 'n/a' : `${(r.rate * 100).toFixed(1)}%`);
  return `| ${meta.date} | ${meta.promptVersion} | ${meta.model} | ${meta.dataset.run} | ${cell(s.category)} | ${s.security.missed} of ${s.security.n} | ${cell(s.citationValidity)} | ${cell(s.injection.resistance)} | ${usd(s.cost.median)} | ${note} |`;
}

export const summaryLine = (s: Summary): string =>
  `category ${pct(s.category)}, action ${pct(s.action)}, security missed ${s.security.missed}/${s.security.n}, citations ${pct(s.citationValidity)}, injection ${pct(s.injection.resistance)}, median cost ${usd(s.cost.median)}`;
