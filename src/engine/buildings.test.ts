/**
 * M018 — Building guard + query tests: closed #16 6-set, rejection
 * battery, fresh-copy semantics, leaf-mirror cross-checks (test-only
 * imports), master vocabulary lock.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILDING_IDS,
  BUILDINGS_SCHEMA_VERSION,
  countsOf,
  isBuildingCounts,
  isBuildingId,
  isBuildingsData,
  MAX_HOLDER_ID_CHARS,
  type BuildingsData,
} from './buildings.js';
import { MAX_HOLDER_ID_CHARS as STOCKPILE_HOLDER_CAP } from './stockpiles.js';

const ZERO_COUNTS = {
  'town-center': 0,
  house: 0,
  storage: 0,
  barracks: 0,
  wall: 0,
  tower: 0,
};

function counts(overrides: Record<string, unknown>): unknown {
  return { ...ZERO_COUNTS, ...overrides };
}

describe('isBuildingId (unit)', () => {
  it('accepts the six master #16 ids', () => {
    for (const id of ['town-center', 'house', 'storage', 'barracks', 'wall', 'tower']) {
      expect(isBuildingId(id)).toBe(true);
    }
  });

  it.each([[null], [[]], ['x'], ['Town Center'], [''], [42]] as Array<[unknown]>)(
    'rejects non-id %j',
    (value) => {
      expect(isBuildingId(value)).toBe(false);
    },
  );
});

describe('BUILDING_IDS (unit)', () => {
  it('locks the master #16 vocabulary in master order', () => {
    expect(BUILDING_IDS).toEqual(['town-center', 'house', 'storage', 'barracks', 'wall', 'tower']);
  });
});

describe('isBuildingCounts (unit)', () => {
  it('accepts populated, zero and max counts', () => {
    expect(isBuildingCounts(counts({ 'town-center': 1, storage: 3 }))).toBe(true);
    expect(isBuildingCounts(counts({}))).toBe(true);
    expect(isBuildingCounts(counts({ tower: 4294967295 }))).toBe(true);
  });

  it.each([[null], [[]], ['x']] as Array<[unknown]>)('rejects non-object %j', (value) => {
    expect(isBuildingCounts(value)).toBe(false);
  });

  it.each([
    [counts({ 'town-center': -1 })],
    [counts({ house: 1.5 })],
    [counts({ storage: 4294967296 })],
    [counts({ barracks: 'x' })],
    [counts({ wall: -1 })],
    [counts({ tower: 1.5 })],
    [{ 'town-center': 0, house: 0, storage: 0, barracks: 0, wall: 0 }],
  ] as Array<[unknown]>)('rejects bad counts %j', (value) => {
    expect(isBuildingCounts(value)).toBe(false);
  });
});

describe('isBuildingsData (unit)', () => {
  it('accepts empty and populated data', () => {
    expect(isBuildingsData({ schemaVersion: 1, buildings: {} })).toBe(true);
    expect(
      isBuildingsData({
        schemaVersion: 1,
        buildings: {
          p1: { 'town-center': 1, house: 2, storage: 0, barracks: 0, wall: 0, tower: 0 },
        },
      }),
    ).toBe(true);
  });

  it.each([[0], [2], ['1'], [null]] as Array<[unknown]>)('rejects version %j', (schemaVersion) => {
    expect(isBuildingsData({ schemaVersion, buildings: {} })).toBe(false);
  });

  it('rejects missing version', () => {
    expect(isBuildingsData({ buildings: {} })).toBe(false);
  });

  it.each([[null], [[]], ['x']] as Array<[unknown]>)('rejects buildings %j', (buildings) => {
    expect(isBuildingsData({ schemaVersion: 1, buildings })).toBe(false);
  });

  it.each([[''], ['x'.repeat(65)]] as Array<[unknown]>)('rejects holder id %j', (holder) => {
    expect(
      isBuildingsData({
        schemaVersion: 1,
        buildings: { [holder as string]: ZERO_COUNTS },
      }),
    ).toBe(false);
  });

  it('rejects malformed holder counts', () => {
    expect(
      isBuildingsData({
        schemaVersion: 1,
        buildings: {
          p1: { 'town-center': 0, house: 0, storage: 0, barracks: 0, wall: 0, tower: -1 },
        },
      }),
    ).toBe(false);
  });

  it.each([[null], [[]], [7], ['x']] as Array<[unknown]>)('rejects non-object %j', (value) => {
    expect(isBuildingsData(value)).toBe(false);
  });

  it('uses schema version 1', () => {
    expect(BUILDINGS_SCHEMA_VERSION).toBe(1);
  });
});

describe('countsOf (unit)', () => {
  const data: BuildingsData = {
    schemaVersion: 1,
    buildings: {
      p1: { 'town-center': 1, house: 2, storage: 0, barracks: 0, wall: 0, tower: 0 },
    },
  };

  it('returns a fresh copy of held counts (never the live ref)', () => {
    const got = countsOf(data, 'p1');
    expect(got).toEqual({
      'town-center': 1,
      house: 2,
      storage: 0,
      barracks: 0,
      wall: 0,
      tower: 0,
    });
    expect(got).not.toBe(data.buildings['p1']);
  });

  it('returns zeros for unknown holders (fail-soft)', () => {
    expect(countsOf(data, 'nobody')).toEqual(ZERO_COUNTS);
  });

  it('returns zeros for absent data (fail-soft)', () => {
    expect(countsOf(undefined, 'p1')).toEqual(ZERO_COUNTS);
  });
});

describe('leaf mirror cross-checks (unit)', () => {
  it('holder cap mirrors stockpiles (divergence fails loud)', () => {
    expect(MAX_HOLDER_ID_CHARS).toBe(STOCKPILE_HOLDER_CAP);
  });

  it('count keys mirror BUILDING_IDS (divergence fails loud)', () => {
    expect(Object.keys(countsOf(undefined, 'nobody')).sort()).toEqual([...BUILDING_IDS].sort());
  });
});
