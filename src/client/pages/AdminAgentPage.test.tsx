import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { makeAgentSettings, makeRun, makeRunDetail } from '../test/fixtures';
import { installDefaultApi, renderSignedInAs } from '../test/renderApp';

vi.mock('../api', async () => (await import('../test/apiMock')).apiMockFactory());

const page = (runs = [makeRun()], overrides = {}) => ({
  runs,
  pagination: { page: 1, limit: 15, total: runs.length, totalPages: 1, ...overrides },
});

beforeEach(() => {
  vi.clearAllMocks();
  installDefaultApi();
  vi.mocked(api.fetchAgentSettings).mockResolvedValue({ settings: makeAgentSettings() });
  vi.mocked(api.fetchAgentRuns).mockResolvedValue(page());
  vi.mocked(api.fetchAgentRun).mockResolvedValue(makeRunDetail());
  vi.mocked(api.updateAgentSettings).mockImplementation(async (changes) => ({
    settings: makeAgentSettings(changes),
  }));
});

const open = async () => {
  const view = renderSignedInAs('admin', '/admin/agent');
  await screen.findByRole('heading', { name: 'Service desk agent' });
  return { user: userEvent.setup(), ...view };
};

describe('who can open it', () => {
  it.each(['technician', 'user'] as const)('is not for a %s', async (role) => {
    renderSignedInAs(role, '/admin/agent');
    await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Service desk agent' })).not.toBeInTheDocument();
    expect(api.fetchAgentSettings).not.toHaveBeenCalled();
  });

  it('is in the admin’s navigation, and nobody else’s', async () => {
    renderSignedInAs('admin', '/tickets');
    expect(await screen.findByRole('link', { name: 'Agent' })).toHaveAttribute(
      'href',
      '/admin/agent'
    );
  });

  it('is not in a technician’s navigation', async () => {
    renderSignedInAs('technician', '/tickets');
    await screen.findByRole('link', { name: 'Trends' });
    expect(screen.queryByRole('link', { name: 'Agent' })).not.toBeInTheDocument();
  });
});

describe('the status', () => {
  it('says the agent is running, on which model, and what it has spent against its cap', async () => {
    await open();
    expect(await screen.findByText('The agent is running.')).toBeInTheDocument();
    expect(screen.getByText('On in this deployment, using claude-sonnet-5.')).toBeInTheDocument();
    expect(screen.getByText('$0.0234')).toBeInTheDocument();
    expect(screen.getByText(/of \$1\.00/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop the agent' })).toBeInTheDocument();
  });

  it('says so plainly when the deployment has it switched off', async () => {
    vi.mocked(api.fetchAgentSettings).mockResolvedValue({
      settings: makeAgentSettings({ enabled: false }),
    });
    await open();
    expect(await screen.findByText(/Not switched on in this deployment/)).toBeInTheDocument();
  });

  it('shows a load failure with its reference', async () => {
    vi.mocked(api.fetchAgentSettings).mockRejectedValue(
      Object.assign(new Error('The settings are unavailable.'), { requestId: 'req-4' })
    );
    await open();
    expect(await screen.findByText('The settings are unavailable.')).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-4/)).toBeInTheDocument();
  });
});

describe('auto mode and the circuit breaker', () => {
  it('says nothing about either when all is well', async () => {
    await open();
    await screen.findByText('The agent is running.');
    expect(screen.queryByTestId('circuit-open')).not.toBeInTheDocument();
    expect(screen.queryByTestId('auto-unavailable')).not.toBeInTheDocument();
    expect(
      screen.getByRole('option', {
        name: 'Auto: may answer alone, for the categories ticked below',
      })
    ).toBeInTheDocument();
  });

  it('says so, in an alert, when the agent has paused itself, and when it will try again', async () => {
    vi.mocked(api.fetchAgentSettings).mockResolvedValue({
      settings: makeAgentSettings({
        circuit: {
          open: true,
          consecutiveFailures: 5,
          reopensAt: '2026-06-02T09:10:00.000Z',
        },
      }),
    });
    await open();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The agent has paused itself.');
    expect(alert).toHaveTextContent('5 runs failed in a row');
    expect(alert).toHaveTextContent('Jun 2, 2026');
  });

  it('says that auto runs as assist where the deployment does not allow it', async () => {
    vi.mocked(api.fetchAgentSettings).mockResolvedValue({
      settings: makeAgentSettings({ autoAvailable: false }),
    });
    await open();
    expect(await screen.findByTestId('auto-unavailable')).toHaveTextContent(
      'a setting of auto runs as assist here'
    );
  });
});

