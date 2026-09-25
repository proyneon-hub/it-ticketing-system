import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { agentModes, agentOutcomes } from '../../shared/agent-constants';
import { agentCategories } from '../../shared/ticket-constants';
import type { ApiError } from '../api';
import Alert from '../components/Alert';
import Pagination from '../components/Pagination';
import { formatDate, label, usd } from '../lib/format';
import { useNotices } from '../notices/NoticeContext';
import {
  useAgentRun,
  useAgentRuns,
  useAgentSettings,
  useUpdateAgentSettings,
} from '../queries/agent';
import type { AgentMode, AgentOutcome, AgentRunsQuery, AgentSettings } from '../types';

const PAGE_SIZE = 15;

const MODE_TEXT: Record<AgentMode, string> = {
  off: 'Off: does nothing',
  shadow: 'Shadow: records what it would do',
  assist: 'Assist: triages, and a person approves replies',
  auto: 'Auto: not available yet, runs as assist',
};

const DEFAULT_CHOICE = 'default';

// Everything a technician or admin needs to run the agent: the kill switch, what it may do, its
// limits and spend, and a record of its runs. Changing settings is admin-only; the API enforces it.
export default function AdminAgentPage() {
  const settings = useAgentSettings();

  return (
    <section className="panel agent-admin">
      <div className="section-heading">
        <h2>Service desk agent</h2>
        <p>
          What the agent may do, its limits, and everything it has done. Changes take effect on the
          agent&apos;s very next step, with no deploy.
        </p>
      </div>

      {settings.isPending ? <p role="status">Loading the agent&apos;s settings...</p> : null}
      {settings.isError && !(settings.error as ApiError).sessionEnded ? (
        <Alert
          type="error"
          message={settings.error.message}
          requestId={(settings.error as ApiError).requestId}
        />
      ) : null}

      {settings.data ? (
        <Controls key={JSON.stringify(settings.data)} settings={settings.data} />
      ) : null}

      <Runs />
    </section>
  );
}

