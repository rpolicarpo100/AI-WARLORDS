import { describe, expect, it } from 'vitest';
import { deriveSeed, SeededRng } from './rng.js';

describe('constructor validation', () => {
  it.each([[1.5], [-1], [4294967296], ['x'], [NaN]] as Array<[unknown]>)(
    'rejects seed %j',
    (seed) => {
      expect(() => new SeededRng(seed as number)).toThrow(/uint32/);
    },
  );

  it.each([[0], [1], [4294967295]] as Array<[number]>)('accepts boundary seed %j', (seed) => {
    expect(new SeededRng(seed).getState()).toBe(seed);
  });
});

describe('goldens (generated-then-locked from this implementation — regression tripwires)', () => {
  it('locks the first three uint32 of seed 1', () => {
    const rng = new SeededRng(1);
    expect([rng.nextUint32(), rng.nextUint32(), rng.nextUint32()]).toEqual([
      2693262067, 11749833, 2265367787,
    ]);
  });

  it('locks the first uint32 of seed 42', () => {
    expect(new SeededRng(42).nextUint32()).toBe(2581720956);
  });

  it('locks the int/float mappings of seed 7', () => {
    expect(new SeededRng(7).nextInt(100)).toBe(1);
    expect(new SeededRng(7).nextFloat()).toBe(0.011704753153026104);
  });
});

describe('determinism + behavior', () => {
  it('produces identical 100-value sequences for identical seeds', () => {
    const first = new SeededRng(99);
    const second = new SeededRng(99);
    for (let i = 0; i < 100; i += 1) {
      expect(second.nextUint32()).toBe(first.nextUint32());
    }
  });

  it('round-trips through getState: resume continues identically', () => {
    const rng = new SeededRng(5);
    const prefix = [
      rng.nextUint32(),
      rng.nextUint32(),
      rng.nextUint32(),
      rng.nextUint32(),
      rng.nextUint32(),
    ];
    const resumed = new SeededRng(rng.getState());
    expect(prefix).toHaveLength(5);
    for (let i = 0; i < 5; i += 1) {
      expect(resumed.nextUint32()).toBe(rng.nextUint32());
    }
  });

  it('keeps nextInt in [0, bound) (range sanity — not a uniformity proof)', () => {
    const rng = new SeededRng(11);
    for (let i = 0; i < 200; i += 1) {
      const value = rng.nextInt(10);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(10);
    }
  });

  it('always returns 0 for bound 1 (edge)', () => {
    const rng = new SeededRng(3);
    for (let i = 0; i < 10; i += 1) {
      expect(rng.nextInt(1)).toBe(0);
    }
  });

  it('keeps nextFloat in [0, 1)', () => {
    const rng = new SeededRng(13);
    for (let i = 0; i < 200; i += 1) {
      const value = rng.nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it.each([[0], [-1], [1.5]] as Array<[number]>)('rejects bound %j', (bound) => {
    expect(() => new SeededRng(1).nextInt(bound)).toThrow(/positive integer/);
  });
});

describe('deriveSeed (M006)', () => {
  it.each([
    [1.5, 1],
    [-1, 1],
    [4294967296, 1],
    ['x', 1],
    [NaN, 1],
  ] as Array<[unknown, number]>)('rejects seed %j', (seed, seq) => {
    expect(() => deriveSeed(seed as number, seq)).toThrow(/uint32/);
  });

  it.each([
    [1234, 0],
    [1234, -1],
    [1234, 1.5],
    [1234, 4294967296],
  ] as Array<[number, number]>)('rejects seq %j', (seed, seq) => {
    expect(() => deriveSeed(seed, seq)).toThrow(/positive uint32/);
  });

  it.each([
    [1234, 1, 1140473049],
    [1234, 2, 2350140726],
    [0, 1, 24831277],
    [4294967295, 4294967295, 3544189717],
  ] as Array<[number, number, number]>)('locks deriveSeed(%i, %i)', (seed, seq, expected) => {
    expect(deriveSeed(seed, seq)).toBe(expected);
  });
});
