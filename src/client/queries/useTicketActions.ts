import { useState } from 'react';
import { exportTickets } from '../api';
import { useNotices } from '../notices/NoticeContext';
import type { Ticket, TicketChanges, TicketFilters, TicketForm } from '../types';
import { useCreateTicket, useDeleteTicket, useUpdateTicket } from './tickets';

// The things a person can do to tickets, each with the notice it earns. The mutations
// underneath keep the cache right; this wires their outcome to the banner.
export function useTicketActions() {
  const notices = useNotices();
  const create = useCreateTicket();
  const update = useUpdateTicket();
  const remove = useDeleteTicket();
  const [exporting, setExporting] = useState(false);

  // Resolves to true when the ticket was created, so the form knows to reset.
  async function createTicket(form: TicketForm): Promise<boolean> {
    notices.clear();
    try {
      await create.mutateAsync(form);
      notices.showSuccess('Ticket created successfully.');
      return true;
    } catch (error) {
      notices.showError(error);
      return false;
    }
  }

  // The change appears at once and is rolled back by the mutation if it is refused.
  function patchTicket(ticket: Ticket, changes: TicketChanges): void {
    notices.clear();
    update.mutate(
      { ticket, changes },
      {
        onSuccess: () => notices.showSuccess('Ticket updated.'),
        onError: (error) => notices.showError(error),
      }
    );
  }

  // Resolves to true when the ticket was deleted.
  async function deleteTicket(id: string): Promise<boolean> {
    if (!window.confirm('Delete this ticket? This cannot be undone.')) return false;

    notices.clear();
    try {
      await remove.mutateAsync(id);
      notices.showSuccess('Ticket deleted.');
      return true;
    } catch (error) {
      notices.showError(error);
      return false;
    }
  }

  async function exportCsv(filters: TicketFilters): Promise<void> {
    setExporting(true);
    notices.clear();

    try {
      const blob = await exportTickets(filters);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'tickets.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      notices.showSuccess('Ticket export downloaded.');
    } catch (error) {
      notices.showError(error);
    } finally {
      setExporting(false);
    }
  }

  return {
    saving: create.isPending,
    exporting,
    createTicket,
    patchTicket,
    deleteTicket,
    exportCsv,
  };
}
