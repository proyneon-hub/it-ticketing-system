import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approveProposal,
  fetchAgentRun,
  fetchAgentRuns,
  fetchAgentSettings,
  fetchProposal,
  rejectProposal,
  updateAgentSettings,
} from '../api';
import type { AgentRunsQuery, AgentSettingsChanges } from '../types';
import { commentKeys } from './comments';
import { ticketKeys } from './tickets';

export const agentKeys = {
  proposal: (ticketId: string) => ['agent', 'proposal', ticketId] as const,
  settings: ['agent', 'settings'] as const,
  runs: (query: AgentRunsQuery) => ['agent', 'runs', query] as const,
  run: (id: string) => ['agent', 'run', id] as const,
};

// The agent's drafted reply for a ticket. Only asked for when the ticket says there is one, so a
// ticket the agent never looked at costs no request.
export function useProposal(ticketId: string, enabled: boolean) {
  return useQuery({
    queryKey: agentKeys.proposal(ticketId),
    queryFn: ({ signal }) => fetchProposal(ticketId, { signal }).then((data) => data.proposal),
    enabled,
    // A missing proposal (404) is an answer, not something to retry.
    retry: false,
  });
}

export type ProposalDecision =
  | { kind: 'approve'; replyMarkdown?: string | undefined }
  | { kind: 'reject'; reason?: string | undefined };

// Approving posts a comment and moves the ticket, so all of those are reloaded; rejecting only
// changes where the proposal stands, and its history entry. Reloaded either way, including after a
// refusal, because a refusal means someone else got there first.
export function useDecideProposal(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (decision: ProposalDecision) =>
      decision.kind === 'approve'
        ? approveProposal(
            ticketId,
            decision.replyMarkdown ? { replyMarkdown: decision.replyMarkdown } : {}
          )
        : rejectProposal(ticketId, decision.reason ? { reason: decision.reason } : {}),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: agentKeys.proposal(ticketId) }),
        queryClient.invalidateQueries({ queryKey: commentKeys.thread(ticketId) }),
        queryClient.invalidateQueries({ queryKey: ticketKeys.all }),
      ]),
  });
}

export function useAgentSettings() {
  return useQuery({
    queryKey: agentKeys.settings,
    queryFn: ({ signal }) => fetchAgentSettings({ signal }).then((data) => data.settings),
  });
}

export function useUpdateAgentSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: AgentSettingsChanges) => updateAgentSettings(changes),
    onSuccess: (data) => queryClient.setQueryData(agentKeys.settings, data.settings),
  });
}

export function useAgentRuns(query: AgentRunsQuery) {
  return useQuery({
    queryKey: agentKeys.runs(query),
    queryFn: ({ signal }) => fetchAgentRuns(query, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useAgentRun(id: string | null) {
  return useQuery({
    queryKey: agentKeys.run(id ?? ''),
    queryFn: ({ signal }) => fetchAgentRun(id as string, { signal }),
    enabled: id !== null,
  });
}
