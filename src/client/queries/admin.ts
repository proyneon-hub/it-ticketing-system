import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { changeUserRole, fetchAudit, fetchUsers } from '../api';
import type { AuditQuery, Role } from '../types';

export const adminKeys = {
  users: ['admin', 'users'] as const,
  audit: (query: AuditQuery) => ['admin', 'audit', query] as const,
};

export function useUsers() {
  return useQuery({
    queryKey: adminKeys.users,
    queryFn: ({ signal }) => fetchUsers({ signal }).then((data) => data.users),
  });
}

export function useChangeRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => changeUserRole(id, role),
    // A refused change (the last admin) leaves the list as the server has it; either way reload it.
    onSettled: () => queryClient.invalidateQueries({ queryKey: adminKeys.users }),
  });
}

export function useAuditLog(query: AuditQuery) {
  return useQuery({
    queryKey: adminKeys.audit(query),
    queryFn: ({ signal }) => fetchAudit(query, { signal }),
    placeholderData: keepPreviousData,
  });
}
