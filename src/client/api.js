const API_BASE = '/api';

let authToken = localStorage.getItem('it_ticketing_token') || '';

export function setAuthToken(token) {
  authToken = token || '';
  if (authToken) {
    localStorage.setItem('it_ticketing_token', authToken);
  } else {
    localStorage.removeItem('it_ticketing_token');
  }
}

// Shared wrapper for every frontend API call. Keeping response parsing and
// error handling here means the React components can stay focused on UI state.
async function request(path, options = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(options.headers || {}),
      },
      ...options,
    });
  } catch (_error) {
    // Network-level failures land here, for example when the API server is not
    // running locally or a Vercel deployment is missing its serverless routes.
    throw new Error(
      'Unable to reach the API. Check that the Vercel deployment includes the /api functions.'
    );
  }

  // DELETE /api/tickets/:id intentionally returns no response body.
  if (response.status === 204) {
    return null;
  }

  // Prefer JSON error messages from the API, but gracefully fall back to text
  // so the UI still shows something helpful for unexpected responses.
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

export function login(credentials) {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
}

export function fetchMe() {
  return request('/auth/me');
}

export function fetchDemoUsers() {
  return request('/auth/demo-users');
}

export function fetchTickets(filters = {}) {
  // Only include filters that have values, so empty dropdowns mean "all".
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });

  const query = params.toString() ? `?${params.toString()}` : '';
  return request(`/tickets${query}`);
}

export async function exportTickets(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });

  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${API_BASE}/tickets/export${query}`, {
    headers: {
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Export failed with status ${response.status}.`);
  }

  return response.blob();
}

export function fetchStats() {
  return request('/tickets/stats');
}

export function createTicket(ticket) {
  return request('/tickets', {
    method: 'POST',
    body: JSON.stringify(ticket),
  });
}

export function updateTicket(id, patch) {
  return request(`/tickets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteTicket(id) {
  return request(`/tickets/${id}`, {
    method: 'DELETE',
  });
}