describe('the kill switch', () => {
  it('stops the agent at once, and says so, and can resume it', async () => {
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Stop the agent' }));

    expect(api.updateAgentSettings).toHaveBeenCalledWith({ killSwitch: true });
    expect(await screen.findByText('The agent is stopped.')).toBeInTheDocument();
    expect(
      await screen.findByText('The agent is stopped. New tickets go straight to people.')
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Resume the agent' }));
    expect(api.updateAgentSettings).toHaveBeenLastCalledWith({ killSwitch: false });
    expect(await screen.findByText('The agent is running.')).toBeInTheDocument();
  });

  it('starts out showing a stopped agent as stopped', async () => {
    vi.mocked(api.fetchAgentSettings).mockResolvedValue({
      settings: makeAgentSettings({ killSwitch: true }),
    });
    await open();
    expect(await screen.findByText('The agent is stopped.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume the agent' })).toBeInTheDocument();
  });

  it('shows the API’s refusal', async () => {
    vi.mocked(api.updateAgentSettings).mockRejectedValue(
      Object.assign(new Error('You do not have permission to perform this action.'), {
        status: 403,
        requestId: 'req-8',
      })
    );
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Stop the agent' }));
    expect(
      await screen.findByText('You do not have permission to perform this action.')
    ).toBeInTheDocument();
    expect(screen.getByText('The agent is running.')).toBeInTheDocument();
  });
});

