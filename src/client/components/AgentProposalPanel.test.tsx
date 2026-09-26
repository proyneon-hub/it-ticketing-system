import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { deferred, makeComment, makeProposal, makeTicket, withProposal } from '../test/fixtures';
import { installDefaultApi, renderSignedInAs } from '../test/renderApp';
import type { Role } from '../types';

vi.mock('../api', async () => (await import('../test/apiMock')).apiMockFactory());

const ID = '665f0f40d5d4f541f8ef1001';
const REPLY = 'Reconnect the VPN, then restart your laptop if it still drops.';

beforeEach(() => {
  vi.clearAllMocks();
  installDefaultApi();
  vi.mocked(api.fetchTicket).mockResolvedValue({ ticket: withProposal('pending') });
  vi.mocked(api.fetchProposal).mockResolvedValue({ proposal: makeProposal() });
  vi.mocked(api.approveProposal).mockResolvedValue({ status: 'approved' });
  vi.mocked(api.rejectProposal).mockResolvedValue({ status: 'rejected' });
});

async function open(role: Role = 'technician') {
  const view = renderSignedInAs(role, `/tickets/${ID}`);
  await screen.findByRole('heading', { name: 'Comments' });
  return { user: userEvent.setup(), ...view };
}

describe('the drafted reply', () => {
  it('shows staff the reply, how sure the agent is, what it is based on and the triage it chose', async () => {
    await open();

    const panel = await screen.findByRole('region', {
      name: 'Drafted reply from the service desk agent',
    });
    expect(within(panel).getByText('AI-generated')).toBeInTheDocument();
    expect(within(panel).getByTestId('proposal-reply')).toHaveValue(REPLY);
    expect(within(panel).getByText('High')).toBeInTheDocument();
    expect(within(panel).getByText('The article covers exactly this problem.')).toBeInTheDocument();
    expect(within(panel).getByText('KB-006')).toBeInTheDocument();
    expect(within(panel).getByText(/VPN keeps disconnecting/)).toBeInTheDocument();
    expect(
      within(panel).getByText(/Network · High priority · Network Support/)
    ).toBeInTheDocument();
    expect(api.fetchProposal).toHaveBeenCalledWith(ID, expect.anything());
  });

  it.each([['a requester', 'user' as const]])(
    'is not shown to %s, and is not even requested',
    async (_who, role) => {
      await open(role);
      expect(
        screen.queryByText(/Drafted reply from the service desk agent/)
      ).not.toBeInTheDocument();
      expect(api.fetchProposal).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['a ticket the agent never looked at', makeTicket()],
    ['a ticket whose proposal status is none', makeTicket({ agent: { proposalStatus: 'none' } })],
    ['a ticket the agent only triaged', makeTicket({ agent: { triageSource: 'agent' } })],
  ])('is not shown, or requested, for %s', async (_what, ticket) => {
    vi.mocked(api.fetchTicket).mockResolvedValue({ ticket });
    await open();
    expect(screen.queryByTestId('proposal-reply')).not.toBeInTheDocument();
    expect(api.fetchProposal).not.toHaveBeenCalled();
  });

  it('is left out quietly if the proposal is gone (404), and says so for any other failure', async () => {
    vi.mocked(api.fetchProposal).mockRejectedValue(
      Object.assign(new Error('There is no proposal for this ticket.'), { status: 404 })
    );
    const first = await open();
    await waitFor(() => expect(api.fetchProposal).toHaveBeenCalled());
    expect(screen.queryByText('There is no proposal for this ticket.')).not.toBeInTheDocument();
    first.unmount();

    vi.mocked(api.fetchProposal).mockRejectedValue(
      Object.assign(new Error('The database is unavailable.'), { status: 503, requestId: 'req-3' })
    );
    await open();
    expect(await screen.findByText('The database is unavailable.')).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-3/)).toBeInTheDocument();
  });

  it('shows a loading state', async () => {
    vi.mocked(api.fetchProposal).mockReturnValue(deferred().promise as never);
    await open();
    expect(await screen.findByText(/Loading the agent's drafted reply/)).toBeInTheDocument();
  });

  it('marks the triage as the agent’s on the ticket, for staff, until a person changes it', async () => {
    await open();
    expect(await screen.findByText('Triaged by the agent')).toBeInTheDocument();
  });

  it('says nothing about the agent’s triage once a person has taken it over', async () => {
    vi.mocked(api.fetchTicket).mockResolvedValue({
      ticket: makeTicket({ agent: { triageSource: 'human', proposalStatus: 'pending' } }),
    });
    await open();
    await screen.findByTestId('proposal-reply');
    expect(screen.queryByText('Triaged by the agent')).not.toBeInTheDocument();
  });
});

