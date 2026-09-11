/**
 * M021 — Unit data tests: MVP vocabulary, instance/data guards, id
 * uniqueness, holder queries, leaf-mirror cross-checks (test-only
 * imports).
 */
import { describe, expect, it } from 'vitest';
import { MAX_ID_LENGTH } from './authority.js';
import { MAX_HOLDER_ID_CHARS as STOCKPILE_HOLDER_CAP } from './stockpiles.js';
import {
  isUnitInstance,
  isUnitType,
  isUnitsData,
  MAX_HOLDER_ID_CHARS,
  MAX_UNIT_ID_CHARS,
  unitById,
  UNIT_TYPES,
  UNITS_SCHEMA_VERSION,
  unitsOf,
  type UnitsData,
} from './units.js';

describe('isUnitType (unit)', () => {
  it('accepts the three MVP types', () => {
    for (const type of ['worker', 'warrior', 'archer']) {
      expect(isUnitType(type)).toBe(true);
    }
  });

  it.each([[null], [[]], ['x'], ['cavalry'], ['siege'], [''], [42]] as Array<[unknown]>)(
    'rejects non-type %j (cavalry+ NOT YET)',
    (value) => {
      expect(isUnitType(value)).toBe(false);
    },
  );
});

describe('UNIT_TYPES (unit)', () => {
  it('locks the MVP vocabulary in master order, frozen', () => {
    expect(UNIT_TYPES).toEqual(['worker', 'warrior', 'archer']);
    expect(Object.isFrozen(UNIT_TYPES)).toBe(true);
  });
});

describe('isUnitInstance (unit)', () => {
  it('accepts a populated instance', () => {
    expect(isUnitInstance({ id: 'u0', owner: 'p1', type: 'worker', hp: 10, col: 3, row: 7 })).toBe(
      true,
    );
  });

  it.each([[null], [[]], ['x']] as Array<[unknown]>)('rejects non-object %j', (value) => {
    expect(isUnitInstance(value)).toBe(false);
  });

  it.each([
    [{ owner: 'p1', type: 'worker', hp: 1, col: 0, row: 0 }],
    [{ id: '', owner: 'p1', type: 'worker', hp: 1, col: 0, row: 0 }],
    [{ id: 'x'.repeat(65), owner: 'p1', type: 'worker', hp: 1, col: 0, row: 0 }],
    [{ id: 42, owner: 'p1', type: 'worker', hp: 1, col: 0, row: 0 }],
  ] as Array<[unknown]>)('rejects bad id %j', (value) => {
    expect(isUnitInstance(value)).toBe(false);
  });

  it.each([
    [{ id: 'u0', type: 'worker', hp: 1, col: 0, row: 0 }],
    [{ id: 'u0', owner: '', type: 'worker', hp: 1, col: 0, row: 0 }],
    [{ id: 'u0', owner: 'x'.repeat(65), type: 'worker', hp: 1, col: 0, row: 0 }],
  ] as Array<[unknown]>)('rejects bad owner %j', (value) => {
    expect(isUnitInstance(value)).toBe(false);
  });

  it.each([
    [{ id: 'u0', owner: 'p1', hp: 1, col: 0, row: 0 }],
    [{ id: 'u0', owner: 'p1', type: 'cavalry', hp: 1, col: 0, row: 0 }],
  ] as Array<[unknown]>)('rejects bad type %j', (value) => {
    expect(isUnitInstance(value)).toBe(false);
  });

  it.each([
    [{ id: 'u0', owner: 'p1', type: 'worker', hp: -1, col: 0, row: 0 }],
    [{ id: 'u0', owner: 'p1', type: 'worker', hp: 1.5, col: 0, row: 0 }],
    [{ id: 'u0', owner: 'p1', type: 'worker', hp: 0x100000000, col: 0, row: 0 }],
    [{ id: 'u0', owner: 'p1', type: 'worker', hp: 1, col: -1, row: 0 }],
    [{ id: 'u0', owner: 'p1', type: 'worker', hp: 1, col: 0, row: Number.NaN }],
  ] as Array<[unknown]>)('rejects non-uint hp/cell %j', (value) => {
    expect(isUnitInstance(value)).toBe(false);
  });

  it('accepts uint32 boundaries (mirror proof)', () => {
    expect(
      isUnitInstance({ id: 'u0', owner: 'p1', type: 'archer', hp: 0xffffffff, col: 0, row: 0 }),
    ).toBe(true);
  });
});