describe('the settings form', () => {
  it('starts from what is stored, per category', async () => {
    vi.mocked(api.fetchAgentSettings).mockResolvedValue({
      settings: makeAgentSettings({
        defaultMode: 'shadow',
        modeByCategory: { Security: 'off' },
        autoAllowlist: ['Email'],
        dailyCostCapUsd: 2.5,
        perRequesterHourlyLimit: 3,
      }),
    });
    await open();

    expect(await screen.findByLabelText('Default mode')).toHaveValue('shadow');
    expect(screen.getByLabelText('Mode for Security')).toHaveValue('off');
    expect(screen.getByLabelText('Mode for Email')).toHaveValue('default');
    expect(screen.getByLabelText('Email may be posted without a person')).toBeChecked();
    expect(screen.getByLabelText('Network may be posted without a person')).not.toBeChecked();
    expect(screen.getByLabelText('Daily cost cap (US dollars)')).toHaveValue(2.5);
    expect(screen.getByLabelText('Runs per requester per hour')).toHaveValue(3);
  });

  it('saves everything that was changed, and leaves out categories left on the default', async () => {
    const { user } = await open();
    await user.selectOptions(await screen.findByLabelText('Default mode'), 'shadow');
    await user.selectOptions(screen.getByLabelText('Mode for Security'), 'off');
    await user.selectOptions(screen.getByLabelText('Mode for Email'), 'assist');
    await user.click(screen.getByLabelText('Email may be posted without a person'));
    const cap = screen.getByLabelText('Daily cost cap (US dollars)');
    await user.clear(cap);
    await user.type(cap, '0.5');
    const limit = screen.getByLabelText('Runs per requester per hour');
    await user.clear(limit);
    await user.type(limit, '2');

    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(api.updateAgentSettings).toHaveBeenCalledWith({
      defaultMode: 'shadow',
      modeByCategory: { Security: 'off', Email: 'assist' },
      autoAllowlist: ['Email'],
      dailyCostCapUsd: 0.5,
      perRequesterHourlyLimit: 2,
    });
    expect(await screen.findByText('Agent settings saved.')).toBeInTheDocument();
  });

  it('can put a category back on the default', async () => {
    vi.mocked(api.fetchAgentSettings).mockResolvedValue({
      settings: makeAgentSettings({ modeByCategory: { Email: 'off' } }),
    });
    const { user } = await open();
    await user.selectOptions(await screen.findByLabelText('Mode for Email'), 'default');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(api.updateAgentSettings).toHaveBeenCalledWith(
      expect.objectContaining({ modeByCategory: {} })
    );
  });

  it.each([
    ['a negative cap', 'Daily cost cap (US dollars)', '-1', 'Enter zero or more.'],
    ['an empty cap', 'Daily cost cap (US dollars)', '', 'Enter zero or more.'],
    [
      'a fractional limit',
      'Runs per requester per hour',
      '1.5',
      'Enter a whole number, zero or more.',
    ],
    [
      'a negative limit',
      'Runs per requester per hour',
      '-2',
      'Enter a whole number, zero or more.',
    ],
  ])('will not save %s, and says why', async (_what, field, value, message) => {
    const { user } = await open();
    const input = await screen.findByLabelText(field);
    await user.clear(input);
    if (value) await user.type(input, value);

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
    expect(api.updateAgentSettings).not.toHaveBeenCalled();
  });

  it('accepts zero for both limits, which stop the agent running', async () => {
    const { user } = await open();
    for (const field of ['Daily cost cap (US dollars)', 'Runs per requester per hour']) {
      const input = await screen.findByLabelText(field);
      await user.clear(input);
      await user.type(input, '0');
    }
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(api.updateAgentSettings).toHaveBeenCalledWith(
      expect.objectContaining({ dailyCostCapUsd: 0, perRequesterHourlyLimit: 0 })
    );
  });

  it('shows a refusal from the API', async () => {
    vi.mocked(api.updateAgentSettings).mockRejectedValue(
      Object.assign(new Error('"Nonsense" is not a category.'), { status: 400 })
    );
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('"Nonsense" is not a category.')).toBeInTheDocument();
  });
});

