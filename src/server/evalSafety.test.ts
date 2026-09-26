import { assertLocalDatabase, isLocalUri, keyFromEnvFile } from '../../scripts/eval/safety';

describe('isLocalUri', () => {
  test.each([
    'mongodb://127.0.0.1:52341/',
    'mongodb://127.0.0.1:52341/?replicaSet=rs0',
    'mongodb://127.0.0.1/db',
    'mongodb://localhost:27017/it_ticketing',
    'mongodb://localhost',
    'mongodb://[::1]:27017/db',
    'mongodb://user:pass@127.0.0.1:27017/db',
  ])('%s is local', (uri) => {
    expect(isLocalUri(uri)).toBe(true);
  });

  test.each([
    'mongodb+srv://user:pass@cluster0.abcde.mongodb.net/it_ticketing',
    'mongodb://cluster0.abcde.mongodb.net:27017/db',
    'mongodb://mongo:27017/it_ticketing',
    'mongodb://192.0.2.1:27017/db',
    'mongodb://10.0.0.5/db',
    // Hosts that merely start with, or contain, a local name.
    'mongodb://127.0.0.1.evil.example:27017/db',
    'mongodb://localhost.evil.example/db',
    'mongodb://evil.example/localhost',
    'mongodb://evil.example/?host=localhost',
    // The trick of putting a local name where the user name goes.
    'mongodb://localhost@evil.example/db',
    'mongodb://127.0.0.1:pass@evil.example/db',
    'mongodb://user:pass@evil.example:27017/127.0.0.1',
    // Not an address at all.
    '',
    'localhost',
    '127.0.0.1',
    'http://127.0.0.1:27017',
    'file:///etc/passwd',
  ])('%s is not', (uri) => {
    expect(isLocalUri(uri)).toBe(false);
  });
});

describe('assertLocalDatabase', () => {
  test('passes when both the address and the host it connected to are local', () => {
    expect(() => assertLocalDatabase('mongodb://127.0.0.1:1234/', '127.0.0.1')).not.toThrow();
    expect(() => assertLocalDatabase('mongodb://localhost:1234/', 'localhost')).not.toThrow();
    expect(() => assertLocalDatabase('mongodb://[::1]:1234/', '::1')).not.toThrow();
  });

  test('refuses when the address is not local', () => {
    expect(() =>
      assertLocalDatabase('mongodb+srv://u:p@cluster0.mongodb.net/db', '127.0.0.1')
    ).toThrow(/not local/);
  });

  test('refuses when the address looks local but it actually connected somewhere else', () => {
    expect(() =>
      assertLocalDatabase('mongodb://127.0.0.1:1234/', 'cluster0-shard-00-00.mongodb.net')
    ).toThrow(/not local/);
  });

  test('refuses when it is not known where it connected', () => {
    expect(() => assertLocalDatabase('mongodb://127.0.0.1:1234/', undefined)).toThrow(/not local/);
    expect(() => assertLocalDatabase('mongodb://127.0.0.1:1234/', '')).toThrow(/not local/);
  });
});

describe('keyFromEnvFile', () => {
  test('reads the key, and nothing else in the file', () => {
    const env =
      'MONGODB_URI=mongodb+srv://u:secret@cluster0.mongodb.net/db\nANTHROPIC_API_KEY=sk-ant-abc123\nAUTH_SECRET=xyz\n';
    expect(keyFromEnvFile(env)).toBe('sk-ant-abc123');
  });

  test.each([
    ['double quotes', 'ANTHROPIC_API_KEY="sk-ant-abc123"'],
    ['single quotes', "ANTHROPIC_API_KEY='sk-ant-abc123'"],
    ['spaces around it', 'ANTHROPIC_API_KEY=  sk-ant-abc123  '],
    ['Windows line endings', 'OTHER=1\r\nANTHROPIC_API_KEY=sk-ant-abc123\r\nMORE=2\r\n'],
  ])('reads it with %s', (_what, text) => {
    expect(keyFromEnvFile(text)).toBe('sk-ant-abc123');
  });

  test.each([
    ['no such line', 'MONGODB_URI=mongodb://x\n'],
    ['an empty value', 'ANTHROPIC_API_KEY=\n'],
    ['a blank value', 'ANTHROPIC_API_KEY=   \n'],
    ['empty quotes', 'ANTHROPIC_API_KEY=""\n'],
    ['a commented-out line', '# ANTHROPIC_API_KEY=sk-ant-abc123\n'],
    ['an indented line', '  ANTHROPIC_API_KEY=sk-ant-abc123\n'],
    ['a different variable that merely ends the same', 'MY_ANTHROPIC_API_KEY=sk-ant-abc123\n'],
    ['an empty file', ''],
  ])('finds nothing in %s', (_what, text) => {
    expect(keyFromEnvFile(text)).toBeUndefined();
  });

  test('takes the first if there are two, as a shell would not, so a stray second cannot override', () => {
    expect(keyFromEnvFile('ANTHROPIC_API_KEY=first\nANTHROPIC_API_KEY=second\n')).toBe('first');
  });
});
