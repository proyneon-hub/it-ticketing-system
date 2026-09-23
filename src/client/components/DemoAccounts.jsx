import { label } from '../lib/format.js';

// One-click sign-in for each seeded role, so a reviewer can compare what an
// admin, a technician and a requester can do.
export default function DemoAccounts({ demoUsers, onSelect }) {
  if (demoUsers.length === 0) return null;

  return (
    <section className="demo-strip">
      {demoUsers.map((demoUser) => (
        <button
          key={demoUser.email}
          type="button"
          className="demo-account"
          data-testid={`demo-login-${demoUser.role}`}
          onClick={() => onSelect({ email: demoUser.email, password: demoUser.demoPassword })}
        >
          <span>{label(demoUser.role)}</span>
          <strong>{demoUser.email}</strong>
          <small>{demoUser.demoPassword}</small>
        </button>
      ))}
    </section>
  );
}
