/**
 * M021 — Military domain tests: unit config (#83 cost/hp/damage),
 * neutral defaults, stat lookups, pure spawn mechanics, WorldState
 * extension, own-only perception.
 */
import { describe, expect, it } from 'vitest';
import { markUntrusted, type ClientRequest, type PlayerId, type Untrusted } from './authority.js';
import { isMapData, neighborsOf, type MapCell, type MapData } from './map.js';
import { Match, STANDARD_RULESET } from './match.js';
import { DEFAULT_TERRAIN_CONFIG, type TerrainConfig } from './terrain.js';
import { createWorldState, isWorldState, type WorldState } from './world-state.js';
import { perceive } from './views.js';
import {
  ATTACK_TRANSITION,
  attackParamsRule,
  attackProducer,
  createAttackHandler,
  createMoveHandler,
  DEFAULT_UNITS_CONFIG,
  isUnitsConfig,
  maxHpOf,
  MOVE_TRANSITION,
  moveParamsRule,
  moveProducer,
  spawnUnit,
  unitCostOf,
  unitDamageOf,
  warfareHandlers,
  type PassableTerrain,
  type UnitsConfig,
} from './warfare.js';
import { unitById, type UnitsData, type UnitType } from './units.js';

function raw(value: unknown): Untrusted<ClientRequest> {
  return markUntrusted(value as ClientRequest);
}

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

describe('moveParamsRule (unit)', () => {
  it.each([[null], [[]], ['x']] as Array<[unknown]>)('rejects non-object %j', (value) => {
    expect(moveParamsRule(P1, value)).toEqual({
      rule: 'move-params',
      detail: 'move takes { id, col, row }',
    });
  });

  it('rejects mistyped fields, accepts the shape', () => {
    const detail = { rule: 'move-params', detail: 'move takes { id string, col/row uint32 }' };
    expect(moveParamsRule(P1, {})).toEqual(detail);
    expect(moveParamsRule(P1, { id: 42, col: 0, row: 0 })).toEqual(detail);
    expect(moveParamsRule(P1, { id: 'u0', col: 0, row: -1 })).toEqual(detail);
    expect(moveParamsRule(P1, { id: 'u0', col: 1, row: 2 })).toBeNull();
  });
});

