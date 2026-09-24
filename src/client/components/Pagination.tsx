import type { Pagination as PaginationInfo } from '../types';

interface PaginationProps {
  pagination: PaginationInfo;
  loading: boolean;
  onPage: (page: number) => void;
  // What is being paged, for the summary line: "tickets", "events".
  noun?: string;
}

export default function Pagination({
  pagination,
  loading,
  onPage,
  noun = 'tickets',
}: PaginationProps) {
  return (
    <div className="pagination-bar" data-testid="ticket-pagination">
      <span>
        Page {pagination.page} of {pagination.totalPages} · {pagination.total} {noun}
      </span>
      <div>
        <button
          className="secondary-button compact-button"
          type="button"
          onClick={() => onPage(pagination.page - 1)}
          disabled={loading || pagination.page <= 1}
        >
          Previous
        </button>
        <button
          className="secondary-button compact-button"
          type="button"
          onClick={() => onPage(pagination.page + 1)}
          disabled={loading || pagination.page >= pagination.totalPages}
        >
          Next
        </button>
      </div>
    </div>
  );
}
