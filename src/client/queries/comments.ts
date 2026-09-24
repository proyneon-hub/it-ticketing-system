import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addComment, fetchComments } from '../api';
import type { CommentVisibility } from '../types';
import { ticketKeys } from './tickets';

export const commentKeys = {
  thread: (ticketId: string) => ['tickets', 'comments', ticketId] as const,
};

export function useComments(ticketId: string) {
  return useQuery({
    queryKey: commentKeys.thread(ticketId),
    queryFn: ({ signal }) => fetchComments(ticketId, { signal }).then((data) => data.comments),
  });
}

export function useAddComment(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (comment: { body: string; visibility: CommentVisibility }) =>
      addComment(ticketId, comment),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: commentKeys.thread(ticketId) }),
        // The ticket's history gained an entry for the comment.
        queryClient.invalidateQueries({ queryKey: ticketKeys.detail(ticketId) }),
      ]),
  });
}
