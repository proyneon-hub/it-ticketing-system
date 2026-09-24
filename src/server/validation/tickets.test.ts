import { parseExpectedVersion, parseListQuery } from './tickets';

describe('parseListQuery', () => {
  test('leaves sortBy unset when the client did not ask for one, so the service can rank search results', () => {
    expect(parseListQuery({}).sortBy).toBeUndefined();
    expect(parseListQuery({ sortBy: '' }).sortBy).toBeUndefined();
    expect(parseListQuery({ sortBy: 'priority' }).sortBy).toBe('priority');
  });

  test('still defaults the order, page and page size', () => {
    expect(parseListQuery({})).toMatchObject({ sortOrder: 'desc', page: 1, limit: 10 });
  });
});

describe('parseExpectedVersion', () => {
  test('takes the version from If-Match, X-Ticket-Version, or neither', () => {
    expect(parseExpectedVersion('"3"', undefined)).toBe(3);
    expect(parseExpectedVersion(undefined, '4')).toBe(4);
    expect(parseExpectedVersion(undefined, undefined)).toBeUndefined();
  });

  test('X-Ticket-Version wins when both are sent', () => {
    expect(parseExpectedVersion('"3"', '5')).toBe(5);
  });

  test('* means no precondition, and a malformed value names its header', () => {
    expect(parseExpectedVersion('*', undefined)).toBeUndefined();
    expect(() => parseExpectedVersion(undefined, 'x')).toThrow(/^X-Ticket-Version must be/);
    expect(() => parseExpectedVersion('x', undefined)).toThrow(/^If-Match must be/);
  });
});