describe('the runs', () => {
  it('lists each run with its ticket, outcome, reason, steps, cost and time', async () => {
    vi.mocked(api.fetchAgentRuns).mockResolvedValue(
      page([
        makeRun(),
        makeRun({
          _id: 'r2',
          ticketNumber: 'TKT-0002',
          ticketId: 'ticket-2',
          outcome: 'aborted',
          outcomeReason: 'requester_rate_limited',
          steps: 0,
          costUsd: 0,
          latencyMs: 0,
          hasProposal: false,
        }),
      ])
    );
    await open();

    const rows = await screen.findAllByTestId('agent-run-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole('link', { name: 'TKT-0001' })).toHaveAttribute(
      'href',
      '/tickets/665f0f40d5d4f541f8ef1001'
    );
    expect(within(rows[0]!).getByText('Proposed')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('$0.0090')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('4.2 s')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Aborted')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Requester Rate Limited')).toBeInTheDocument();
  });

  it('says when there are none', async () => {
    vi.mocked(api.fetchAgentRuns).mockResolvedValue(page([]));
    await open();
    expect(await screen.findByText('No runs yet.')).toBeInTheDocument();
  });

  it('filters by outcome, keeping the choice in the address', async () => {
    const { user, router } = await open();
    await screen.findAllByTestId('agent-run-row');
    await user.selectOptions(screen.getByLabelText('Filter runs by outcome'), 'error');

    expect(router.state.location.search).toBe('?outcome=error');
    await waitFor(() =>
      expect(api.fetchAgentRuns).toHaveBeenLastCalledWith(
        expect.objectContaining({ outcome: 'error', page: 1 }),
        expect.anything()
      )
    );
  });

  it('pages through them', async () => {
    vi.mocked(api.fetchAgentRuns).mockResolvedValue(
      page([makeRun()], { total: 40, totalPages: 3 })
    );
    const { user, router } = await open();
    expect(await screen.findByText('Page 1 of 3 · 40 runs')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(router.state.location.search).toBe('?page=2');
  });

  it('opens a run to show its reply, its triage and every step, and closes it again', async () => {
    const { user } = await open();
    await user.click(
      await screen.findByRole('button', { name: 'Details of the run for TKT-0001' })
    );

    const details = await screen.findByRole('region', { name: 'Run details' });
    expect(within(details).getByText(/claude-sonnet-5 · prompt triage.v1/)).toBeInTheDocument();
    expect(within(details).getByText(/Network · High · Network Support/)).toBeInTheDocument();
    expect(
      within(details).getByText('Reconnect the VPN, then restart your laptop if it still drops.')
    ).toBeInTheDocument();
    expect(within(details).getByText('search_kb')).toBeInTheDocument();
    expect(within(details).getByText('articles: KB-006')).toBeInTheDocument();
    expect(within(details).getByText('stopped for: tool_use')).toBeInTheDocument();
    expect(api.fetchAgentRun).toHaveBeenCalledWith('665f0f40d5d4f541f8ef3001', expect.anything());

    await user.click(within(details).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: 'Run details' })).not.toBeInTheDocument();
  });

  it('shows how many attempts a run took, only when it took more than one', async () => {
    vi.mocked(api.fetchAgentRun).mockResolvedValue(
      makeRunDetail({ run: { ...makeRunDetail().run, attempts: 2 } })
    );
    const { user } = await open();
    await user.click(
      await screen.findByRole('button', { name: 'Details of the run for TKT-0001' })
    );
    expect(await screen.findByText(/2 attempts/)).toBeInTheDocument();
  });

  it('shows no attempts for a run that went straight through', async () => {
    const { user } = await open();
    await user.click(
      await screen.findByRole('button', { name: 'Details of the run for TKT-0001' })
    );
    await screen.findByText('search_kb');
    expect(screen.queryByText(/attempts?\b/)).not.toBeInTheDocument();
  });

  it('the same button closes it, and going back to page one when the filter changes', async () => {
    vi.mocked(api.fetchAgentRuns).mockResolvedValue(
      page([makeRun()], { page: 3, totalPages: 3, total: 40 })
    );
    const { router } = renderSignedInAs('admin', '/admin/agent?page=3');
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Service desk agent' });

    const details = await screen.findByRole('button', { name: 'Details of the run for TKT-0001' });
    await user.click(details);
    expect(await screen.findByRole('region', { name: 'Run details' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Details of the run for TKT-0001' }));
    expect(screen.queryByRole('region', { name: 'Run details' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filter runs by outcome'), 'error');
    expect(router.state.location.search).toBe('?outcome=error');
  });

  it('marks a step that only recorded what it would have done, and one that failed', async () => {
    vi.mocked(api.fetchAgentRun).mockResolvedValue(
      makeRunDetail({
        steps: [
          {
            attempt: 1,
            index: 0,
            kind: 'tool',
            toolName: 'set_triage',
            dryRun: true,
            outputSummary: 'would: Network',
            latencyMs: 1,
          },
          {
            attempt: 1,
            index: 1,
            kind: 'tool',
            toolName: 'escalate',
            isError: true,
            outputSummary: 'refused: no',
            latencyMs: 2,
          },
        ],
      })
    );
    const { user } = await open();
    await user.click(
      await screen.findByRole('button', { name: 'Details of the run for TKT-0001' })
    );
    expect(await screen.findByText('set_triage (recorded only)')).toBeInTheDocument();
    expect(screen.getByText('failed: refused: no')).toBeInTheDocument();
  });

  it('shows a failure to load the runs', async () => {
    vi.mocked(api.fetchAgentRuns).mockRejectedValue(
      Object.assign(new Error('The runs are unavailable.'), { requestId: 'req-6' })
    );
    await open();
    expect(await screen.findByText('The runs are unavailable.')).toBeInTheDocument();
  });
});