describe('createMoveHandler (unit: direct)', () => {
  function warMap(): MapData {
    const cells: MapCell[] = [];
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        cells.push({ col, row, terrain: 'field' });
      }
    }
    const map: MapData = {
      schemaVersion: 1,
      id: 'test-war' as MapData['id'],
      width: 3,
      height: 3,
      stagger: 'odd',
      cells,
      spawns: [],
    };
    if (!isMapData(map)) {
      throw new Error('TEST BUG: warMap invalid');
    }
    return map;
  }

  function squad(): UnitsData {
    return {
      schemaVersion: 1,
      nextId: 2,
      units: [
        { id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 },
        { id: 'u1', owner: 'p2', type: 'warrior', hp: 12, col: 2, row: 2 },
      ],
    };
  }

  function warState(map?: MapData, units?: UnitsData): WorldState {
    return createWorldState({
      players: [P1, P2],
      ...(map === undefined ? {} : { map }),
      ...(units === undefined ? {} : { units }),
    });
  }

  function neighborOf(map: MapData, col: number, row: number): { col: number; row: number } {
    const first = neighborsOf(map, col, row)[0];
    if (first === undefined) {
      throw new Error('TEST BUG: isolated cell');
    }
    return { col: first.col, row: first.row };
  }

  it('rejects a non-function predicate', () => {
    expect(() => createMoveHandler(42 as unknown as PassableTerrain)).toThrow(
      /invalid passable predicate/,
    );
  });

  it('no units → applied:false', () => {
    const handler = createMoveHandler(() => true);
    expect(
      handler({ state: warState(warMap()), caller: P1, params: { id: 'u0', col: 1, row: 0 } }),
    ).toEqual({
      applied: false,
      reason: 'move: no units.',
    });
  });

  it('unknown unit → applied:false', () => {
    const handler = createMoveHandler(() => true);
    expect(
      handler({
        state: warState(warMap(), squad()),
        caller: P1,
        params: { id: 'u9', col: 1, row: 0 },
      }),
    ).toEqual({ applied: false, reason: 'move: unknown unit.' });
  });

  it('foe unit → applied:false', () => {
    const handler = createMoveHandler(() => true);
    expect(
      handler({
        state: warState(warMap(), squad()),
        caller: P1,
        params: { id: 'u1', col: 1, row: 2 },
      }),
    ).toEqual({ applied: false, reason: 'move: not your unit.' });
  });

  it('mapless → applied:false', () => {
    const handler = createMoveHandler(() => true);
    expect(
      handler({
        state: warState(undefined, squad()),
        caller: P1,
        params: { id: 'u0', col: 1, row: 0 },
      }),
    ).toEqual({ applied: false, reason: 'move: no map.' });
  });

  it('out of bounds → applied:false', () => {
    const handler = createMoveHandler(() => true);
    expect(
      handler({
        state: warState(warMap(), squad()),
        caller: P1,
        params: { id: 'u0', col: 9, row: 9 },
      }),
    ).toEqual({ applied: false, reason: 'move: out of bounds.' });
  });

  it('non-neighbor and same-cell → applied:false', () => {
    const handler = createMoveHandler(() => true);
    const state = warState(warMap(), squad());
    expect(handler({ state, caller: P1, params: { id: 'u0', col: 2, row: 2 } })).toEqual({
      applied: false,
      reason: 'move: not adjacent.',
    });
    expect(handler({ state, caller: P1, params: { id: 'u0', col: 0, row: 0 } })).toEqual({
      applied: false,
      reason: 'move: not adjacent.',
    });
  });

  it('blocked terrain → applied:false (predicate decides)', () => {
    const handler = createMoveHandler(() => false);
    const dest = neighborOf(warMap(), 0, 0);
    expect(
      handler({ state: warState(warMap(), squad()), caller: P1, params: { id: 'u0', ...dest } }),
    ).toEqual({ applied: false, reason: 'move: impassable.' });
  });

  it('golden: moves, preserves nextId + others, exact summary', () => {
    const seen: string[] = [];
    const handler = createMoveHandler((terrain) => {
      seen.push(terrain);
      return true;
    });
    const dest = neighborOf(warMap(), 0, 0);
    const result = handler({
      state: warState(warMap(), squad()),
      caller: P1,
      params: { id: 'u0', ...dest },
    });
    if (result.applied !== true) {
      throw new Error('TEST BUG: golden move declined');
    }
    expect(result.summary).toBe(`moved u0 to ${dest.col},${dest.row}`);
    expect(seen).toEqual(['field']);
    expect(result.state.units).toEqual({
      schemaVersion: 1,
      nextId: 2,
      units: [
        { id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: dest.col, row: dest.row },
        { id: 'u1', owner: 'p2', type: 'warrior', hp: 12, col: 2, row: 2 },
      ],
    });
  });
});

describe('warfareHandlers (unit)', () => {
  it('registers move+attack; invalid predicate/config throws', () => {
    expect([...warfareHandlers(() => true, customUnits()).keys()]).toEqual([
      'unit.move',
      'unit.attack',
    ]);
    expect(() => warfareHandlers(42 as unknown as PassableTerrain, customUnits())).toThrow(
      /invalid passable predicate/,
    );
    expect(() => warfareHandlers(() => true, 42 as unknown as UnitsConfig)).toThrow(
      /invalid units config/,
    );
  });
});

describe('moveProducer (unit: direct)', () => {
  it('throws on invalid params', () => {
    const state = createWorldState({ players: [P1, P2] });
    expect(() =>
      moveProducer({ type: MOVE_TRANSITION, caller: P1, params: 'x', before: state, after: state }),
    ).toThrow(/invalid params/);
    expect(() =>
      moveProducer({
        type: MOVE_TRANSITION,
        caller: P1,
        params: { id: 'u0', col: 1 },
        before: state,
        after: state,
      }),
    ).toThrow(/invalid params/);
  });

  it('golden: unit.moved LOW with player+unit+dest', () => {
    const state = createWorldState({ players: [P1, P2] });
    expect(
      moveProducer({
        type: MOVE_TRANSITION,
        caller: P1,
        params: { id: 'u0', col: 1, row: 0 },
        before: state,
        after: state,
      }),
    ).toEqual([
      {
        type: 'unit.moved',
        priority: 'low',
        payload: { player: 'p1', unit: 'u0', col: 1, row: 0 },
      },
    ]);
  });
});

