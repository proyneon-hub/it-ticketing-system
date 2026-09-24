import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { deferred, makeComment, makeTicket } from '../test/fixtures';
import { installDefaultApi, renderSignedInAs } from '../test/renderApp';
import type { Role } from '../types';

vi.mock('../api', async () => (await import('../test/apiMock')).apiMockFactory());

const ID = '665f0f40d5d4f541f8ef1001';

beforeEach(() => {
  vi.clearAllMocks();
  installDefaultApi();
  vi.mocked(api.fetchTicket).mockResolvedValue({ ticket: makeTicket() });
});

async function openTicket(role: Role) {
  const view = renderSignedInAs(role, `/tickets/${ID}`);
  await screen.findByRole('heading', { name: 'Comments' });
  return { user: userEvent.setup(), ...view };
}

describe('the thread', () => {
  it('says so when nobody has commented yet', async () => {
    await openTicket('technician');
    expect(await screen.findByText('No comments yet.')).toBeInTheDocument();
  });

  it('shows each comment with who wrote it, and marks an internal note as one', async () => {
    vi.mocked(api.fetchComments).mockResolvedValue({
      comments: [
        makeComment({ body: 'Restarted the switch.' }),
        makeComment({
          _id: '2',
          body: 'Suspect the firmware.',
          visibility: 'internal',
          author: { id: 'u', name: 'Priya Admin', email: 'admin@demo.local', role: 'admin' },
        }),
        makeComment({
          _id: '3',
          body: 'Still down for me.',
          author: { id: 'r', name: 'Una User', email: 'user@demo.local', role: 'user' },
        }),
      ],
    });
    await openTicket('technician');

    const items = await screen.findAllByTestId('comment');
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText('Theo Technician')).toBeInTheDocument();
    expect(within(items[0]!).queryByText(/Internal note/)).not.toBeInTheDocument();
    expect(within(items[1]!).getByText(/Internal note/)).toBeInTheDocument();
    expect(within(items[2]!).getByText('Requester')).toBeInTheDocument();
  });

  it('shows a load failure with its reference', async () => {
    vi.mocked(api.fetchComments).mockRejectedValue(
      Object.assign(new Error('Comments are unavailable.'), { requestId: 'req-77' })
    );
    await openTicket('technician');

    expect(await screen.findByText('Comments are unavailable.')).toBeInTheDocument();
    expect(screen.getByText(/req-77/)).toBeInTheDocument();
  });
});

describe('writing', () => {
  it('lets staff choose between a reply and an internal note, defaulting to a reply', async () => {
    vi.mocked(api.addComment).mockResolvedValue({ comment: makeComment() });
    const { user } = await openTicket('technician');

    expect(screen.getByLabelText('Reply to the requester')).toBeChecked();
    await user.type(screen.getByLabelText('Add a reply or note'), '  Escalating.  ');
    await user.click(screen.getByLabelText('Internal note (staff only)'));
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    expect(api.addComment).toHaveBeenCalledWith(ID, {
      body: 'Escalating.',
      visibility: 'internal',
    });
  });

  it('clears the form and reloads the thread after posting', async () => {
    vi.mocked(api.addComment).mockResolvedValue({ comment: makeComment() });
    const { user } = await openTicket('technician');
    await screen.findByText('No comments yet.');
    vi.mocked(api.fetchComments).mockResolvedValue({
      comments: [makeComment({ body: 'Posted just now.' })],
    });

    await user.type(screen.getByLabelText('Add a reply or note'), 'Posted just now.');
    await user.click(screen.getByLabelText('Internal note (staff only)'));
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    expect(await screen.findByText('Posted just now.', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByLabelText('Add a reply or note')).toHaveValue('');
    expect(screen.getByLabelText('Reply to the requester')).toBeChecked();
  });

  it('gives a requester no way to write an internal note', async () => {
    vi.mocked(api.addComment).mockResolvedValue({ comment: makeComment() });
    const { user } = await openTicket('user');

    expect(screen.queryByLabelText('Internal note (staff only)')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Add a comment'), 'Any update?');
    await user.click(screen.getByRole('button', { name: 'Post comment' }));

    expect(api.addComment).toHaveBeenCalledWith(ID, { body: 'Any update?', visibility: 'public' });
  });

  it('will not post an empty or blank comment', async () => {
    const { user } = await openTicket('technician');
    const post = screen.getByRole('button', { name: 'Post comment' });

    expect(post).toBeDisabled();
    await user.type(screen.getByLabelText('Add a reply or note'), '   ');
    expect(post).toBeDisabled();
  });

  it('disables the button while posting, and keeps the text if it fails', async () => {
    const pending = deferred();
    vi.mocked(api.addComment).mockReturnValue(pending.promise as never);
    const { user } = await openTicket('technician');

    await user.type(screen.getByLabelText('Add a reply or note'), 'Slow one');
    await user.click(screen.getByRole('button', { name: 'Post comment' }));
    expect(await screen.findByRole('button', { name: 'Posting...' })).toBeDisabled();

    pending.reject(Object.assign(new Error('Could not save.'), { requestId: 'req-5' }));
    expect(await screen.findByText('Could not save.')).toBeInTheDocument();
    expect(screen.getByLabelText('Add a reply or note')).toHaveValue('Slow one');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Post comment' })).toBeEnabled());
  });
});
