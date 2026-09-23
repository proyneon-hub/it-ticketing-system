export default function Pagination({ pagination, loading, onPage }) {
  return (
    <div className="pagination-bar" data-testid="ticket-pagination">
      <span>
        Page {pagination.page} of {pagination.totalPages} · {pagination.total} tickets
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