describe('approving', () => {
  it('posts the reply as it is, and says the ticket now waits for the requester', async () => {
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Approve and post' }));

    expect(api.approveProposal).toHaveBeenCalledWith(ID, {});
    expect(
      await screen.findByText(
        /Reply posted to the requester. The ticket now waits for their answer./
      )
    ).toBeInTheDocument();
  });

  it('posts an edited reply, and the button says so', async () => {
    const { user } = await open();
    const box = await screen.findByTestId('proposal-reply');
    await user.clear(box);
    await user.type(box, 'Please restart the VPN client and your laptop, then tell us.');

    await user.click(screen.getByRole('button', { name: 'Approve edited reply' }));

    expect(api.approveProposal).toHaveBeenCalledWith(ID, {
      replyMarkdown: 'Please restart the VPN client and your laptop, then tell us.',
    });
  });

  it('putting the original words back is not an edit', async () => {
    const { user } = await open();
    const box = await screen.findByTestId('proposal-reply');
    await user.type(box, ' extra');
    expect(screen.getByRole('button', { name: 'Approve edited reply' })).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, `  ${REPLY}  `);

    await user.click(screen.getByRole('button', { name: 'Approve and post' }));
    expect(api.approveProposal).toHaveBeenCalledWith(ID, {});
  });

  it('will not post a reply that is too short, and says why', async () => {
    const { user } = await open();
    const box = await screen.findByTestId('proposal-reply');
    await user.clear(box);
    await user.type(box, 'Restart it.');

    expect(screen.getByText('Write at least 20 characters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve edited reply' })).toBeDisabled();
  });

  it('allows a reply of exactly twenty characters, and not one character fewer', async () => {
    const { user } = await open();
    const box = await screen.findByTestId('proposal-reply');
    await user.clear(box);
    await user.type(box, 'x'.repeat(19));
    expect(screen.getByRole('button', { name: 'Approve edited reply' })).toBeDisabled();
    await user.type(box, 'x');
    expect(screen.getByRole('button', { name: 'Approve edited reply' })).toBeEnabled();
  });

  it('sends the edited reply without the spaces around it', async () => {
    const { user } = await open();
    const box = await screen.findByTestId('proposal-reply');
    await user.clear(box);
    await user.type(box, '   Restart the VPN client and your laptop.   ');
    await user.click(screen.getByRole('button', { name: 'Approve edited reply' }));
    expect(api.approveProposal).toHaveBeenCalledWith(ID, {
      replyMarkdown: 'Restart the VPN client and your laptop.',
    });
  });

  it('reloads the thread and the ticket after a decision, so the reply and the new status appear', async () => {
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Approve and post' }));
    await waitFor(() => expect(vi.mocked(api.fetchComments).mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(vi.mocked(api.fetchTicket).mock.calls.length).toBeGreaterThan(1));
  });

  it('starts a fresh draft if the proposal turns out to be a different one', async () => {
    vi.mocked(api.approveProposal).mockRejectedValue(
      Object.assign(new Error('Someone decided first.'), { status: 409 })
    );
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Approve and post' }));
    vi.mocked(api.fetchProposal).mockResolvedValue({
      proposal: makeProposal({
        runId: '665f0f40d5d4f541f8ef3999',
        proposal: { ...makeProposal().proposal, replyMarkdown: 'A newer draft from a newer run.' },
      }),
    });
    await screen.findByText('Someone decided first.');
    await user.click(screen.getByRole('button', { name: 'Approve and post' }));

    expect(await screen.findByDisplayValue('A newer draft from a newer run.')).toBeInTheDocument();
  });

  it('disables the buttons while it posts, so it cannot be posted twice', async () => {
    const pending = deferred<{ status: 'approved' }>();
    vi.mocked(api.approveProposal).mockReturnValue(pending.promise as never);
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Approve and post' }));

    expect(await screen.findByRole('button', { name: 'Posting...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
    pending.resolve({ status: 'approved' });
  });

  it('shows the API’s refusal with its reference, and reloads the proposal, when someone else decided first', async () => {
    vi.mocked(api.approveProposal).mockRejectedValue(
      Object.assign(new Error('This proposal was decided while you were looking at it.'), {
        status: 409,
        code: 'NO_PENDING_PROPOSAL',
        requestId: 'req-9',
      })
    );
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Approve and post' }));

    expect(
      await screen.findByText('This proposal was decided while you were looking at it.')
    ).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-9/)).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(api.fetchProposal).mock.calls.length).toBeGreaterThan(1));
  });
});

