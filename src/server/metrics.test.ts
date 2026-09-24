import { routeLabel } from './metrics';

describe('routeLabel', () => {
  const req = (baseUrl: string, path?: unknown) =>
    ({ baseUrl, route: path === undefined ? undefined : { path } }) as Parameters<
      typeof routeLabel
    >[0];

  test('joins the mount point and the path template', () => {
    expect(routeLabel(req('/api', '/tickets/:id'))).toBe('/api/tickets/:id');
    expect(routeLabel(req('/api', '/tickets/stats/trends'))).toBe('/api/tickets/stats/trends');
  });

  test('a request that matched no route is one fixed label, never its URL', () => {
    expect(routeLabel(req('', undefined))).toBe('unmatched');
    expect(routeLabel(req('/api', undefined))).toBe('unmatched');
  });

  test('copes with the root and with a non-string path (a regular expression route)', () => {
    expect(routeLabel(req('', '/'))).toBe('/');
    expect(routeLabel(req('', /^\/x$/))).toBe('unmatched');
  });
});