function Controls({ settings }: { settings: AgentSettings }) {
  const update = useUpdateAgentSettings();
  const { showError, showSuccess, clear } = useNotices();

  const [defaultMode, setDefaultMode] = useState<AgentMode>(settings.defaultMode);
  const [byCategory, setByCategory] = useState<Record<string, AgentMode | typeof DEFAULT_CHOICE>>(
    Object.fromEntries(
      agentCategories.map((category) => [
        category,
        settings.modeByCategory[category] ?? DEFAULT_CHOICE,
      ])
    )
  );
  const [allowlist, setAllowlist] = useState<string[]>(settings.autoAllowlist);
  const [cap, setCap] = useState(String(settings.dailyCostCapUsd));
  const [limit, setLimit] = useState(String(settings.perRequesterHourlyLimit));

  const capNumber = Number(cap);
  const limitNumber = Number(limit);
  const capValid = cap.trim() !== '' && Number.isFinite(capNumber) && capNumber >= 0;
  const limitValid = limit.trim() !== '' && Number.isInteger(limitNumber) && limitNumber >= 0;

  function toggleKillSwitch() {
    clear();
    update.mutate(
      { killSwitch: !settings.killSwitch },
      {
        onSuccess: () =>
          showSuccess(
            settings.killSwitch
              ? 'The agent is running again.'
              : 'The agent is stopped. New tickets go straight to people.'
          ),
        onError: showError,
      }
    );
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!capValid || !limitValid) return;
    clear();
    update.mutate(
      {
        defaultMode,
        modeByCategory: Object.fromEntries(
          Object.entries(byCategory).filter(
            (entry): entry is [string, AgentMode] => entry[1] !== DEFAULT_CHOICE
          )
        ),
        autoAllowlist: allowlist,
        dailyCostCapUsd: capNumber,
        perRequesterHourlyLimit: limitNumber,
      },
      { onSuccess: () => showSuccess('Agent settings saved.'), onError: showError }
    );
  }

  return (
    <>
      <div className={`agent-status ${settings.killSwitch ? 'stopped' : 'running'}`}>
        <div>
          <strong>{settings.killSwitch ? 'The agent is stopped.' : 'The agent is running.'}</strong>
          <p>
            {settings.enabled
              ? `On in this deployment, using ${settings.model}.`
              : 'Not switched on in this deployment: AGENT_ENABLED is not true, or there is no API key. Nothing below has any effect until it is.'}
          </p>
          <p>
            Spent today: <strong>{usd(settings.spentTodayUsd)}</strong> of{' '}
            {usd(settings.dailyCostCapUsd)}.
          </p>
        </div>
        <button
          type="button"
          className={settings.killSwitch ? 'primary-button' : 'danger-button'}
          onClick={toggleKillSwitch}
          disabled={update.isPending}
          data-testid="kill-switch"
        >
          {settings.killSwitch ? 'Resume the agent' : 'Stop the agent'}
        </button>
      </div>

      <form className="agent-form" onSubmit={save}>
        <div>
          <label htmlFor="agent-default-mode">Default mode</label>
          <select
            id="agent-default-mode"
            value={defaultMode}
            onChange={(event) => setDefaultMode(event.target.value as AgentMode)}
          >
            {agentModes.map((mode) => (
              <option key={mode} value={mode}>
                {MODE_TEXT[mode]}
              </option>
            ))}
          </select>
        </div>

        <div className="table-wrap">
          <table>
            <caption>Mode for each category</caption>
            <thead>
              <tr>
                <th>Category</th>
                <th>Mode</th>
                <th>May post alone (auto mode)</th>
              </tr>
            </thead>
            <tbody>
              {agentCategories.map((category) => (
                <tr key={category}>
                  <td>{category}</td>
                  <td>
                    <select
                      aria-label={`Mode for ${category}`}
                      value={byCategory[category]}
                      onChange={(event) =>
                        setByCategory({
                          ...byCategory,
                          [category]: event.target.value as AgentMode,
                        })
                      }
                    >
                      <option value={DEFAULT_CHOICE}>Use the default</option>
                      {agentModes.map((mode) => (
                        <option key={mode} value={mode}>
                          {MODE_TEXT[mode]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${category} may be posted without a person`}
                      checked={allowlist.includes(category)}
                      onChange={(event) =>
                        setAllowlist(
                          event.target.checked
                            ? [...allowlist, category]
                            : allowlist.filter((item) => item !== category)
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="agent-limits">
          <div>
            <label htmlFor="agent-cap">Daily cost cap (US dollars)</label>
            <input
              id="agent-cap"
              type="number"
              min="0"
              step="0.01"
              value={cap}
              onChange={(event) => setCap(event.target.value)}
              aria-invalid={!capValid}
            />
            {!capValid ? <p className="hint error-text">Enter zero or more.</p> : null}
          </div>
          <div>
            <label htmlFor="agent-limit">Runs per requester per hour</label>
            <input
              id="agent-limit"
              type="number"
              min="0"
              step="1"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              aria-invalid={!limitValid}
            />
            {!limitValid ? (
              <p className="hint error-text">Enter a whole number, zero or more.</p>
            ) : null}
          </div>
        </div>

        <button
          className="primary-button"
          type="submit"
          disabled={update.isPending || !capValid || !limitValid}
        >
          {update.isPending ? 'Saving...' : 'Save settings'}
        </button>
      </form>
    </>
  );
}

function readQuery(params: URLSearchParams): AgentRunsQuery {
  const outcome = agentOutcomes.find((candidate) => candidate === params.get('outcome'));
  const page = Number(params.get('page'));
  return {
    outcome: outcome ?? '',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    limit: PAGE_SIZE,
  };
}

function Runs() {
  const [params, setParams] = useSearchParams();
  const query = readQuery(params);
  const runs = useAgentRuns(query);
  const [openId, setOpenId] = useState<string | null>(null);

  function update(next: { outcome?: AgentOutcome | ''; page?: number }) {
    const merged = { ...query, ...next };
    const out = new URLSearchParams();
    if (merged.outcome) out.set('outcome', merged.outcome);
    if (merged.page > 1) out.set('page', String(merged.page));
    setParams(out, { replace: true });
  }

  const rows = runs.data?.runs ?? [];

  return (
    <div className="agent-runs">
      <div className="section-heading horizontal">
        <div>
          <h3>Runs</h3>
          <p>Newest first. Each run is one look at one ticket.</p>
        </div>
        <select
          value={query.outcome}
          onChange={(event) =>
            update({ outcome: event.target.value as AgentOutcome | '', page: 1 })
          }
          aria-label="Filter runs by outcome"
        >
          <option value="">All outcomes</option>
          {agentOutcomes.map((outcome) => (
            <option key={outcome} value={outcome}>
              {label(outcome)}
            </option>
          ))}
        </select>
      </div>

      {runs.isError && !(runs.error as ApiError).sessionEnded ? (
        <Alert
          type="error"
          message={runs.error.message}
          requestId={(runs.error as ApiError).requestId}
        />
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Started</th>
              <th>Ticket</th>
              <th>Mode</th>
              <th>Outcome</th>
              <th>Steps</th>
              <th>Cost</th>
              <th>Time</th>
              <th>
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.isPending ? (
              <tr>
                <td colSpan={8} className="empty-state">
                  Loading runs...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty-state">
                  No runs yet.
                </td>
              </tr>
            ) : (
              rows.map((run) => (
                <tr key={run._id} data-testid="agent-run-row">
                  <td>{formatDate(run.startedAt)}</td>
                  <td>
                    <Link to={`/tickets/${run.ticketId}`}>{run.ticketNumber ?? run.ticketId}</Link>
                  </td>
                  <td>{label(run.mode)}</td>
                  <td>
                    <span className={`outcome-chip ${run.outcome}`}>{label(run.outcome)}</span>
                    {run.outcomeReason ? <small> {label(run.outcomeReason)}</small> : null}
                  </td>
                  <td>{run.steps}</td>
                  <td>{usd(run.costUsd)}</td>
                  <td>{(run.latencyMs / 1000).toFixed(1)} s</td>
                  <td>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setOpenId(openId === run._id ? null : run._id)}
                      aria-expanded={openId === run._id}
                      aria-label={`Details of the run for ${run.ticketNumber ?? run.ticketId}`}
                    >
                      {openId === run._id ? 'Hide' : 'Details'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {runs.data ? (
        <Pagination
          pagination={runs.data.pagination}
          loading={runs.isFetching}
          onPage={(page) => update({ page })}
          noun="runs"
        />
      ) : null}

      {openId ? <RunDetails id={openId} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

function RunDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useAgentRun(id);

  return (
    <section className="run-details" aria-label="Run details">
      <div className="section-heading horizontal">
        <h4>Run details</h4>
        <button className="secondary-button" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      {detail.isPending ? <p role="status">Loading the run...</p> : null}
      {detail.isError ? (
        <Alert
          type="error"
          message={detail.error.message}
          requestId={(detail.error as ApiError).requestId}
        />
      ) : null}
      {detail.data ? (
        <>
          <p>
            {detail.data.run.model} · prompt {detail.data.run.promptVersion} ·{' '}
            {detail.data.run.inputTokens + (detail.data.run.cacheReadTokens ?? 0)} tokens in,{' '}
            {detail.data.run.outputTokens} out
            {detail.data.run.attempts > 1 ? ` · ${detail.data.run.attempts} attempts` : ''}
          </p>
          {detail.data.run.triage ? (
            <p>
              Triage: {detail.data.run.triage.category} · {label(detail.data.run.triage.priority)} ·{' '}
              {detail.data.run.triage.assigneeGroup}
            </p>
          ) : null}
          {detail.data.run.proposal ? (
            <blockquote className="agent-reply">
              {detail.data.run.proposal.replyMarkdown}
            </blockquote>
          ) : null}
          {detail.data.run.escalationSummary ? (
            <pre className="agent-summary">{detail.data.run.escalationSummary}</pre>
          ) : null}
          <div className="table-wrap">
            <table>
              <caption>Steps</caption>
              <thead>
                <tr>
                  <th>#</th>
                  <th>What</th>
                  <th>Result</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {detail.data.steps.map((step) => (
                  <tr key={`${step.attempt}-${step.index}`}>
                    <td>{step.index + 1}</td>
                    <td>
                      {step.kind === 'model' ? 'Model' : (step.toolName ?? 'Tool')}
                      {step.dryRun ? ' (recorded only)' : ''}
                    </td>
                    <td>
                      {step.kind === 'model'
                        ? `stopped for: ${step.stopReason ?? '-'}`
                        : `${step.isError ? 'failed: ' : ''}${step.outputSummary ?? '-'}`}
                    </td>
                    <td>{step.latencyMs} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
