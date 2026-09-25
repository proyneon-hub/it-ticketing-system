import {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  PRICES,
  addUsage,
  costUsd,
  emptyUsage,
  isPricedModel,
} from './agentPricing';

describe('costUsd', () => {
  // Worked by hand: (1000 x $1 + 500 x $5) per million = $0.0035.
  test('prices plain input and output tokens', () => {
    expect(
      costUsd('claude-haiku-4-5', { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 })
    ).toBeCloseTo(0.0035, 10);
  });

  // 200 plain + 3000 cached reads at a tenth + 1000 cache writes at 1.25x = 1750 input-equivalents;
  // (1750 x $2 + 400 x $10) per million = $0.0075.
  test('prices cache reads at a tenth and cache writes at a quarter more', () => {
    expect(
      costUsd('claude-sonnet-5', { input: 200, output: 400, cacheRead: 3000, cacheWrite: 1000 })
    ).toBeCloseTo(0.0075, 10);
  });

  test('a cached read is cheaper than the same tokens read fresh, and a write dearer', () => {
    const fresh = costUsd('claude-sonnet-5', {
      input: 1000,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
    const read = costUsd('claude-sonnet-5', {
      input: 0,
      output: 0,
      cacheRead: 1000,
      cacheWrite: 0,
    });
    const write = costUsd('claude-sonnet-5', {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 1000,
    });
    expect(read).toBeCloseTo(fresh * CACHE_READ_MULTIPLIER, 12);
    expect(write).toBeCloseTo(fresh * CACHE_WRITE_MULTIPLIER, 12);
  });

  test('no usage costs nothing', () => {
    expect(costUsd('claude-haiku-4-5', emptyUsage())).toBe(0);
  });

  test('output tokens cost more than input tokens for every model', () => {
    for (const price of Object.values(PRICES)) expect(price.output).toBeGreaterThan(price.input);
  });

  test('a model with no price is an error, never a free run', () => {
    const usage = { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 };
    expect(() => costUsd('claude-sonet-5', usage)).toThrow(/No price is known/);
    expect(() => costUsd('', usage)).toThrow(/No price is known/);
    expect(() => costUsd('toString', usage)).toThrow(/No price is known/);
  });

  test('isPricedModel knows exactly the models in the table', () => {
    expect(isPricedModel('claude-haiku-4-5')).toBe(true);
    expect(isPricedModel('claude-sonnet-5')).toBe(true);
    expect(isPricedModel('claude-opus-5')).toBe(false);
    expect(isPricedModel('constructor')).toBe(false);
  });
});

describe('addUsage', () => {
  test('adds every kind of token', () => {
    expect(
      addUsage(
        { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
        { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 }
      )
    ).toEqual({ input: 11, output: 22, cacheRead: 33, cacheWrite: 44 });
  });

  test('leaves what it was given alone', () => {
    const a = emptyUsage();
    addUsage(a, { input: 5, output: 5, cacheRead: 5, cacheWrite: 5 });
    expect(a).toEqual(emptyUsage());
  });
});