describe('move E2E (real Match)', () => {
  function riverMap(): MapData {
    const map: MapData = {
      schemaVersion: 1,
      id: 'test-river' as MapData['id'],
      width: 2,
      height: 1,
      stagger: 'odd',
      cells: [
        { col: 0, row: 0, terrain: 'field' },
        { col: 1, row: 0, terrain: 'river' },
      ],
      spawns: [],
    };
    if (!isMapData(map)) {
      throw new Error('TEST BUG: riverMap invalid');
    }
    return map;
  }

  function moveMatch(terrain?: TerrainConfig): Match {
    return new Match({
      seed: 11,
      ruleset: STANDARD_RULESET,
      players: [P1, P2],
      initialState: createWorldState({
        players: [P1, P2],
        map: riverMap(),
        units: {
          schemaVersion: 1,
          nextId: 2,
          units: [
            { id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 },
            { id: 'u1', owner: 'p2', type: 'warrior', hp: 12, col: 0, row: 0 },
          ],
        },
      }),
      ...(terrain === undefined ? {} : { terrainConfig: terrain }),
    });
  }

  function step(match: Match, rid: string, player: PlayerId, id: string, col: number, row: number) {
    return match.dispatch(
      match.join(player),
      raw({ requestId: rid, playerId: player, type: MOVE_TRANSITION, payload: { id, col, row } }),
    );
  }

  it('golden: applied + summary + unit.moved fact in sequence', () => {
    const fordable = {
      ...DEFAULT_TERRAIN_CONFIG,
      river: { move: 1, defense: 0, stealth: 0, ranged: 0 },
    };
    const match = moveMatch(fordable);
    expect(step(match, 'r1', P1, 'u0', 1, 0)).toEqual({
      status: 'applied',
      revision: 1,
      summary: 'moved u0 to 1,0',
    });
    expect(unitById(match.getSnapshot().units, 'u0')).toEqual({
      id: 'u0',
      owner: 'p1',
      type: 'worker',
      hp: 5,
      col: 1,
      row: 0,
    });
    expect(match.getEvents().map((e) => e.type)).toEqual(['match.started', 'unit.moved']);
    expect(match.getEvents()[1]).toEqual({
      seq: 2,
      tick: 0,
      revision: 1,
      type: 'unit.moved',
      priority: 'low',
      payload: { player: 'p1', unit: 'u0', col: 1, row: 0 },
    });
  });

  it('default terrain blocks the river (Infinity → impassable, untouched)', () => {
    const match = moveMatch();
    const before = match.getSnapshot();
    expect(step(match, 'r1', P1, 'u0', 1, 0)).toEqual({
      status: 'rejected',
      reason: 'move: impassable.',
    });
    expect(match.getSnapshot()).toEqual(before);
    expect(match.getRevision()).toBe(0);
  });

  it('foe unit rejects (ownership), unknown rejects', () => {
    const fordable = {
      ...DEFAULT_TERRAIN_CONFIG,
      river: { move: 1, defense: 0, stealth: 0, ranged: 0 },
    };
    const match = moveMatch(fordable);
    expect(step(match, 'r1', P1, 'u1', 1, 0)).toEqual({
      status: 'rejected',
      reason: 'move: not your unit.',
    });
    expect(step(match, 'r2', P1, 'u9', 1, 0)).toEqual({
      status: 'rejected',
      reason: 'move: unknown unit.',
    });
    expect(match.getRevision()).toBe(0);
  });

  it('malformed params rejected (pre-rule), state untouched', () => {
    const match = moveMatch();
    const session = match.join(P1);
    const before = match.getSnapshot();
    const payloads: unknown[] = ['x', {}, { id: 'u0', col: 1 }];
    payloads.forEach((payload, index) => {
      expect(
        match.dispatch(
          session,
          raw({ requestId: `r${index + 1}`, playerId: 'p1', type: MOVE_TRANSITION, payload }),
        ),
      ).toMatchObject({ status: 'rejected' });
    });
    expect(match.getSnapshot()).toEqual(before);
    expect(match.getRevision()).toBe(0);
  });

  it('journey: two dispatches, two facts (1-step travel)', () => {
    const fordable = {
      ...DEFAULT_TERRAIN_CONFIG,
      river: { move: 1, defense: 0, stealth: 0, ranged: 0 },
    };
    const match = moveMatch(fordable);
    expect(step(match, 'r1', P1, 'u0', 1, 0)).toMatchObject({ status: 'applied' });
    expect(step(match, 'r2', P1, 'u0', 0, 0)).toEqual({
      status: 'applied',
      revision: 2,
      summary: 'moved u0 to 0,0',
    });
    expect(match.getEvents().filter((e) => e.type === 'unit.moved')).toHaveLength(2);
  });
});

