import { parseListQuery } from './tickets';

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
