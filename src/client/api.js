const API_BASE = '/api';

async function request(path, options = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options
    });
  } catch (_error) {
    throw new Error('Unable to reach the API. Check that the Vercel deployment includes the /api functions.');
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : { message: await response.text().catch(() => '') };

  if (!response.ok) {
    const fallback = `Request failed with status ${response.status}.`;
    const message = typeof data.message === 'string' ? data.message.trim() : '';
    throw new Error(message.slice(0, 300) || fallback);
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