describe('rejecting', () => {
  it('asks for an optional reason first, then rejects with it', async () => {
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(api.rejectProposal).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Why\?/), 'Wrong article.');
    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));

    expect(api.rejectProposal).toHaveBeenCalledWith(ID, { reason: 'Wrong article.' });
    expect(
      await screen.findByText('Drafted reply rejected. Nothing was sent to the requester.')
    ).toBeInTheDocument();
  });

  it('does not send a reason that is only spaces', async () => {
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    await user.type(screen.getByLabelText(/Why\?/), '    ');
    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));
    expect(api.rejectProposal).toHaveBeenCalledWith(ID, {});
  });

  it('needs no reason, and can be cancelled', async () => {
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Approve and post' })).toBeInTheDocument();
    expect(api.rejectProposal).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));
    expect(api.rejectProposal).toHaveBeenCalledWith(ID, {});
  });
});

describe('a proposal already decided', () => {
  it.each([
    ['approved', 'Approved and posted to the requester as written.'],
    ['edited', 'Approved after editing, and posted to the requester.'],
    ['rejected', 'Rejected. Nothing was posted to the requester.'],
  ] as const)('shows %s as read-only, with no buttons', async (status, text) => {
    vi.mocked(api.fetchTicket).mockResolvedValue({ ticket: withProposal(status) });
    vi.mocked(api.fetchProposal).mockResolvedValue({ proposal: makeProposal({ status }) });
    await open();

    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByTestId('proposal-reply')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    expect(screen.getByText(REPLY)).toBeInTheDocument();
  });
});

describe('agent comments in the thread', () => {
  it('labels a reply the agent wrote, and who approved it', async () => {
    vi.mocked(api.fetchTicket).mockResolvedValue({ ticket: makeTicket() });
    vi.mocked(api.fetchComments).mockResolvedValue({
      comments: [
        makeComment({
          body: REPLY,
          source: 'agent',
          author: {
            id: 'service-desk-agent',
            name: 'Service Desk Agent',
            email: 'agent@service.local',
            role: 'agent',
          },
          approvedBy: { id: 'usr_tech', name: 'Theo Technician', email: 'tech@demo.local' },
        }),
      ],
    });
    await open('user');

    const [comment] = await screen.findAllByTestId('comment');
    expect(within(comment!).getByText('Service Desk Agent')).toBeInTheDocument();
    expect(within(comment!).getByText('Agent')).toBeInTheDocument();
    expect(
      within(comment!).getByText('AI-generated · approved by Theo Technician')
    ).toBeInTheDocument();
  });

  it('labels an internal note the agent left, without claiming a person approved it', async () => {
    vi.mocked(api.fetchTicket).mockResolvedValue({ ticket: makeTicket() });
    vi.mocked(api.fetchComments).mockResolvedValue({
      comments: [
        makeComment({
          body: 'Escalated by the service desk agent (security_incident).',
          visibility: 'internal',
          source: 'agent',
          author: {
            id: 'service-desk-agent',
            name: 'Service Desk Agent',
            email: 'agent@service.local',
            role: 'agent',
          },
        }),
      ],
    });
    await open('technician');

    const [note] = await screen.findAllByTestId('comment');
    expect(within(note!).getByText('AI-generated')).toBeInTheDocument();
    expect(within(note!).getByText(/Internal note/)).toBeInTheDocument();
    expect(within(note!).queryByText(/approved by/)).not.toBeInTheDocument();
  });
});