describe('attackParamsRule (unit)', () => {
  it.each([[null], [[]], ['x']] as Array<[unknown]>)('rejects non-object %j', (value) => {
    expect(attackParamsRule(P1, value)).toEqual({
      rule: 'attack-params',
      detail: 'attack takes { id, target }',
    });
  });

  it('rejects mistyped fields, accepts the shape', () => {
    const detail = { rule: 'attack-params', detail: 'attack takes { id string, target string }' };
    expect(attackParamsRule(P1, {})).toEqual(detail);
    expect(attackParamsRule(P1, { id: 42, target: 'u1' })).toEqual(detail);
    expect(attackParamsRule(P1, { id: 'u0', target: 7 })).toEqual(detail);
    expect(attackParamsRule(P1, { id: 'u0', target: 'u1' })).toBeNull();
  });
});

describe('createAttackHandler (unit: direct)', () => {
  function warMap(): MapData {
    const cells: MapCell[] = [];
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        cells.push({ col, row, terrain: 'field' });
      }
    }
    const map: MapData = {
      schemaVersion: 1,
      id: 'test-clash' as MapData['id'],
      width: 3,
      height: 3,
      stagger: 'odd',
      cells,
      spawns: [],
    };
    if (!isMapData(map)) {
      throw new Error('TEST BUG: warMap invalid');
    }
    return map;
  }

  function neighborOf(map: MapData, col: number, row: number): { col: number; row: number } {
    const first = neighborsOf(map, col, row)[0];
    if (first === undefined) {
      throw new Error('TEST BUG: isolated cell');
    }
    return { col: first.col, row: first.row };
  }

  function squad(map: MapData): UnitsData {
    const nb = neighborOf(map, 0, 0);
    return {
      schemaVersion: 1,
      nextId: 4,
      units: [
        { id: 'u0', owner: 'p1', type: 'warrior', hp: 12, col: 0, row: 0 },
        { id: 'u1', owner: 'p2', type: 'warrior', hp: 12, col: nb.col, row: nb.row },
        { id: 'u2', owner: 'p2', type: 'archer', hp: 8, col: 2, row: 2 },
        { id: 'u3', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 },
      ],
    };
  }

  function warState(map?: MapData, units?: UnitsData): WorldState {
    return createWorldState({
      players: [P1, P2],
      ...(map === undefined ? {} : { map }),
      ...(units === undefined ? {} : { units }),
    });
  }

  function withHp(units: UnitsData, id: string, hp: number): UnitsData {
    return {
      ...units,
      units: units.units.map((u) => (u.id === id ? { ...u, hp } : u)),
    };
  }

  it('rejects an invalid units config', () => {
    expect(() => createAttackHandler(42 as unknown as UnitsConfig)).toThrow(/invalid units config/);
  });

  it('no units → applied:false', () => {
    const handler = createAttackHandler(customUnits());
    expect(
      handler({ state: warState(warMap()), caller: P1, params: { id: 'u0', target: 'u1' } }),
    ).toEqual({
      applied: false,
      reason: 'attack: no units.',
    });
  });

  it('unknown unit → applied:false', () => {
    const map = warMap();
    const handler = createAttackHandler(customUnits());
    expect(
      handler({
        state: warState(map, squad(map)),
        caller: P1,
        params: { id: 'u9', target: 'u1' },
      }),
    ).toEqual({ applied: false, reason: 'attack: unknown unit.' });
  });

  it('foe unit → applied:false', () => {
    const map = warMap();
    const handler = createAttackHandler(customUnits());
    expect(
      handler({
        state: warState(map, squad(map)),
        caller: P1,
        params: { id: 'u1', target: 'u0' },
      }),
    ).toEqual({ applied: false, reason: 'attack: not your unit.' });
  });

  it('down attacker → applied:false', () => {
    const map = warMap();
    const handler = createAttackHandler(customUnits());
    expect(
      handler({
        state: warState(map, withHp(squad(map), 'u0', 0)),
        caller: P1,
        params: { id: 'u0', target: 'u1' },
      }),
    ).toEqual({ applied: false, reason: 'attack: unit down.' });
  });

  it('unknown target → applied:false', () => {
    const map = warMap();
    const handler = createAttackHandler(customUnits());
    expect(
      handler({
        state: warState(map, squad(map)),
        caller: P1,
        params: { id: 'u0', target: 'u9' },
      }),
    ).toEqual({ applied: false, reason: 'attack: unknown target.' });
  });

  it('own unit and self → applied:false (not an enemy)', () => {
    const map = warMap();
    const handler = createAttackHandler(customUnits());
    const state = warState(map, squad(map));
    expect(handler({ state, caller: P1, params: { id: 'u0', target: 'u3' } })).toEqual({
      applied: false,
      reason: 'attack: not an enemy.',
    });
    expect(handler({ state, caller: P1, params: { id: 'u0', target: 'u0' } })).toEqual({
      applied: false,
      reason: 'attack: not an enemy.',
    });
  });

  it('down target → applied:false', () => {
    const map = warMap();
    const handler = createAttackHandler(customUnits());
    expect(
      handler({
        state: warState(map, withHp(squad(map), 'u1', 0)),
        caller: P1,
        params: { id: 'u0', target: 'u1' },
      }),
    ).toEqual({ applied: false, reason: 'attack: target down.' });
  });

  it('no map → applied:false', () => {
    const handler = createAttackHandler(customUnits());
    expect(
      handler({
        state: warState(undefined, squad(warMap())),
        caller: P1,
        params: { id: 'u0', target: 'u1' },
      }),
    ).toEqual({ applied: false, reason: 'attack: no map.' });
  });

  it('distant foe → applied:false (out of range)', () => {
    const map = warMap();
    const handler = createAttackHandler(customUnits());
    expect(
      handler({
        state: warState(map, squad(map)),
        caller: P1,
        params: { id: 'u0', target: 'u2' },
      }),
    ).toEqual({ applied: false, reason: 'attack: out of range.' });
  });

  it('golden: adjacent foe loses attacker damage, rest untouched', () => {
    const map = warMap();
    const handler = createAttackHandler(customUnits());
    const out = handler({
      state: warState(map, squad(map)),
      caller: P1,
      params: { id: 'u0', target: 'u1' },
    });
    expect(out).toEqual({
      applied: true,
      state: expect.objectContaining({
        units: {
          schemaVersion: 1,
          nextId: 4,
          units: [
            { id: 'u0', owner: 'p1', type: 'warrior', hp: 12, col: 0, row: 0 },
            {
              id: 'u1',
              owner: 'p2',
              type: 'warrior',
              hp: 8,
              col: neighborOf(map, 0, 0).col,
              row: neighborOf(map, 0, 0).row,
            },
            { id: 'u2', owner: 'p2', type: 'archer', hp: 8, col: 2, row: 2 },
            { id: 'u3', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 },
          ],
        },
      }),
      summary: 'attacked u1 for 4 (hp 12→8)',
    });
    if (out.applied !== true) {
      throw new Error('TEST BUG: golden did not apply');
    }
    expect(isWorldState(out.state)).toBe(true);
  });

  it('overkill floors at 0; the unit stays (removal is M024)', () => {
    const map = warMap();
    const handler = createAttackHandler(customUnits());
    const out = handler({
      state: warState(map, withHp(squad(map), 'u1', 2)),
      caller: P1,
      params: { id: 'u0', target: 'u1' },
    });
    expect(out).toEqual({
      applied: true,
      state: expect.objectContaining({
        units: expect.objectContaining({
          units: expect.arrayContaining([expect.objectContaining({ id: 'u1', hp: 0 })]),
        }),
      }),
      summary: 'attacked u1 for 4 (hp 2→0)',
    });
  });

  it('harmless config applies with 0 damage (hp untouched)', () => {
    const map = warMap();
    const handler = createAttackHandler(DEFAULT_UNITS_CONFIG);
    expect(
      handler({
        state: warState(map, squad(map)),
        caller: P1,
        params: { id: 'u0', target: 'u1' },
      }),
    ).toEqual({
      applied: true,
      state: expect.objectContaining({
        units: expect.objectContaining({
          units: expect.arrayContaining([expect.objectContaining({ id: 'u1', hp: 12 })]),
        }),
      }),
      summary: 'attacked u1 for 0 (hp 12→12)',
    });
  });

  it('same-cell enemy is out of range (neighborsOf excludes self, M022 precedent)', () => {
    const map = warMap();
    const handler = createAttackHandler(customUnits());
    const stacked: UnitsData = {
      ...squad(map),
      units: squad(map).units.map((u) => (u.id === 'u1' ? { ...u, col: 0, row: 0 } : u)),
    };
    expect(
      handler({
        state: warState(map, stacked),
        caller: P1,
        params: { id: 'u0', target: 'u1' },
      }),
    ).toEqual({ applied: false, reason: 'attack: out of range.' });
  });
});

