const API_BASE = '/api';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || 'Request failed.');
  }

  return data;
}

export function fetchTickets(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });

  const query = params.toString() ? `?${params.toString()}` : '';
  return request(`/tickets${query}`);
}

export function fetchStats() {
  return request('/tickets/stats');
}

export function createTicket(ticket) {
  return request('/tickets', {
    method: 'POST',
    body: JSON.stringify(ticket)
  });
}

export function updateTicket(id, patch) {
  return request(`/tickets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
}

export function deleteTicket(id) {
  return request(`/tickets/${id}`, {
    method: 'DELETE'
  });
}