describe('isUnitsData (unit)', () => {
  function populated(): UnitsData {
    return {
      schemaVersion: 1,
      nextId: 2,
      units: [
        { id: 'u0', owner: 'p1', type: 'worker', hp: 10, col: 1, row: 1 },
        { id: 'u1', owner: 'p2', type: 'archer', hp: 4, col: 5, row: 5 },
      ],
    };
  }

  it('accepts populated and empty rosters', () => {
    expect(isUnitsData(populated())).toBe(true);
    expect(isUnitsData({ schemaVersion: 1, nextId: 0, units: [] })).toBe(true);
  });

  it.each([[null], [[]], ['x']] as Array<[unknown]>)('rejects non-object %j', (value) => {
    expect(isUnitsData(value)).toBe(false);
  });

  it.each([[0], [2], ['1']] as Array<[unknown]>)('rejects schemaVersion %j', (value) => {
    expect(isUnitsData({ schemaVersion: value, nextId: 0, units: [] })).toBe(false);
  });

  it.each([[-1], [1.5], [0x100000000], ['0']] as Array<[unknown]>)('rejects nextId %j', (value) => {
    expect(isUnitsData({ schemaVersion: 1, nextId: value, units: [] })).toBe(false);
  });

  it('rejects non-array units and invalid members', () => {
    expect(isUnitsData({ schemaVersion: 1, nextId: 0, units: {} })).toBe(false);
    expect(
      isUnitsData({
        schemaVersion: 1,
        nextId: 1,
        units: [{ id: 'u0', owner: 'p1', type: 'worker', hp: 1, col: 0, row: 0 }, 'x'],
      }),
    ).toBe(false);
  });

  it('rejects duplicate ids', () => {
    const unit = { id: 'u0', owner: 'p1', type: 'worker', hp: 1, col: 0, row: 0 } as const;
    expect(
      isUnitsData({ schemaVersion: 1, nextId: 2, units: [unit, { ...unit, owner: 'p2' }] }),
    ).toBe(false);
  });
});

describe('unitsOf (unit)', () => {
  function roster(): UnitsData {
    return {
      schemaVersion: 1,
      nextId: 3,
      units: [
        { id: 'u0', owner: 'p1', type: 'worker', hp: 10, col: 1, row: 1 },
        { id: 'u1', owner: 'p2', type: 'archer', hp: 4, col: 5, row: 5 },
        { id: 'u2', owner: 'p1', type: 'warrior', hp: 7, col: 2, row: 2 },
      ],
    };
  }

  it('returns own units in array order', () => {
    expect(unitsOf(roster(), 'p1')).toEqual([
      { id: 'u0', owner: 'p1', type: 'worker', hp: 10, col: 1, row: 1 },
      { id: 'u2', owner: 'p1', type: 'warrior', hp: 7, col: 2, row: 2 },
    ]);
  });

  it('fail-soft: [] for absent data and unknown holders', () => {
    expect(unitsOf(undefined, 'p1')).toEqual([]);
    expect(unitsOf(roster(), 'zx')).toEqual([]);
  });

  it('returns fresh copies (never live refs)', () => {
    const data = roster();
    const mine = unitsOf(data, 'p1');
    expect(mine).toHaveLength(2);
    const first = mine[0];
    const live = data.units[0];
    if (first === undefined || live === undefined) {
      throw new Error('TEST BUG: fixture units missing');
    }
    expect(first).not.toBe(live);
    expect(first).toEqual(live);
  });
});

describe('unitById (unit)', () => {
  function roster(): UnitsData {
    return {
      schemaVersion: 1,
      nextId: 2,
      units: [
        { id: 'u0', owner: 'p1', type: 'worker', hp: 10, col: 1, row: 1 },
        { id: 'u1', owner: 'p2', type: 'archer', hp: 4, col: 5, row: 5 },
      ],
    };
  }

  it('finds by id as a fresh copy', () => {
    const data = roster();
    const found = unitById(data, 'u1');
    const live = data.units[1];
    if (found === undefined || live === undefined) {
      throw new Error('TEST BUG: fixture unit missing');
    }
    expect(found).toEqual({ id: 'u1', owner: 'p2', type: 'archer', hp: 4, col: 5, row: 5 });
    expect(found).not.toBe(live);
  });

  it('fail-soft: undefined when missing or absent', () => {
    expect(unitById(roster(), 'u9')).toBeUndefined();
    expect(unitById(undefined, 'u0')).toBeUndefined();
  });
});

describe('leaf mirrors (unit)', () => {
  it('holder bound matches stockpiles + authority (all 64)', () => {
    expect(MAX_HOLDER_ID_CHARS).toBe(64);
    expect(MAX_HOLDER_ID_CHARS).toBe(STOCKPILE_HOLDER_CAP);
    expect(MAX_HOLDER_ID_CHARS).toBe(MAX_ID_LENGTH);
    expect(MAX_UNIT_ID_CHARS).toBe(64);
  });

  it('schema version is 1', () => {
    expect(UNITS_SCHEMA_VERSION).toBe(1);
  });
});
