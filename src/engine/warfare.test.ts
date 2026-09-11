/**
 * M021 — Military domain tests: unit config (#83 cost/hp/damage),
 * neutral defaults, stat lookups, pure spawn mechanics, WorldState
 * extension, own-only perception.
 */
import { describe, expect, it } from 'vitest';
import { type PlayerId } from './authority.js';
import { createWorldState, isWorldState } from './world-state.js';
import { perceive } from './views.js';
import {
  DEFAULT_UNITS_CONFIG,
  isUnitsConfig,
  maxHpOf,
  spawnUnit,
  unitCostOf,
  unitDamageOf,
  type UnitsConfig,
} from './warfare.js';
import { type UnitsData, type UnitType } from './units.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

function customUnits(): UnitsConfig {
  return {
    worker: { cost: { food: 10 }, maxHp: 5, damage: 1 },
    warrior: { cost: { food: 20, gold: 5 }, maxHp: 12, damage: 4 },
    archer: { cost: { wood: 15, gold: 10 }, maxHp: 8, damage: 3 },
  };
}

describe('isUnitsConfig (unit)', () => {
  it('accepts the neutral default and a tuned custom', () => {
    expect(isUnitsConfig(DEFAULT_UNITS_CONFIG)).toBe(true);
    expect(isUnitsConfig(customUnits())).toBe(true);
  });

  it.each([[null], [[]], ['x']] as Array<[unknown]>)('rejects non-object %j', (value) => {
    expect(isUnitsConfig(value)).toBe(false);
  });

  it('rejects wrong entry counts (strict: exactly the 3 types)', () => {
    const custom = customUnits();
    expect(isUnitsConfig({ worker: custom.worker, warrior: custom.warrior })).toBe(false);
    expect(isUnitsConfig({ ...custom, cavalry: custom.worker })).toBe(false);
  });

  it('rejects unknown keys', () => {
    const custom = customUnits();
    expect(isUnitsConfig({ ...custom, cavalry: custom.worker, archer: undefined })).toBe(false);
  });

  it.each([
    [{ cost: { mana: 5 }, maxHp: 5, damage: 1 }],
    [{ cost: { food: -1 }, maxHp: 5, damage: 1 }],
    [{ cost: { food: 1.5 }, maxHp: 5, damage: 1 }],
    [{ cost: 'x', maxHp: 5, damage: 1 }],
    [{ cost: {}, maxHp: 0, damage: 1 }],
    [{ cost: {}, maxHp: -1, damage: 1 }],
    [{ cost: {}, maxHp: 0x100000000, damage: 1 }],
    [{ cost: {}, maxHp: 5, damage: -1 }],
    [{ cost: {}, maxHp: 5, damage: 1.5 }],
    ['x'],
  ] as Array<[unknown]>)('rejects bad member %j', (member) => {
    const custom = customUnits();
    expect(isUnitsConfig({ ...custom, worker: member })).toBe(false);
  });
});

describe('DEFAULT_UNITS_CONFIG (unit)', () => {
  it('is neutral (free, 1hp, harmless) and deeply frozen', () => {
    expect(DEFAULT_UNITS_CONFIG).toEqual({
      worker: { cost: {}, maxHp: 1, damage: 0 },
      warrior: { cost: {}, maxHp: 1, damage: 0 },
      archer: { cost: {}, maxHp: 1, damage: 0 },
    });
    expect(Object.isFrozen(DEFAULT_UNITS_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_UNITS_CONFIG.worker)).toBe(true);
    expect(Object.isFrozen(DEFAULT_UNITS_CONFIG.worker.cost)).toBe(true);
  });
});

describe('stat lookups (unit)', () => {
  it.each([
    ['unitCostOf', unitCostOf],
    ['maxHpOf', maxHpOf],
    ['unitDamageOf', unitDamageOf],
  ] as Array<[string, (config: UnitsConfig, type: UnitType) => unknown]>)(
    '%s validates config then type (loud)',
    (_name, lookup) => {
      expect(() => lookup({} as UnitsConfig, 'worker')).toThrow(/invalid units config/);
      expect(() => lookup(customUnits(), 'cavalry' as UnitType)).toThrow(/invalid unit type/);
    },
  );

  it('goldens from the custom config', () => {
    const custom = customUnits();
    expect(unitCostOf(custom, 'warrior')).toEqual({ food: 20, gold: 5 });
    expect(maxHpOf(custom, 'warrior')).toBe(12);
    expect(unitDamageOf(custom, 'archer')).toBe(3);
  });
});

