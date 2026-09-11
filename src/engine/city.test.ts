/**
 * M019 — City guard + query tests: levels 1|2|3, queue items, holder
 * cities, virtual-city fail-soft, leaf-mirror cross-checks (test-only
 * imports).
 */
import { describe, expect, it } from 'vitest';
import { BUILDING_IDS } from './buildings.js';
import {
  CITIES_SCHEMA_VERSION,
  cityOf,
  isCitiesData,
  isCityState,
  isQueueBuilding,
  isQueueItem,
  MAX_HOLDER_ID_CHARS,
  QUEUE_BUILDINGS,
  type CitiesData,
} from './city.js';
import { MAX_HOLDER_ID_CHARS as STOCKPILE_HOLDER_CAP } from './stockpiles.js';

describe('isQueueBuilding (unit)', () => {
  it('accepts the six building ids', () => {
    for (const id of ['town-center', 'house', 'storage', 'barracks', 'wall', 'tower']) {
      expect(isQueueBuilding(id)).toBe(true);
    }
  });

  it.each([[null], [[]], ['x'], ['Town Center'], [''], [42]] as Array<[unknown]>)(
    'rejects non-id %j',
    (value) => {
      expect(isQueueBuilding(value)).toBe(false);
    },
  );
});

describe('QUEUE_BUILDINGS (unit)', () => {
  it('locks the building vocabulary in master order', () => {
    expect(QUEUE_BUILDINGS).toEqual([
      'town-center',
      'house',
      'storage',
      'barracks',
      'wall',
      'tower',
    ]);
  });
});

describe('isQueueItem (unit)', () => {
  it('accepts populated and zero-remaining items', () => {
    expect(isQueueItem({ type: 'tower', remaining: 3 })).toBe(true);
    expect(isQueueItem({ type: 'house', remaining: 0 })).toBe(true);
  });

  it.each([[null], [[]], ['x']] as Array<[unknown]>)('rejects non-object %j', (value) => {
    expect(isQueueItem(value)).toBe(false);
  });

  it.each([
    [{ type: 'lava', remaining: 1 }],
    [{ type: 'tower', remaining: -1 }],
    [{ type: 'tower', remaining: 1.5 }],
    [{ type: 'tower', remaining: 'x' }],
  ] as Array<[unknown]>)('rejects bad item %j', (value) => {
    expect(isQueueItem(value)).toBe(false);
  });
});

describe('isCityState (unit)', () => {
  it('accepts levels 1, 2 and 3', () => {
    expect(isCityState({ level: 1, queue: [] })).toBe(true);
    expect(isCityState({ level: 2, queue: [{ type: 'house', remaining: 2 }] })).toBe(true);
    expect(isCityState({ level: 3, queue: [] })).toBe(true);
  });

  it.each([[null], [[]], ['x']] as Array<[unknown]>)('rejects non-object %j', (value) => {
    expect(isCityState(value)).toBe(false);
  });

  it.each([[0], [4], ['x']] as Array<[unknown]>)('rejects bad level %j', (level) => {
    expect(isCityState({ level, queue: [] })).toBe(false);
  });

  it('rejects a non-array queue', () => {
    expect(isCityState({ level: 1, queue: {} })).toBe(false);
  });

  it('rejects a queue with a bad item', () => {
    expect(
      isCityState({ level: 1, queue: [{ type: 'house', remaining: 1 }, { type: 'lava' }] }),
    ).toBe(false);
  });
});

describe('isCitiesData (unit)', () => {
  it('accepts empty and populated data', () => {
    expect(isCitiesData({ schemaVersion: 1, cities: {} })).toBe(true);
    expect(
      isCitiesData({
        schemaVersion: 1,
        cities: { p1: { level: 2, queue: [{ type: 'tower', remaining: 1 }] } },
      }),
    ).toBe(true);
  });

  it.each([[0], [2], ['1'], [null]] as Array<[unknown]>)('rejects version %j', (schemaVersion) => {
    expect(isCitiesData({ schemaVersion, cities: {} })).toBe(false);
  });

  it('rejects missing version', () => {
    expect(isCitiesData({ cities: {} })).toBe(false);
  });

  it.each([[null], [[]], ['x']] as Array<[unknown]>)('rejects cities %j', (cities) => {
    expect(isCitiesData({ schemaVersion: 1, cities })).toBe(false);
  });

  it.each([[''], ['x'.repeat(65)]] as Array<[unknown]>)('rejects holder id %j', (holder) => {
    expect(
      isCitiesData({
        schemaVersion: 1,
        cities: { [holder as string]: { level: 1, queue: [] } },
      }),
    ).toBe(false);
  });

  it('rejects a malformed holder city', () => {
    expect(isCitiesData({ schemaVersion: 1, cities: { p1: { level: 4, queue: [] } } })).toBe(false);
  });

  it.each([[null], [[]], [7], ['x']] as Array<[unknown]>)('rejects non-object %j', (value) => {
    expect(isCitiesData(value)).toBe(false);
  });

  it('uses schema version 1', () => {
    expect(CITIES_SCHEMA_VERSION).toBe(1);
  });
});

describe('cityOf (unit)', () => {
  const data: CitiesData = {
    schemaVersion: 1,
    cities: { p1: { level: 2, queue: [{ type: 'tower', remaining: 1 }] } },
  };

  it('returns a fresh copy of the held city (never live refs)', () => {
    const got = cityOf(data, 'p1');
    expect(got).toEqual({ level: 2, queue: [{ type: 'tower', remaining: 1 }] });
    const held = data.cities['p1'];
    if (held === undefined) {
      throw new Error('TEST BUG: fixture city missing');
    }
    expect(got.queue).not.toBe(held.queue);
    expect(got.queue[0]).not.toBe(held.queue[0]);
    expect(got.queue[0]).toEqual({ type: 'tower', remaining: 1 });
  });

  it('returns a virtual level-1 idle city for unknown holders (fail-soft)', () => {
    expect(cityOf(data, 'nobody')).toEqual({ level: 1, queue: [] });
  });

  it('returns a virtual level-1 idle city for absent data (fail-soft)', () => {
    expect(cityOf(undefined, 'p1')).toEqual({ level: 1, queue: [] });
  });
});

describe('leaf mirror cross-checks (unit)', () => {
  it('holder cap mirrors stockpiles (divergence fails loud)', () => {
    expect(MAX_HOLDER_ID_CHARS).toBe(STOCKPILE_HOLDER_CAP);
  });

  it('queue vocabulary mirrors BUILDING_IDS exactly (divergence fails loud)', () => {
    expect(QUEUE_BUILDINGS).toEqual(BUILDING_IDS);
  });
});
