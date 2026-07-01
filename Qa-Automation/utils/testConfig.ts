function normalizeBaseUrl(value: string | undefined) {
  return (value || 'http://localhost:5173').replace(/\/$/, '');
}

export const testConfig = {
  baseUrl: normalizeBaseUrl(process.env.BASE_URL),
};

export function apiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${testConfig.baseUrl}${normalizedPath}`;
}