describe('spawnUnit (unit)', () => {
  it('rejects invalid data, owner, type, cell, config (loud, in order)', () => {
    expect(() => spawnUnit({} as UnitsData, P1, 'worker', 0, 0, customUnits())).toThrow(
      /invalid units data/,
    );
    expect(() => spawnUnit(undefined, '' as PlayerId, 'worker', 0, 0, customUnits())).toThrow(
      /invalid owner/,
    );
    expect(() => spawnUnit(undefined, P1, 'cavalry' as UnitType, 0, 0, customUnits())).toThrow(
      /invalid unit type/,
    );
    expect(() => spawnUnit(undefined, P1, 'worker', -1, 0, customUnits())).toThrow(/invalid cell/);
    expect(() => spawnUnit(undefined, P1, 'worker', 0, 1.5, customUnits())).toThrow(/invalid cell/);
    expect(() => spawnUnit(undefined, P1, 'worker', 0, 0, {} as UnitsConfig)).toThrow(
      /invalid units config/,
    );
  });

  it('first spawn on absent data golden (u0, full hp)', () => {
    expect(spawnUnit(undefined, P1, 'warrior', 3, 7, customUnits())).toEqual({
      schemaVersion: 1,
      nextId: 1,
      units: [{ id: 'u0', owner: 'p1', type: 'warrior', hp: 12, col: 3, row: 7 }],
    });
  });

  it('appends in order with rising ids (u1 keeps u0)', () => {
    const once = spawnUnit(undefined, P1, 'worker', 0, 0, customUnits());
    expect(spawnUnit(once, P2, 'archer', 9, 9, customUnits())).toEqual({
      schemaVersion: 1,
      nextId: 2,
      units: [
        { id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 },
        { id: 'u1', owner: 'p2', type: 'archer', hp: 8, col: 9, row: 9 },
      ],
    });
  });

  it('id collision throws loud (init-placed ids must respect nextId)', () => {
    const placed: UnitsData = {
      schemaVersion: 1,
      nextId: 0,
      units: [{ id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 }],
    };
    expect(() => spawnUnit(placed, P1, 'worker', 1, 1, customUnits())).toThrow(/id collision/);
  });

  it('nextId exhaustion throws loud (bug-scale)', () => {
    const spent: UnitsData = { schemaVersion: 1, nextId: 0xffffffff, units: [] };
    expect(() => spawnUnit(spent, P1, 'worker', 0, 0, customUnits())).toThrow(/id space exhausted/);
  });

  it('pure: input data untouched', () => {
    const once = spawnUnit(undefined, P1, 'worker', 0, 0, customUnits());
    const before = structuredClone(once);
    spawnUnit(once, P2, 'archer', 9, 9, customUnits());
    expect(once).toEqual(before);
  });
});

describe('WorldState extension: units (integration)', () => {
  it('accepts units without a map (units are map-independent)', () => {
    const placed: UnitsData = {
      schemaVersion: 1,
      nextId: 1,
      units: [{ id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 2, row: 2 }],
    };
    const world = createWorldState({ players: [P1, P2], units: placed });
    expect(world.units).toEqual(placed);
  });

  it('rejects malformed units', () => {
    expect(() => createWorldState({ players: [P1, P2], units: {} as UnitsData })).toThrow(
      /invalid initial world/,
    );
    const world = createWorldState({ players: [P1, P2] });
    expect(isWorldState({ ...world, units: { schemaVersion: 1, nextId: 0, units: [] } })).toBe(
      true,
    );
    expect(isWorldState({ ...world, units: { schemaVersion: 2, nextId: 0, units: [] } })).toBe(
      false,
    );
  });

  it('omits units when absent (bytes intact)', () => {
    const world = createWorldState({ players: [P1, P2] });
    expect('units' in world).toBe(false);
  });
});

describe('perception carry: units (integration)', () => {
  it('perceive carries own units only (golden)', () => {
    const placed: UnitsData = {
      schemaVersion: 1,
      nextId: 2,
      units: [
        { id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 2, row: 2 },
        { id: 'u1', owner: 'p2', type: 'archer', hp: 8, col: 9, row: 9 },
      ],
    };
    const world = createWorldState({ players: [P1, P2], units: placed });
    const known = perceive(world, P1);
    expect(known.units).toEqual([{ id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 2, row: 2 }]);
    expect(known.exploredCells).toEqual([]);
  });

  it('[] when absent; others units stay out (fail-closed)', () => {
    const world = createWorldState({ players: [P1, P2] });
    expect(perceive(world, P1).units).toEqual([]);
    const crowded: UnitsData = {
      schemaVersion: 1,
      nextId: 1,
      units: [{ id: 'u0', owner: 'p2', type: 'warrior', hp: 12, col: 4, row: 4 }],
    };
    const known = perceive(createWorldState({ players: [P1, P2], units: crowded }), P1);
    expect(known.units).toEqual([]);
  });
});