describe('attackProducer (unit: direct)', () => {
  function crewed(units?: UnitsData): WorldState {
    return createWorldState({
      players: [P1, P2],
      ...(units === undefined ? {} : { units }),
    });
  }

  function pair(targetHp: number): UnitsData {
    return {
      schemaVersion: 1,
      nextId: 2,
      units: [
        { id: 'u0', owner: 'p1', type: 'warrior', hp: 12, col: 0, row: 0 },
        { id: 'u1', owner: 'p2', type: 'warrior', hp: targetHp, col: 1, row: 0 },
      ],
    };
  }

  it('throws on invalid params', () => {
    const state = crewed(pair(12));
    expect(() =>
      attackProducer({
        type: ATTACK_TRANSITION,
        caller: P1,
        params: 'x',
        before: state,
        after: state,
      }),
    ).toThrow(/invalid params/);
    expect(() =>
      attackProducer({
        type: ATTACK_TRANSITION,
        caller: P1,
        params: { id: 'u0' },
        before: state,
        after: state,
      }),
    ).toThrow(/invalid params/);
  });

  it('throws when units are missing on either side', () => {
    const full = crewed(pair(12));
    const empty = crewed(undefined);
    const params = { id: 'u0', target: 'u1' };
    expect(() =>
      attackProducer({ type: ATTACK_TRANSITION, caller: P1, params, before: empty, after: full }),
    ).toThrow(/missing units/);
    expect(() =>
      attackProducer({ type: ATTACK_TRANSITION, caller: P1, params, before: full, after: empty }),
    ).toThrow(/missing units/);
  });

  it('throws when the target is missing on either side', () => {
    const full = crewed(pair(12));
    const noTarget = crewed({
      schemaVersion: 1,
      nextId: 2,
      units: [{ id: 'u0', owner: 'p1', type: 'warrior', hp: 12, col: 0, row: 0 }],
    });
    const params = { id: 'u0', target: 'u1' };
    expect(() =>
      attackProducer({
        type: ATTACK_TRANSITION,
        caller: P1,
        params,
        before: noTarget,
        after: full,
      }),
    ).toThrow(/missing target/);
    expect(() =>
      attackProducer({
        type: ATTACK_TRANSITION,
        caller: P1,
        params,
        before: full,
        after: noTarget,
      }),
    ).toThrow(/missing target/);
  });

  it('golden: unit.attacked NORMAL with player+unit+target+damage', () => {
    expect(
      attackProducer({
        type: ATTACK_TRANSITION,
        caller: P1,
        params: { id: 'u0', target: 'u1' },
        before: crewed(pair(12)),
        after: crewed(pair(8)),
      }),
    ).toEqual([
      {
        type: 'unit.attacked',
        priority: 'normal',
        payload: { player: 'p1', unit: 'u0', target: 'u1', damage: 4 },
      },
    ]);
  });
});

