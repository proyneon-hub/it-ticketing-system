import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <section className="empty-panel">
      <h2>Page not found.</h2>
      <p>
        <Link to="/tickets">Go to the ticket queue</Link>
      </p>
    </section>
  );
}
