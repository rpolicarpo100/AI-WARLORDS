/**
 * M016 — Stockpile guard + query tests: closed 4-set, rejection battery,
 * fresh-copy semantics, leaf-mirror cross-checks (test-only imports).
 */
import { describe, expect, it } from 'vitest';
import { MAX_ID_LENGTH } from './authority.js';
import { RESOURCE_TYPES } from './map.js';
import {
  isStockpileAmounts,
  isStockpilesData,
  MAX_HOLDER_ID_CHARS,
  STOCKPILES_SCHEMA_VERSION,
  stockpileOf,
  type StockpilesData,
} from './stockpiles.js';

describe('isStockpileAmounts (unit)', () => {
  it('accepts populated and zero amounts', () => {
    expect(isStockpileAmounts({ food: 1, wood: 2, stone: 3, gold: 4 })).toBe(true);
    expect(isStockpileAmounts({ food: 0, wood: 0, stone: 0, gold: 0 })).toBe(true);
    expect(isStockpileAmounts({ food: 4294967295, wood: 0, stone: 0, gold: 0 })).toBe(true);
  });

  it.each([[null], [[]], ['x']] as Array<[unknown]>)('rejects non-object %j', (value) => {
    expect(isStockpileAmounts(value)).toBe(false);
  });

  it.each([
    [{ food: -1, wood: 0, stone: 0, gold: 0 }],
    [{ food: 0, wood: 1.5, stone: 0, gold: 0 }],
    [{ food: 0, wood: 0, stone: 4294967296, gold: 0 }],
    [{ food: 0, wood: 0, stone: 0, gold: 'x' }],
    [{ food: 0, wood: 0, stone: 0 }],
  ] as Array<[unknown]>)('rejects bad amounts %j', (value) => {
    expect(isStockpileAmounts(value)).toBe(false);
  });
});

describe('isStockpilesData (unit)', () => {
  it('accepts empty and populated data', () => {
    expect(isStockpilesData({ schemaVersion: 1, stockpiles: {} })).toBe(true);
    expect(
      isStockpilesData({
        schemaVersion: 1,
        stockpiles: { p1: { food: 5, wood: 0, stone: 0, gold: 1 } },
      }),
    ).toBe(true);
  });

  it.each([[0], [2], ['1'], [null]] as Array<[unknown]>)('rejects version %j', (schemaVersion) => {
    expect(isStockpilesData({ schemaVersion, stockpiles: {} })).toBe(false);
  });

  it('rejects missing version', () => {
    expect(isStockpilesData({ stockpiles: {} })).toBe(false);
  });

  it.each([[null], [[]], ['x']] as Array<[unknown]>)('rejects stockpiles %j', (stockpiles) => {
    expect(isStockpilesData({ schemaVersion: 1, stockpiles })).toBe(false);
  });

  it.each([[''], ['x'.repeat(65)]] as Array<[unknown]>)('rejects holder id %j', (holder) => {
    expect(
      isStockpilesData({
        schemaVersion: 1,
        stockpiles: { [holder as string]: { food: 0, wood: 0, stone: 0, gold: 0 } },
      }),
    ).toBe(false);
  });

  it('rejects malformed holder amounts', () => {
    expect(
      isStockpilesData({
        schemaVersion: 1,
        stockpiles: { p1: { food: 0, wood: 0, stone: 0, gold: -1 } },
      }),
    ).toBe(false);
  });

  it.each([[null], [[]], [7], ['x']] as Array<[unknown]>)('rejects non-object %j', (value) => {
    expect(isStockpilesData(value)).toBe(false);
  });

  it('uses schema version 1', () => {
    expect(STOCKPILES_SCHEMA_VERSION).toBe(1);
  });
});

describe('stockpileOf (unit)', () => {
  const data: StockpilesData = {
    schemaVersion: 1,
    stockpiles: { p1: { food: 5, wood: 0, stone: 0, gold: 1 } },
  };

  it('returns a fresh copy of held amounts (never the live ref)', () => {
    const got = stockpileOf(data, 'p1');
    expect(got).toEqual({ food: 5, wood: 0, stone: 0, gold: 1 });
    expect(got).not.toBe(data.stockpiles['p1']);
  });

  it('returns zeros for unknown holders (fail-soft)', () => {
    expect(stockpileOf(data, 'nobody')).toEqual({ food: 0, wood: 0, stone: 0, gold: 0 });
  });

  it('returns zeros for absent data (fail-soft)', () => {
    expect(stockpileOf(undefined, 'p1')).toEqual({ food: 0, wood: 0, stone: 0, gold: 0 });
  });
});

describe('leaf mirror cross-checks (unit)', () => {
  it('holder cap mirrors authority MAX_ID_LENGTH (divergence fails loud)', () => {
    expect(MAX_HOLDER_ID_CHARS).toBe(MAX_ID_LENGTH);
  });

  it('amount keys mirror RESOURCE_TYPES (divergence fails loud)', () => {
    expect(Object.keys(stockpileOf(undefined, 'nobody')).sort()).toEqual(
      [...RESOURCE_TYPES].sort(),
    );
  });
});
