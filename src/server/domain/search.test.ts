import { plainWords } from './search';

describe('plainWords', () => {
  test('leaves ordinary words alone', () => {
    expect(plainWords('vpn keeps disconnecting')).toBe('vpn keeps disconnecting');
  });

  test.each([
    ['-vpn', 'vpn'],
    ['printer -offline', 'printer offline'],
    ['--double', 'double'],
    ['"exact phrase"', 'exact phrase'],
    ['back\\slash', 'back slash'],
  ])('strips search syntax from %j', (input, expected) => {
    expect(plainWords(input)).toBe(expected);
  });

  test('keeps a hyphen inside a word', () => {
    expect(plainWords('wi-fi drops')).toBe('wi-fi drops');
  });

  test('never returns nothing for input that had something in it', () => {
    expect(plainWords('"')).toBe('"');
    expect(plainWords('-')).toBe('-');
  });
});