describe('attack E2E (real Match)', () => {
  function clashMap(): MapData {
    const map: MapData = {
      schemaVersion: 1,
      id: 'test-clash' as MapData['id'],
      width: 3,
      height: 1,
      stagger: 'odd',
      cells: [
        { col: 0, row: 0, terrain: 'field' },
        { col: 1, row: 0, terrain: 'field' },
        { col: 2, row: 0, terrain: 'field' },
      ],
      spawns: [],
    };
    if (!isMapData(map)) {
      throw new Error('TEST BUG: clashMap invalid');
    }
    return map;
  }

  function clashMatch(units?: UnitsConfig): Match {
    return new Match({
      seed: 23,
      ruleset: STANDARD_RULESET,
      players: [P1, P2],
      initialState: createWorldState({
        players: [P1, P2],
        map: clashMap(),
        units: {
          schemaVersion: 1,
          nextId: 3,
          units: [
            { id: 'u0', owner: 'p1', type: 'warrior', hp: 12, col: 0, row: 0 },
            { id: 'u1', owner: 'p2', type: 'warrior', hp: 12, col: 1, row: 0 },
            { id: 'u2', owner: 'p2', type: 'archer', hp: 8, col: 2, row: 0 },
          ],
        },
      }),
      ...(units === undefined ? {} : { unitsConfig: units }),
    });
  }

  function strike(match: Match, rid: string, player: PlayerId, id: string, target: string) {
    return match.dispatch(
      match.join(player),
      raw({ requestId: rid, playerId: player, type: ATTACK_TRANSITION, payload: { id, target } }),
    );
  }

  it('golden: applied + summary + unit.attacked fact in sequence', () => {
    const match = clashMatch(customUnits());
    expect(strike(match, 'r1', P1, 'u0', 'u1')).toEqual({
      status: 'applied',
      revision: 1,
      summary: 'attacked u1 for 4 (hp 12→8)',
    });
    expect(unitById(match.getSnapshot().units, 'u1')).toEqual({
      id: 'u1',
      owner: 'p2',
      type: 'warrior',
      hp: 8,
      col: 1,
      row: 0,
    });
    expect(match.getEvents().map((e) => e.type)).toEqual(['match.started', 'unit.attacked']);
    expect(match.getEvents()[1]).toEqual({
      seq: 2,
      tick: 0,
      revision: 1,
      type: 'unit.attacked',
      priority: 'normal',
      payload: { player: 'p1', unit: 'u0', target: 'u1', damage: 4 },
    });
  });

  it('default config: harmless attack applies, hp untouched', () => {
    const match = clashMatch();
    expect(strike(match, 'r1', P1, 'u0', 'u1')).toEqual({
      status: 'applied',
      revision: 1,
      summary: 'attacked u1 for 0 (hp 12→12)',
    });
    expect(unitById(match.getSnapshot().units, 'u1')).toMatchObject({ hp: 12 });
  });

  it('distant foe rejects (out of range), state untouched', () => {
    const match = clashMatch(customUnits());
    const before = match.getSnapshot();
    expect(strike(match, 'r1', P1, 'u0', 'u2')).toEqual({
      status: 'rejected',
      reason: 'attack: out of range.',
    });
    expect(match.getSnapshot()).toEqual(before);
    expect(match.getRevision()).toBe(0);
  });

  it('malformed params rejected (pre-rule), state untouched', () => {
    const match = clashMatch(customUnits());
    const session = match.join(P1);
    const before = match.getSnapshot();
    const payloads: unknown[] = ['x', {}, { id: 'u0' }];
    payloads.forEach((payload, index) => {
      expect(
        match.dispatch(
          session,
          raw({ requestId: `r${index + 1}`, playerId: 'p1', type: ATTACK_TRANSITION, payload }),
        ),
      ).toMatchObject({ status: 'rejected' });
    });
    expect(match.getSnapshot()).toEqual(before);
    expect(match.getRevision()).toBe(0);
  });

  it('barrage: three dispatches, three facts, floor at 0', () => {
    const match = clashMatch(customUnits());
    expect(strike(match, 'r1', P1, 'u0', 'u1')).toMatchObject({ status: 'applied' });
    expect(strike(match, 'r2', P1, 'u0', 'u1')).toMatchObject({ status: 'applied' });
    expect(strike(match, 'r3', P1, 'u0', 'u1')).toEqual({
      status: 'applied',
      revision: 3,
      summary: 'attacked u1 for 4 (hp 4→0)',
    });
    expect(unitById(match.getSnapshot().units, 'u1')).toMatchObject({ hp: 0 });
    expect(match.getEvents().filter((e) => e.type === 'unit.attacked')).toHaveLength(3);
    expect(strike(match, 'r4', P1, 'u0', 'u1')).toEqual({
      status: 'rejected',
      reason: 'attack: target down.',
    });
  });
});
