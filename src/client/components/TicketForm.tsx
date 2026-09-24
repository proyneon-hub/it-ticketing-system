import { useState, type FormEvent } from 'react';
import { emptyTicketForm, priorities } from '../constants';
import { label } from '../lib/format';
import type { Role, TicketForm as Form } from '../types';

interface TicketFormProps {
  role: Role;
  saving: boolean;
  // Resolves to true when the ticket was created, so the form knows to reset.
  onCreate: (form: Form) => Promise<boolean>;
}

// Requesters cannot choose who the ticket is for or who owns it; the API
// enforces that too, this just keeps the controls honest.
export default function TicketForm({ role, saving, onCreate }: TicketFormProps) {
  const [form, setForm] = useState<Form>(emptyTicketForm);
  const isRequester = role === 'user';

  function updateField<K extends keyof Form>(field: K, value: Form[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const created = await onCreate(form);
    if (created) setForm(emptyTicketForm);
  }

  return (
    <form className="panel ticket-form" onSubmit={handleSubmit}>
      <div className="section-heading">
        <h2>Create Ticket</h2>
        <p>Requests entered by users are automatically scoped to their account.</p>
      </div>

      <label>
        Title <span>*</span>
        <input
          data-testid="ticket-title"
          value={form.title}
          onChange={(event) => updateField('title', event.target.value)}
          placeholder="Laptop cannot connect to Wi-Fi"
          maxLength={120}
          required
        />
      </label>

      <label>
        Description
        <textarea
          data-testid="ticket-description"
          value={form.description}
          onChange={(event) => updateField('description', event.target.value)}
          placeholder="Describe the issue, device, business impact, and troubleshooting tried."
          rows={4}
          maxLength={2000}
          required
        />
      </label>

      <div className="two-column">
        <label>
          Requester Name
          <input
            value={form.requesterName}
            onChange={(event) => updateField('requesterName', event.target.value)}
            placeholder="Name"
            disabled={isRequester}
          />
        </label>

        <label>
          Requester Email
          <input
            type="email"
            value={form.requesterEmail}
            onChange={(event) => updateField('requesterEmail', event.target.value)}
            placeholder="name@example.com"
            disabled={isRequester}
          />
        </label>
      </div>

      <div className="two-column">
        <label>
          Priority
          <select
            data-testid="ticket-priority"
            value={form.priority}
            onChange={(event) => updateField('priority', event.target.value as Form['priority'])}
          >
            {priorities.map((priority) => (
              <option value={priority} key={priority}>
                {label(priority)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Category
          <input
            value={form.category}
            onChange={(event) => updateField('category', event.target.value)}
            placeholder="Hardware, Access, Network"
          />
        </label>
      </div>

      <label>
        Assignee
        <input
          value={form.assignee}
          onChange={(event) => updateField('assignee', event.target.value)}
          placeholder="Technician or team"
          disabled={isRequester}
        />
      </label>

      <button
        className="primary-button"
        type="submit"
        disabled={saving}
        data-testid="ticket-create-submit"
      >
        {saving ? 'Creating...' : 'Create Ticket'}
      </button>
    </form>
  );
}
