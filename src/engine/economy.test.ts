/**
 * M016 — Economy tests: config guard + neutral default, exact ops
 * (credit/debit/canAfford), WorldState extension, perception carry.
 */
import { describe, expect, it } from 'vitest';
import { markUntrusted, type ClientRequest, type PlayerId, type Untrusted } from './authority.js';
import type { BuildingsData } from './buildings.js';
import type { CitiesData } from './city.js';
import {
  addBuilding,
  buildParamsRule,
  buildStartedProducer,
  buildTimeOf,
  BUILD_TRANSITION,
  canAfford,
  capOf,
  cityHandlers,
  completeConstructions,
  completionProducer,
  costOf,
  createBuildHandler,
  createGatherHandler,
  createUpgradeHandler,
  credit,
  debit,
  DEFAULT_BUILDINGS_CONFIG,
  DEFAULT_ECONOMY_CONFIG,
  gatherParamsRule,
  gatherProducer,
  GATHER_TRANSITION,
  isBuildingsConfig,
  isEconomyConfig,
  payCost,
  UPGRADE_TRANSITION,
  type BuildingsConfig,
  type EconomyConfig,
} from './economy.js';
import { isMapData, type MapData } from './map.js';
import { Match, STANDARD_RULESET } from './match.js';
import type { StockpilesData } from './stockpiles.js';
import { createWorldValidator, type RngHandler } from './validation.js';
import { createWorldState, isWorldState, type WorldState } from './world-state.js';
import { perceive } from './views.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

const EMPTY: StockpilesData = { schemaVersion: 1, stockpiles: {} };

function held(): StockpilesData {
  return {
    schemaVersion: 1,
    stockpiles: { p1: { food: 5, wood: 3, stone: 0, gold: 1 } },
  };
}

/** Simulates untrusted wire bytes: unknown input, marked at the boundary. */
function raw(value: unknown): Untrusted<ClientRequest> {
  return markUntrusted(value as ClientRequest);
}

/** 2×2 map: gold node (0,0)×5, wood node (1,1)×4, fields elsewhere. */
function nodeMap(): MapData {
  const map: MapData = {
    schemaVersion: 1,
    id: 'test-nodes' as MapData['id'],
    width: 2,
    height: 2,
    stagger: 'odd',
    cells: [
      { col: 0, row: 0, terrain: 'resource', resource: { type: 'gold', amount: 5 } },
      { col: 1, row: 0, terrain: 'field' },
      { col: 0, row: 1, terrain: 'field' },
      { col: 1, row: 1, terrain: 'resource', resource: { type: 'wood', amount: 4 } },
    ],
    spawns: [{ playerIndex: 0, col: 0, row: 1 }],
  };
  if (!isMapData(map)) {
    throw new Error('TEST BUG: nodeMap invalid');
  }
  return map;
}

/** Valid 1×1 field map (dims-swap forgery needs a gate-passing mutant). */
function tinyMap(): MapData {
  const map: MapData = {
    schemaVersion: 1,
    id: 'test-tiny' as MapData['id'],
    width: 1,
    height: 1,
    stagger: 'odd',
    cells: [{ col: 0, row: 0, terrain: 'field' }],
    spawns: [],
  };
  if (!isMapData(map)) {
    throw new Error('TEST BUG: tinyMap invalid');
  }
  return map;
}

/** Neutral default, but gold yields 3 (multi-take + partial-take coverage). */
function yield3(): EconomyConfig {
  return { ...DEFAULT_ECONOMY_CONFIG, gold: { value: 5, gatherYield: 3 } };
}

function gatherMatch(config?: EconomyConfig): Match {
  return new Match({
    seed: 7,
    ruleset: STANDARD_RULESET,
    players: [P1, P2],
    initialState: createWorldState({ players: [P1, P2], map: nodeMap() }),
    ...(config === undefined ? {} : { economyConfig: config }),
  });
}

function customBuildings(): BuildingsConfig {
  return {
    'town-center': { cost: { food: 10 }, buildTime: 3 },
    house: { cost: { wood: 5 }, buildTime: 2 },
    storage: { cost: { wood: 8 }, buildTime: 2 },
    barracks: { cost: { wood: 20, stone: 10 }, buildTime: 5 },
    wall: { cost: { stone: 15 }, buildTime: 4 },
    tower: { cost: { wood: 2, stone: 1 }, buildTime: 1 },
    caps: { base: 100, perStorage: 50 },
  };
}

function housed(): BuildingsData {
  return {
    schemaVersion: 1,
    buildings: {
      p1: { 'town-center': 1, house: 2, storage: 1, barracks: 0, wall: 0, tower: 0 },
    },
  };
}

function flush(): StockpilesData {
  const full = { food: 50, wood: 50, stone: 50, gold: 50 };
  return { schemaVersion: 1, stockpiles: { p1: { ...full }, p2: { ...full } } };
}

function cityMatch(
  buildings?: BuildingsConfig,
  funds?: StockpilesData,
  cities?: CitiesData,
): Match {
  return new Match({
    seed: 11,
    ruleset: STANDARD_RULESET,
    players: [P1, P2],
    initialState: createWorldState({
      players: [P1, P2],
      ...(funds === undefined ? {} : { stockpiles: funds }),
      ...(cities === undefined ? {} : { cities }),
    }),
    ...(buildings === undefined ? {} : { buildingsConfig: buildings }),
  });
}

function build(match: Match, rid: string, player: PlayerId, type: string) {
  return match.dispatch(
    match.join(player),
    raw({ requestId: rid, playerId: player, type: BUILD_TRANSITION, payload: { type } }),
  );
}

function raise(match: Match, rid: string, player: PlayerId) {
  return match.dispatch(
    match.join(player),
    raw({ requestId: rid, playerId: player, type: UPGRADE_TRANSITION, payload: {} }),
  );
}

function tick(match: Match, rid: string, player: PlayerId) {
  return match.dispatch(
    match.join(player),
    raw({ requestId: rid, playerId: player, type: 'match.advance', payload: {} }),
  );
}

describe('isEconomyConfig (unit)', () => {
  it('accepts a complete custom config', () => {
    expect(
      isEconomyConfig({
        food: { value: 1, gatherYield: 3 },
        wood: { value: 2, gatherYield: 2 },
        stone: { value: 3, gatherYield: 2 },
        gold: { value: 5, gatherYield: 1 },
      }),
    ).toBe(true);
  });

  it.each([[null], [[]], ['x']] as Array<[unknown]>)('rejects non-object %j', (value) => {
    expect(isEconomyConfig(value)).toBe(false);
  });

  it('rejects partial and oversized tables (4/4, no more no less)', () => {
    const full = DEFAULT_ECONOMY_CONFIG as unknown as Record<string, unknown>;
    const three = { wood: full['wood'], stone: full['stone'], gold: full['gold'] };
    expect(isEconomyConfig(three)).toBe(false);
    expect(isEconomyConfig({ ...full, oil: { value: 1, gatherYield: 1 } })).toBe(false);
  });

  it('rejects unknown keys and malformed rates', () => {
    const full = DEFAULT_ECONOMY_CONFIG as unknown as Record<string, unknown>;
    expect(isEconomyConfig({ ...full, food: undefined, lava: full['food'] })).toBe(false);
    expect(isEconomyConfig({ ...full, food: null })).toBe(false);
    expect(isEconomyConfig({ ...full, food: [] as unknown })).toBe(false);
  });

  it.each([[-1], [1.5], [4294967296], ['x']] as Array<[unknown]>)(
    'rejects bad value %j',
    (value) => {
      const full = DEFAULT_ECONOMY_CONFIG as unknown as Record<string, unknown>;
      expect(isEconomyConfig({ ...full, food: { value, gatherYield: 1 } })).toBe(false);
    },
  );

  it.each([[-1], [1.5], [4294967296], ['x']] as Array<[unknown]>)(
    'rejects bad gatherYield %j',
    (gatherYield) => {
      const full = DEFAULT_ECONOMY_CONFIG as unknown as Record<string, unknown>;
      expect(isEconomyConfig({ ...full, gold: { value: 1, gatherYield } })).toBe(false);
    },
  );
});

describe('DEFAULT_ECONOMY_CONFIG (unit)', () => {
  it('is exactly neutral 1/1/1/1 (M011 analogy, tuning is #92)', () => {
    const one = { value: 1, gatherYield: 1 };
    expect(DEFAULT_ECONOMY_CONFIG).toEqual({ food: one, wood: one, stone: one, gold: one });
    expect(isEconomyConfig(DEFAULT_ECONOMY_CONFIG)).toBe(true);
  });

  it('is deep-frozen', () => {
    expect(Object.isFrozen(DEFAULT_ECONOMY_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_ECONOMY_CONFIG.food)).toBe(true);
    expect(() => {
      (DEFAULT_ECONOMY_CONFIG.food as { value: number }).value = 9;
    }).toThrow(TypeError);
  });
});

describe('credit (integration)', () => {
  it('credits empty and accumulates (golden)', () => {
    const first = credit(EMPTY, P1, 'food', 5);
    expect(first).toEqual({
      schemaVersion: 1,
      stockpiles: { p1: { food: 5, wood: 0, stone: 0, gold: 0 } },
    });
    expect(credit(first, P1, 'food', 2)).toEqual({
      schemaVersion: 1,
      stockpiles: { p1: { food: 7, wood: 0, stone: 0, gold: 0 } },
    });
  });

  it('covers every type and admits new holders', () => {
    let data = credit(EMPTY, P1, 'food', 1);
    data = credit(data, P1, 'wood', 2);
    data = credit(data, P1, 'stone', 3);
    data = credit(data, P2, 'gold', 4);
    expect(data.stockpiles).toEqual({
      p1: { food: 1, wood: 2, stone: 3, gold: 0 },
      p2: { food: 0, wood: 0, stone: 0, gold: 4 },
    });
  });

  it('overflows loud, never saturates (exact economics)', () => {
    const full: StockpilesData = {
      schemaVersion: 1,
      stockpiles: { p1: { food: 4294967295, wood: 0, stone: 0, gold: 0 } },
    };
    expect(() => credit(full, P1, 'food', 1)).toThrow(/overflow/);
    expect(credit(full, P1, 'food', 0)).toEqual(full);
  });

  it('rejects malformed input loud', () => {
    expect(() => credit({} as StockpilesData, P1, 'food', 1)).toThrow(/invalid stockpiles/);
    expect(() => credit(EMPTY, P1, 'lava' as never, 1)).toThrow(/invalid resource type/);
    expect(() => credit(EMPTY, P1, 'food', -1)).toThrow(/invalid amount/);
    expect(() => credit(EMPTY, P1, 'food', 1.5)).toThrow(/invalid amount/);
  });

  it('output frozen, inputs never mutated', () => {
    const before = held();
    const snapshot = JSON.parse(JSON.stringify(before)) as unknown;
    const out = credit(before, P1, 'gold', 2);
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out.stockpiles)).toBe(true);
    expect(Object.isFrozen(out.stockpiles['p1'])).toBe(true);
    expect(before).toEqual(snapshot);
    expect(out.stockpiles['p1']).not.toBe(before.stockpiles['p1']);
  });

  it('deterministic run×2', () => {
    const run = () => credit(credit(EMPTY, P2, 'gold', 4), P1, 'food', 1);
    expect(run()).toEqual(run());
  });
});

describe('debit (integration)', () => {
  it('spends down to zero (golden)', () => {
    const data = debit(held(), P1, 'food', 5);
    expect(data.stockpiles['p1']).toEqual({ food: 0, wood: 3, stone: 0, gold: 1 });
  });

  it('overdrafts loud (exact economics)', () => {
    expect(() => debit(held(), P1, 'food', 6)).toThrow(/insufficient food/);
    expect(() => debit(held(), P1, 'stone', 1)).toThrow(/insufficient stone/);
    expect(() => debit(held(), P2, 'gold', 1)).toThrow(/insufficient gold/);
  });

  it('rejects malformed input loud', () => {
    expect(() => debit({} as StockpilesData, P1, 'food', 1)).toThrow(/invalid stockpiles/);
    expect(() => debit(EMPTY, P1, 'lava' as never, 1)).toThrow(/invalid resource type/);
    expect(() => debit(EMPTY, P1, 'food', -1)).toThrow(/invalid amount/);
  });

  it('output frozen, inputs never mutated', () => {
    const before = held();
    const out = debit(before, P1, 'wood', 1);
    expect(Object.isFrozen(out.stockpiles['p1'])).toBe(true);
    expect(before.stockpiles['p1']).toEqual({ food: 5, wood: 3, stone: 0, gold: 1 });
  });
});

describe('canAfford (unit)', () => {
  it('affords exact and partial costs', () => {
    expect(canAfford(held(), P1, { food: 5, wood: 3, stone: 0, gold: 1 })).toBe(true);
    expect(canAfford(held(), P1, { wood: 3 })).toBe(true);
    expect(canAfford(held(), P1, {})).toBe(true);
  });

  it('fails each blocking type', () => {
    expect(canAfford(held(), P1, { food: 6 })).toBe(false);
    expect(canAfford(held(), P1, { wood: 4 })).toBe(false);
    expect(canAfford(held(), P1, { stone: 1 })).toBe(false);
    expect(canAfford(held(), P1, { gold: 2 })).toBe(false);
    expect(canAfford(held(), P2, { food: 1 })).toBe(false);
  });

  it('rejects malformed input loud (boolean is for affordability, not validity)', () => {
    expect(() => canAfford({} as StockpilesData, P1, {})).toThrow(/invalid stockpiles/);
    expect(() => canAfford(held(), P1, 'x' as never)).toThrow(/invalid cost/);
    expect(() => canAfford(held(), P1, { food: -1 })).toThrow(/invalid cost/);
    expect(() => canAfford(held(), P1, { gold: 1.5 })).toThrow(/invalid cost/);
  });
});

describe('WorldState extension (integration)', () => {
  it('accepts stockpiles without a map (economy is map-independent)', () => {
    const world = createWorldState({ players: [P1, P2], stockpiles: held() });
    expect(world.stockpiles).toEqual(held());
  });

  it('rejects malformed stockpiles', () => {
    expect(() => createWorldState({ players: [P1, P2], stockpiles: {} as StockpilesData })).toThrow(
      /invalid initial world/,
    );
    const world = createWorldState({ players: [P1, P2] });
    expect(isWorldState({ ...world, stockpiles: { schemaVersion: 1, stockpiles: {} } })).toBe(true);
    expect(isWorldState({ ...world, stockpiles: { schemaVersion: 2, stockpiles: {} } })).toBe(
      false,
    );
  });

  it('omits stockpiles when absent (bytes intact)', () => {
    const world = createWorldState({ players: [P1, P2] });
    expect('stockpiles' in world).toBe(false);
  });
});

describe('perception carry (integration)', () => {
  it('perceive carries the stockpile alongside knowledge (golden)', () => {
    const world = createWorldState({ players: [P1, P2], stockpiles: held() });
    const known = perceive(world, P1);
    expect(known.stockpile).toEqual({ food: 5, wood: 3, stone: 0, gold: 1 });
    expect(known.exploredCells).toEqual([]);
  });

  it('zeros when absent; others holdings stay out (fail-closed)', () => {
    const world = createWorldState({ players: [P1, P2] });
    expect(perceive(world, P1).stockpile).toEqual({ food: 0, wood: 0, stone: 0, gold: 0 });
    const rich: StockpilesData = {
      schemaVersion: 1,
      stockpiles: {
        p1: { food: 1, wood: 0, stone: 0, gold: 0 },
        zx: { food: 999, wood: 999, stone: 999, gold: 999 },
      },
    };
    const known = perceive(createWorldState({ players: [P1, P2], stockpiles: rich }), P1);
    expect(known.stockpile).toEqual({ food: 1, wood: 0, stone: 0, gold: 0 });
  });
});

describe('no validation rule (M020 owns)', () => {
  it('composition stays at 5 post-invariants (no snuck-in rule)', () => {
    expect(createWorldValidator().post).toHaveLength(5);
  });
});

describe('gatherParamsRule (unit)', () => {
  it('rejects non-object params', () => {
    const shape = { rule: 'gather-params', detail: 'gather takes { col, row }' };
    expect(gatherParamsRule(P1, 'x')).toEqual(shape);
    expect(gatherParamsRule(P1, null)).toEqual(shape);
    expect(gatherParamsRule(P1, [])).toEqual(shape);
  });

  it('rejects non-uint coords, accepts the shape', () => {
    const uints = { rule: 'gather-params', detail: 'gather takes { col, row } uint32' };
    expect(gatherParamsRule(P1, { col: 'x', row: 0 })).toEqual(uints);
    expect(gatherParamsRule(P1, { col: 0 })).toEqual(uints);
    expect(gatherParamsRule(P1, {})).toEqual(uints);
    expect(gatherParamsRule(P1, { col: 1, row: 2 })).toBeNull();
  });
});

describe('createGatherHandler (unit: direct)', () => {
  function mapful(stockpiles?: StockpilesData): WorldState {
    return stockpiles === undefined
      ? createWorldState({ players: [P1, P2], map: nodeMap() })
      : createWorldState({ players: [P1, P2], map: nodeMap(), stockpiles });
  }

  it('rejects an invalid config', () => {
    expect(() => createGatherHandler({} as EconomyConfig)).toThrow(/invalid economy config/);
  });

  it('mapless state → applied:false', () => {
    const handler = createGatherHandler(yield3());
    expect(
      handler({
        state: createWorldState({ players: [P1, P2] }),
        caller: P1,
        params: { col: 0, row: 0 },
      }),
    ).toEqual({ applied: false, reason: 'gather: no map.' });
  });

  it('out of bounds → applied:false (both miss shapes)', () => {
    const handler = createGatherHandler(yield3());
    const state = mapful();
    expect(handler({ state, caller: P1, params: { col: 9, row: 9 } })).toEqual({
      applied: false,
      reason: 'gather: out of bounds.',
    });
    expect(handler({ state, caller: P1, params: { col: 0, row: 9 } })).toEqual({
      applied: false,
      reason: 'gather: out of bounds.',
    });
  });

  it('resourceless cell → applied:false', () => {
    const handler = createGatherHandler(yield3());
    expect(handler({ state: mapful(), caller: P1, params: { col: 1, row: 0 } })).toEqual({
      applied: false,
      reason: 'gather: no node here.',
    });
  });

  it('depleted node → applied:false', () => {
    const base = nodeMap();
    const zeroed: MapData = {
      ...base,
      cells: base.cells.map((cell) =>
        cell.col === 0 && cell.row === 0
          ? { ...cell, resource: { type: 'gold', amount: 0 } }
          : cell,
      ),
    };
    if (!isMapData(zeroed)) {
      throw new Error('TEST BUG: zeroed map invalid');
    }
    const handler = createGatherHandler(yield3());
    const state = createWorldState({ players: [P1, P2], map: zeroed });
    expect(handler({ state, caller: P1, params: { col: 0, row: 0 } })).toEqual({
      applied: false,
      reason: 'gather: node depleted.',
    });
  });

  it('zero yield → applied:false (never an applied no-op)', () => {
    const flat: EconomyConfig = { ...DEFAULT_ECONOMY_CONFIG, gold: { value: 5, gatherYield: 0 } };
    const handler = createGatherHandler(flat);
    expect(handler({ state: mapful(), caller: P1, params: { col: 0, row: 0 } })).toEqual({
      applied: false,
      reason: 'gather: yield is zero.',
    });
  });

  it('golden: depletes the node, credits the caller, exact summary', () => {
    const handler = createGatherHandler(yield3());
    const before = mapful();
    const result = handler({ state: before, caller: P1, params: { col: 0, row: 0 } });
    if (result.applied !== true) {
      throw new Error('TEST BUG: golden gather declined');
    }
    expect(result.summary).toBe('gathered 3 gold at 0,0');
    expect(result.state.tick).toBe(0);
    const afterMap = result.state.map;
    if (afterMap === undefined) {
      throw new Error('TEST BUG: golden gather dropped the map');
    }
    expect(afterMap).toEqual({
      ...nodeMap(),
      cells: [
        { col: 0, row: 0, terrain: 'resource', resource: { type: 'gold', amount: 2 } },
        { col: 1, row: 0, terrain: 'field' },
        { col: 0, row: 1, terrain: 'field' },
        { col: 1, row: 1, terrain: 'resource', resource: { type: 'wood', amount: 4 } },
      ],
    });
    expect(afterMap.cells[1]).toBe(before.map?.cells[1]);
    expect(result.state.stockpiles).toEqual({
      schemaVersion: 1,
      stockpiles: { p1: { food: 0, wood: 0, stone: 0, gold: 3 } },
    });
  });

  it('accumulates onto existing stockpiles', () => {
    const handler = createGatherHandler(yield3());
    const result = handler({ state: mapful(held()), caller: P1, params: { col: 1, row: 1 } });
    if (result.applied !== true) {
      throw new Error('TEST BUG: accumulate gather declined');
    }
    expect(result.state.stockpiles).toEqual({
      schemaVersion: 1,
      stockpiles: { p1: { food: 5, wood: 4, stone: 0, gold: 1 } },
    });
  });

  it('overflow stays loud (uint32 ceiling is bug-scale)', () => {
    const full: StockpilesData = {
      schemaVersion: 1,
      stockpiles: { p1: { food: 0, wood: 0, stone: 0, gold: 4294967295 } },
    };
    const handler = createGatherHandler(yield3());
    expect(() => handler({ state: mapful(full), caller: P1, params: { col: 0, row: 0 } })).toThrow(
      /overflow/,
    );
  });
});

describe('gather E2E (real Match)', () => {
  function gather(match: Match, rid: string, col: number, row: number) {
    const session = match.join(P1);
    return match.dispatch(
      session,
      raw({ requestId: rid, playerId: 'p1', type: GATHER_TRANSITION, payload: { col, row } }),
    );
  }

  it('dispatches the registered gather: applied + depletion + credit + fact', () => {
    const match = gatherMatch(yield3());
    expect(gather(match, 'r1', 0, 0)).toEqual({
      status: 'applied',
      revision: 1,
      summary: 'gathered 3 gold at 0,0',
    });
    const snapshot = match.getSnapshot();
    const map = snapshot.map;
    if (map === undefined) {
      throw new Error('TEST BUG: E2E map missing');
    }
    const node = map.cells.find((cell) => cell.col === 0 && cell.row === 0)?.resource;
    expect(node).toEqual({ type: 'gold', amount: 2 });
    expect(snapshot.stockpiles).toEqual({
      schemaVersion: 1,
      stockpiles: { p1: { food: 0, wood: 0, stone: 0, gold: 3 } },
    });
    const timeline = match.getTimeline();
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      type: GATHER_TRANSITION,
      applied: true,
      detail: 'gathered 3 gold at 0,0',
    });
    expect(match.getEvents()).toHaveLength(2);
    expect(match.getEvents()[1]).toEqual({
      seq: 2,
      tick: 0,
      revision: 1,
      type: 'resource.gathered',
      priority: 'normal',
      payload: { player: 'p1', col: 0, row: 0, resource: 'gold', amount: 3 },
    });
  });

  it('second gather takes the remainder; third is recorded-but-unapplied', () => {
    const match = gatherMatch(yield3());
    expect(gather(match, 'r1', 0, 0)).toMatchObject({ status: 'applied', revision: 1 });
    expect(gather(match, 'r2', 0, 0)).toEqual({
      status: 'applied',
      revision: 2,
      summary: 'gathered 2 gold at 0,0',
    });
    expect(match.getSnapshot().stockpiles).toEqual({
      schemaVersion: 1,
      stockpiles: { p1: { food: 0, wood: 0, stone: 0, gold: 5 } },
    });
    const before = match.getSnapshot();
    expect(gather(match, 'r3', 0, 0)).toEqual({
      status: 'rejected',
      reason: 'gather: node depleted.',
    });
    expect(match.getSnapshot()).toEqual(before);
    expect(match.getRevision()).toBe(2);
    expect(match.getTimeline()).toHaveLength(3);
    expect(match.getTimeline()[2]).toMatchObject({
      applied: false,
      detail: 'gather: node depleted.',
    });
    expect(match.getEvents()).toHaveLength(3);
  });

  it('malformed params rejected (pre-rule), state untouched', () => {
    const match = gatherMatch(yield3());
    const session = match.join(P1);
    const before = match.getSnapshot();
    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: GATHER_TRANSITION, payload: 'x' }),
      ),
    ).toEqual({
      status: 'rejected',
      reason: 'validation: [gather-params] gather takes { col, row }',
    });
    expect(match.getSnapshot()).toEqual(before);
    expect(match.getRevision()).toBe(0);
  });

  it('default config gathers at yield 1 (no economyConfig passed)', () => {
    const match = gatherMatch();
    expect(gather(match, 'r1', 1, 1)).toEqual({
      status: 'applied',
      revision: 1,
      summary: 'gathered 1 wood at 1,1',
    });
    expect(match.getSnapshot().stockpiles).toEqual({
      schemaVersion: 1,
      stockpiles: { p1: { food: 0, wood: 1, stone: 0, gold: 0 } },
    });
  });

  it('perceive reflects the gathered stockpile (own-only)', () => {
    const match = gatherMatch(yield3());
    gather(match, 'r1', 0, 0);
    const snapshot = match.getSnapshot();
    expect(perceive(snapshot, P1).stockpile).toEqual({ food: 0, wood: 0, stone: 0, gold: 3 });
    expect(perceive(snapshot, P2).stockpile).toEqual({ food: 0, wood: 0, stone: 0, gold: 0 });
  });
});

describe('map-preserved v2 (E2E forgery mutants)', () => {
  function patch(
    map: MapData,
    col: number,
    row: number,
    resource: { type: 'gold' | 'wood'; amount: number },
  ): MapData {
    return {
      ...map,
      cells: map.cells.map((cell) =>
        cell.col === col && cell.row === row ? { ...cell, resource } : cell,
      ),
    };
  }

  const mutants: Array<[string, (map: MapData) => MapData]> = [
    [
      'terrain flip',
      (m) => ({ ...m, cells: m.cells.map((c, i) => (i === 1 ? { ...c, terrain: 'forest' } : c)) }),
    ],
    ['type swap', (m) => patch(m, 0, 0, { type: 'wood', amount: 5 })],
    ['amount increase', (m) => patch(m, 0, 0, { type: 'gold', amount: 6 })],
    ['id change', (m) => ({ ...m, id: 'forged' as MapData['id'] })],
    ['stagger flip', (m) => ({ ...m, stagger: 'even' })],
    ['spawn dropped', (m) => ({ ...m, spawns: [] })],
    ['dims swap (valid 1x1)', () => tinyMap()],
  ];

  it.each(mutants)('forgery %s → HANDLER_FAULT, untouched', (_label, forge) => {
    const forged = forge(nodeMap());
    if (!isMapData(forged)) {
      throw new Error('TEST BUG: forged map must pass the shape gate');
    }
    // TEST MOCK: forging writer (proves the post-rule catches gate-passing forgeries).
    const handlers = new Map<string, RngHandler<WorldState>>([
      [
        'test.forge',
        (ctx) => ({ applied: true, state: { ...ctx.state, map: forged }, summary: 'forge' }),
      ],
    ]);
    const match = new Match({
      seed: 7,
      ruleset: STANDARD_RULESET,
      players: [P1, P2],
      initialState: createWorldState({ players: [P1, P2], map: nodeMap() }),
      extraHandlers: handlers,
    });
    const session = match.join(P1);
    const before = match.getSnapshot();
    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'test.forge', payload: {} }),
      ),
    ).toEqual({ status: 'error', code: 'HANDLER_FAULT' });
    expect(match.getSnapshot()).toEqual(before);
    expect(match.getRevision()).toBe(0);
  });

  it('arrival (mapless → map) → HANDLER_FAULT', () => {
    const arrived = nodeMap();
    // TEST MOCK: arriving writer.
    const handlers = new Map<string, RngHandler<WorldState>>([
      [
        'test.arrive',
        (ctx) => ({ applied: true, state: { ...ctx.state, map: arrived }, summary: 'arrive' }),
      ],
    ]);
    const match = new Match({
      seed: 7,
      ruleset: STANDARD_RULESET,
      players: [P1, P2],
      initialState: createWorldState({ players: [P1, P2] }),
      extraHandlers: handlers,
    });
    const session = match.join(P1);
    const before = match.getSnapshot();
    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'test.arrive', payload: {} }),
      ),
    ).toEqual({ status: 'error', code: 'HANDLER_FAULT' });
    expect(match.getSnapshot()).toEqual(before);
  });

  it('removal (map → mapless) → HANDLER_FAULT', () => {
    // TEST MOCK: removing writer.
    const handlers = new Map<string, RngHandler<WorldState>>([
      [
        'test.remove',
        (ctx) => ({
          applied: true,
          state: createWorldState({ players: [P1, P2], tick: ctx.state.tick }),
          summary: 'remove',
        }),
      ],
    ]);
    const match = new Match({
      seed: 7,
      ruleset: STANDARD_RULESET,
      players: [P1, P2],
      initialState: createWorldState({ players: [P1, P2], map: nodeMap() }),
      extraHandlers: handlers,
    });
    const session = match.join(P1);
    const before = match.getSnapshot();
    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'test.remove', payload: {} }),
      ),
    ).toEqual({ status: 'error', code: 'HANDLER_FAULT' });
    expect(match.getSnapshot()).toEqual(before);
  });
});

describe('gatherProducer (unit: direct)', () => {
  function coerced(): { before: WorldState; after: WorldState } {
    const before = createWorldState({ players: [P1, P2], map: nodeMap() });
    const handler = createGatherHandler(yield3());
    const result = handler({ state: before, caller: P1, params: { col: 0, row: 0 } });
    if (result.applied !== true) {
      throw new Error('TEST BUG: producer fixture declined');
    }
    return { before, after: result.state };
  }

  it('throws on invalid params', () => {
    const { before, after } = coerced();
    expect(() =>
      gatherProducer({ type: GATHER_TRANSITION, caller: P1, params: 'x', before, after }),
    ).toThrow(/invalid params/);
    expect(() =>
      gatherProducer({ type: GATHER_TRANSITION, caller: P1, params: null, before, after }),
    ).toThrow(/invalid params/);
    expect(() =>
      gatherProducer({
        type: GATHER_TRANSITION,
        caller: P1,
        params: { col: 'x', row: 0 },
        before,
        after,
      }),
    ).toThrow(/invalid params/);
    expect(() =>
      gatherProducer({ type: GATHER_TRANSITION, caller: P1, params: { col: 0 }, before, after }),
    ).toThrow(/invalid params/);
  });

  it('throws when a map is missing', () => {
    const { before, after } = coerced();
    const mapless = createWorldState({ players: [P1, P2] });
    expect(() =>
      gatherProducer({
        type: GATHER_TRANSITION,
        caller: P1,
        params: { col: 0, row: 0 },
        before: mapless,
        after,
      }),
    ).toThrow(/map missing/);
    expect(() =>
      gatherProducer({
        type: GATHER_TRANSITION,
        caller: P1,
        params: { col: 0, row: 0 },
        before,
        after: mapless,
      }),
    ).toThrow(/map missing/);
  });

  it('throws when the node is missing', () => {
    const { before, after } = coerced();
    expect(() =>
      gatherProducer({
        type: GATHER_TRANSITION,
        caller: P1,
        params: { col: 9, row: 9 },
        before,
        after,
      }),
    ).toThrow(/node missing/);
    // Intentionally gate-invalid: direct producer tests bypass the shape gate.
    const flattened: MapData = {
      ...nodeMap(),
      cells: nodeMap().cells.map((cell) =>
        cell.col === 0 && cell.row === 0 ? { col: 0, row: 0, terrain: 'resource' } : cell,
      ),
    };
    const noNodeAfter: WorldState = { ...before, map: flattened };
    expect(() =>
      gatherProducer({
        type: GATHER_TRANSITION,
        caller: P1,
        params: { col: 0, row: 0 },
        before,
        after: noNodeAfter,
      }),
    ).toThrow(/node missing/);
  });
});

describe('isBuildingsConfig (unit)', () => {
  it('accepts a complete custom config (7/7)', () => {
    expect(isBuildingsConfig(customBuildings())).toBe(true);
    expect(isBuildingsConfig(DEFAULT_BUILDINGS_CONFIG)).toBe(true);
  });

  it.each([[null], [[]], ['x']] as Array<[unknown]>)('rejects non-object %j', (value) => {
    expect(isBuildingsConfig(value)).toBe(false);
  });

  it('rejects partial and oversized tables (7/7, no more no less)', () => {
    const full = customBuildings() as unknown as Record<string, unknown>;
    const six = {
      'town-center': full['town-center'],
      house: full['house'],
      storage: full['storage'],
      barracks: full['barracks'],
      wall: full['wall'],
      caps: full['caps'],
    };
    expect(isBuildingsConfig(six)).toBe(false);
    expect(isBuildingsConfig({ ...full, oil: { cost: {}, buildTime: 0 } })).toBe(false);
  });

  it('rejects unknown keys and malformed type configs', () => {
    const full = customBuildings() as unknown as Record<string, unknown>;
    expect(isBuildingsConfig({ ...full, wall: undefined, lava: full['wall'] })).toBe(false);
    expect(isBuildingsConfig({ ...full, wall: null })).toBe(false);
    expect(isBuildingsConfig({ ...full, wall: [] as unknown })).toBe(false);
  });

  it('rejects a length-preserved unknown key (key check, not length)', () => {
    const full = customBuildings() as unknown as Record<string, unknown>;
    const swapped = {
      'town-center': full['town-center'],
      house: full['house'],
      storage: full['storage'],
      barracks: full['barracks'],
      lava: full['wall'],
      tower: full['tower'],
      caps: full['caps'],
    };
    expect(isBuildingsConfig(swapped)).toBe(false);
  });

  it('rejects bad costs (bad key, bad values, non-object)', () => {
    const full = customBuildings() as unknown as Record<string, unknown>;
    const wall = full['wall'] as Record<string, unknown>;
    expect(isBuildingsConfig({ ...full, wall: { ...wall, cost: { lava: 5 } } })).toBe(false);
    expect(isBuildingsConfig({ ...full, wall: { ...wall, cost: { stone: -1 } } })).toBe(false);
    expect(isBuildingsConfig({ ...full, wall: { ...wall, cost: { stone: 1.5 } } })).toBe(false);
    expect(isBuildingsConfig({ ...full, wall: { ...wall, cost: { stone: 4294967296 } } })).toBe(
      false,
    );
    expect(isBuildingsConfig({ ...full, wall: { ...wall, cost: null } })).toBe(false);
  });

  it.each([[-1], [1.5], [4294967296], ['x']] as Array<[unknown]>)(
    'rejects bad buildTime %j',
    (buildTime) => {
      const full = customBuildings() as unknown as Record<string, unknown>;
      const wall = full['wall'] as Record<string, unknown>;
      expect(isBuildingsConfig({ ...full, wall: { ...wall, buildTime } })).toBe(false);
    },
  );

  it('rejects bad caps (base, perStorage, non-object)', () => {
    const full = customBuildings() as unknown as Record<string, unknown>;
    expect(isBuildingsConfig({ ...full, caps: { base: -1, perStorage: 0 } })).toBe(false);
    expect(isBuildingsConfig({ ...full, caps: { base: 0, perStorage: 1.5 } })).toBe(false);
    expect(isBuildingsConfig({ ...full, caps: null })).toBe(false);
  });
});

describe('DEFAULT_BUILDINGS_CONFIG (unit)', () => {
  it('is exactly neutral (free, instant, uncapped)', () => {
    const free = { cost: {}, buildTime: 0 };
    expect(DEFAULT_BUILDINGS_CONFIG).toEqual({
      'town-center': free,
      house: free,
      storage: free,
      barracks: free,
      wall: free,
      tower: free,
      caps: { base: 4294967295, perStorage: 0 },
    });
    expect(isBuildingsConfig(DEFAULT_BUILDINGS_CONFIG)).toBe(true);
  });

  it('is deep-frozen', () => {
    expect(Object.isFrozen(DEFAULT_BUILDINGS_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_BUILDINGS_CONFIG.storage)).toBe(true);
    expect(Object.isFrozen(DEFAULT_BUILDINGS_CONFIG.caps)).toBe(true);
    expect(() => {
      (DEFAULT_BUILDINGS_CONFIG.caps as { base: number }).base = 9;
    }).toThrow(TypeError);
  });
});

describe('costOf (unit)', () => {
  it('completes partial costs into a fresh copy', () => {
    expect(costOf(customBuildings(), 'storage')).toEqual({ food: 0, wood: 8, stone: 0, gold: 0 });
    const got = costOf(customBuildings(), 'barracks');
    expect(got).toEqual({ food: 0, wood: 20, stone: 10, gold: 0 });
    (got as Record<string, number>)['wood'] = 0;
    expect(costOf(customBuildings(), 'barracks')).toEqual({
      food: 0,
      wood: 20,
      stone: 10,
      gold: 0,
    });
  });

  it('zeros for the neutral default', () => {
    expect(costOf(DEFAULT_BUILDINGS_CONFIG, 'tower')).toEqual({
      food: 0,
      wood: 0,
      stone: 0,
      gold: 0,
    });
  });

  it('rejects invalid configs and types loud', () => {
    expect(() => costOf({} as BuildingsConfig, 'tower')).toThrow(/invalid buildings config/);
    expect(() => costOf(customBuildings(), 'lava' as never)).toThrow(/invalid building type/);
  });
});

describe('buildTimeOf (unit)', () => {
  it('reads times golden', () => {
    expect(buildTimeOf(customBuildings(), 'barracks')).toBe(5);
    expect(buildTimeOf(DEFAULT_BUILDINGS_CONFIG, 'barracks')).toBe(0);
  });

  it('rejects invalid configs and types loud', () => {
    expect(() => buildTimeOf({} as BuildingsConfig, 'tower')).toThrow(/invalid buildings config/);
    expect(() => buildTimeOf(customBuildings(), 'lava' as never)).toThrow(/invalid building type/);
  });
});

describe('payCost (integration)', () => {
  it('pays multi-resource costs atomically (golden)', () => {
    const paid = payCost(held(), P1, { food: 2, wood: 3, gold: 1 });
    expect(paid).toEqual({
      schemaVersion: 1,
      stockpiles: { p1: { food: 3, wood: 0, stone: 0, gold: 0 } },
    });
    expect(Object.isFrozen(paid)).toBe(true);
    expect(held()).toEqual({
      schemaVersion: 1,
      stockpiles: { p1: { food: 5, wood: 3, stone: 0, gold: 1 } },
    });
  });

  it('treats absent as zero; empty cost returns an equal copy', () => {
    const paid = payCost(held(), P1, { gold: 1 });
    expect(paid.stockpiles['p1']).toEqual({ food: 5, wood: 3, stone: 0, gold: 0 });
    const before = held();
    const same = payCost(before, P1, {});
    expect(same).toEqual(before);
    expect(same).not.toBe(before);
  });

  it('drains exact balances to zero', () => {
    const paid = payCost(held(), P1, { food: 5, wood: 3, gold: 1 });
    expect(paid.stockpiles['p1']).toEqual({ food: 0, wood: 0, stone: 0, gold: 0 });
  });

  it('names the first short kind in debit order (deterministic)', () => {
    expect(() => payCost(held(), P1, { food: 9, wood: 9, stone: 9, gold: 9 })).toThrow(
      /insufficient food/,
    );
    expect(() => payCost(held(), P1, { wood: 9, stone: 9, gold: 9 })).toThrow(/insufficient wood/);
    expect(() => payCost(held(), P1, { stone: 9, gold: 9 })).toThrow(/insufficient stone/);
    expect(() => payCost(held(), P1, { gold: 9 })).toThrow(/insufficient gold/);
  });

  it('rejects invalid data and costs loud', () => {
    expect(() => payCost({} as StockpilesData, P1, { food: 1 })).toThrow(/invalid stockpiles data/);
    expect(() => payCost(held(), P1, 'x' as never)).toThrow(/invalid cost/);
    expect(() => payCost(held(), P1, { food: -1 })).toThrow(/invalid cost/);
  });
});

describe('addBuilding (integration)', () => {
  const EMPTY_BUILDINGS: BuildingsData = { schemaVersion: 1, buildings: {} };

  it('adds the first building golden (frozen)', () => {
    const added = addBuilding(EMPTY_BUILDINGS, P1, 'town-center');
    expect(added).toEqual({
      schemaVersion: 1,
      buildings: {
        p1: { 'town-center': 1, house: 0, storage: 0, barracks: 0, wall: 0, tower: 0 },
      },
    });
    expect(Object.isFrozen(added)).toBe(true);
  });

  it('accumulates onto existing counts', () => {
    const added = addBuilding(housed(), P1, 'house');
    expect(added.buildings['p1']).toEqual({
      'town-center': 1,
      house: 3,
      storage: 1,
      barracks: 0,
      wall: 0,
      tower: 0,
    });
  });

  it('rejects invalid data and types loud; overflow loud', () => {
    expect(() => addBuilding({} as BuildingsData, P1, 'house')).toThrow(/invalid buildings data/);
    expect(() => addBuilding(EMPTY_BUILDINGS, P1, 'lava' as never)).toThrow(
      /invalid building type/,
    );
    const full: BuildingsData = {
      schemaVersion: 1,
      buildings: {
        p1: { 'town-center': 0, house: 4294967295, storage: 0, barracks: 0, wall: 0, tower: 0 },
      },
    };
    expect(() => addBuilding(full, P1, 'house')).toThrow(/overflow/);
  });
});

describe('capOf (unit)', () => {
  it('returns base with no storages (golden)', () => {
    expect(capOf(housed(), P2, customBuildings())).toBe(100);
  });

  it('adds per-storage bonus (golden)', () => {
    expect(capOf(housed(), P1, customBuildings())).toBe(150);
  });

  it('neutral default never binds (uncapped status quo)', () => {
    expect(capOf(housed(), P1, DEFAULT_BUILDINGS_CONFIG)).toBe(4294967295);
  });

  it('absent data means base (fail-soft); garbage stays loud', () => {
    expect(capOf(undefined, P1, customBuildings())).toBe(100);
    expect(() => capOf({} as BuildingsData, P1, customBuildings())).toThrow(
      /invalid buildings data/,
    );
  });

  it('invalid config and overflow stay loud', () => {
    expect(() => capOf(housed(), P1, {} as BuildingsConfig)).toThrow(/invalid buildings config/);
    expect(() =>
      capOf(housed(), P1, {
        ...customBuildings(),
        caps: { base: 4294967295, perStorage: 1 },
      }),
    ).toThrow(/overflow/);
  });
});

describe('cost mechanics flow (integration)', () => {
  it('afford → pay → add composes golden (the M018 contract)', () => {
    const config = customBuildings();
    const cost = costOf(config, 'tower');
    expect(cost).toEqual({ food: 0, wood: 2, stone: 1, gold: 0 });
    const funds: StockpilesData = {
      schemaVersion: 1,
      stockpiles: { p1: { food: 5, wood: 3, stone: 2, gold: 1 } },
    };
    expect(canAfford(funds, P1, cost)).toBe(true);
    const paid = payCost(funds, P1, cost);
    expect(paid.stockpiles['p1']).toEqual({ food: 5, wood: 1, stone: 1, gold: 1 });
    const raised = addBuilding(housed(), P1, 'tower');
    expect(raised.buildings['p1']).toEqual({
      'town-center': 1,
      house: 2,
      storage: 1,
      barracks: 0,
      wall: 0,
      tower: 1,
    });
  });
});

describe('WorldState extension: buildings (integration)', () => {
  it('accepts buildings without a map (economy is map-independent)', () => {
    const world = createWorldState({ players: [P1, P2], buildings: housed() });
    expect(world.buildings).toEqual(housed());
  });

  it('rejects malformed buildings', () => {
    expect(() => createWorldState({ players: [P1, P2], buildings: {} as BuildingsData })).toThrow(
      /invalid initial world/,
    );
    const world = createWorldState({ players: [P1, P2] });
    expect(isWorldState({ ...world, buildings: { schemaVersion: 1, buildings: {} } })).toBe(true);
    expect(isWorldState({ ...world, buildings: { schemaVersion: 2, buildings: {} } })).toBe(false);
  });

  it('omits buildings when absent (bytes intact)', () => {
    const world = createWorldState({ players: [P1, P2] });
    expect('buildings' in world).toBe(false);
  });
});

describe('perception carry: buildings (integration)', () => {
  it('perceive carries the counts alongside knowledge (golden)', () => {
    const world = createWorldState({ players: [P1, P2], buildings: housed() });
    const known = perceive(world, P1);
    expect(known.buildings).toEqual({
      'town-center': 1,
      house: 2,
      storage: 1,
      barracks: 0,
      wall: 0,
      tower: 0,
    });
    expect(known.exploredCells).toEqual([]);
  });

  it('zeros when absent; others buildings stay out (fail-closed)', () => {
    const world = createWorldState({ players: [P1, P2] });
    expect(perceive(world, P1).buildings).toEqual({
      'town-center': 0,
      house: 0,
      storage: 0,
      barracks: 0,
      wall: 0,
      tower: 0,
    });
    const crowded: BuildingsData = {
      schemaVersion: 1,
      buildings: {
        p1: { 'town-center': 1, house: 0, storage: 0, barracks: 0, wall: 0, tower: 0 },
        zx: { 'town-center': 9, house: 9, storage: 9, barracks: 9, wall: 9, tower: 9 },
      },
    };
    const known = perceive(createWorldState({ players: [P1, P2], buildings: crowded }), P1);
    expect(known.buildings).toEqual({
      'town-center': 1,
      house: 0,
      storage: 0,
      barracks: 0,
      wall: 0,
      tower: 0,
    });
  });
});

describe('buildParamsRule (unit)', () => {
  it.each([[null], [[]], ['x']] as Array<[unknown]>)('rejects non-object %j', (value) => {
    expect(buildParamsRule(P1, value)).toEqual({
      rule: 'build-params',
      detail: 'build takes { type }',
    });
  });

  it('rejects non-string types, accepts the shape', () => {
    const detail = { rule: 'build-params', detail: 'build takes a string type' };
    expect(buildParamsRule(P1, {})).toEqual(detail);
    expect(buildParamsRule(P1, { type: 42 })).toEqual(detail);
    expect(buildParamsRule(P1, { type: 'tower' })).toBeNull();
  });
});

describe('createBuildHandler (unit: direct)', () => {
  function funded(stockpiles?: StockpilesData, cities?: CitiesData): WorldState {
    return createWorldState({
      players: [P1, P2],
      ...(stockpiles === undefined ? {} : { stockpiles }),
      ...(cities === undefined ? {} : { cities }),
    });
  }

  it('rejects an invalid config', () => {
    expect(() => createBuildHandler({} as BuildingsConfig)).toThrow(/invalid buildings config/);
  });

  it('unknown building → applied:false', () => {
    const handler = createBuildHandler(customBuildings());
    expect(handler({ state: funded(flush()), caller: P1, params: { type: 'lava' } })).toEqual({
      applied: false,
      reason: 'build: unknown building.',
    });
  });

  it('unaffordable → applied:false', () => {
    const handler = createBuildHandler(customBuildings());
    expect(handler({ state: funded(held()), caller: P1, params: { type: 'barracks' } })).toEqual({
      applied: false,
      reason: 'build: cannot afford.',
    });
  });

  it('golden: pays, materializes the city, enqueues (summary exact)', () => {
    const handler = createBuildHandler(customBuildings());
    const result = handler({ state: funded(flush()), caller: P1, params: { type: 'tower' } });
    if (result.applied !== true) {
      throw new Error('TEST BUG: golden build declined');
    }
    expect(result.summary).toBe('started tower (1 ticks)');
    expect(result.state.stockpiles).toEqual({
      schemaVersion: 1,
      stockpiles: {
        p1: { food: 50, wood: 48, stone: 49, gold: 50 },
        p2: { food: 50, wood: 50, stone: 50, gold: 50 },
      },
    });
    expect(result.state.cities).toEqual({
      schemaVersion: 1,
      cities: { p1: { level: 1, queue: [{ type: 'tower', remaining: 1 }] } },
    });
  });

  it('free costs build on absent funds (writes a zeros entry)', () => {
    const handler = createBuildHandler(DEFAULT_BUILDINGS_CONFIG);
    const result = handler({ state: funded(), caller: P1, params: { type: 'wall' } });
    if (result.applied !== true) {
      throw new Error('TEST BUG: free build declined');
    }
    expect(result.state.stockpiles).toEqual({
      schemaVersion: 1,
      stockpiles: { p1: { food: 0, wood: 0, stone: 0, gold: 0 } },
    });
    expect(result.state.cities).toEqual({
      schemaVersion: 1,
      cities: { p1: { level: 1, queue: [{ type: 'wall', remaining: 0 }] } },
    });
  });
});

describe('cityHandlers (unit)', () => {
  it('registers build + upgrade; invalid config throws', () => {
    const handlers = cityHandlers(customBuildings());
    expect([...handlers.keys()].sort()).toEqual(['city.build', 'city.upgrade']);
    expect(() => cityHandlers({} as BuildingsConfig)).toThrow(/invalid buildings config/);
  });
});

describe('createUpgradeHandler (unit: direct)', () => {
  it('materializes and climbs; caps at 3 (invalid params impossible by construction)', () => {
    const before = createWorldState({ players: [P1, P2] });
    const handler = createUpgradeHandler();
    expect(handler({ state: before, caller: P1, params: {} })).toEqual({
      applied: true,
      summary: 'upgraded to level 2',
      state: {
        ...before,
        cities: { schemaVersion: 1, cities: { p1: { level: 2, queue: [] } } },
      },
    });
    const capped = createWorldState({
      players: [P1, P2],
      cities: { schemaVersion: 1, cities: { p1: { level: 3, queue: [] } } },
    });
    expect(handler({ state: capped, caller: P1, params: {} })).toEqual({
      applied: false,
      reason: 'upgrade: already max level.',
    });
  });
});

describe('completeConstructions (unit: direct)', () => {
  function queued(): CitiesData {
    return {
      schemaVersion: 1,
      cities: {
        p1: {
          level: 2,
          queue: [
            { type: 'tower', remaining: 1 },
            { type: 'house', remaining: 2 },
          ],
        },
        p2: { level: 1, queue: [{ type: 'wall', remaining: 1 }] },
        p3: { level: 1, queue: [] },
      },
    };
  }

  it('golden: decrements, completes due, threads counts, preserves levels', () => {
    const out = completeConstructions(queued(), housed());
    expect(out.cities).toEqual({
      schemaVersion: 1,
      cities: {
        p1: { level: 2, queue: [{ type: 'house', remaining: 1 }] },
        p2: { level: 1, queue: [] },
        p3: { level: 1, queue: [] },
      },
    });
    expect(out.buildings).toEqual({
      schemaVersion: 1,
      buildings: {
        p1: { 'town-center': 1, house: 2, storage: 1, barracks: 0, wall: 0, tower: 1 },
        p2: { 'town-center': 0, house: 0, storage: 0, barracks: 0, wall: 1, tower: 0 },
      },
    });
  });

  it('first completion materializes absent buildings', () => {
    const out = completeConstructions(queued(), undefined);
    expect(out.buildings).toEqual({
      schemaVersion: 1,
      buildings: {
        p1: { 'town-center': 0, house: 0, storage: 0, barracks: 0, wall: 0, tower: 1 },
        p2: { 'town-center': 0, house: 0, storage: 0, barracks: 0, wall: 1, tower: 0 },
      },
    });
  });

  it('no-due passes buildings through untouched (same ref)', () => {
    const idle: CitiesData = {
      schemaVersion: 1,
      cities: { p1: { level: 1, queue: [{ type: 'house', remaining: 5 }] } },
    };
    const before = housed();
    const out = completeConstructions(idle, before);
    expect(out.buildings).toBe(before);
    expect(out.cities).toEqual({
      schemaVersion: 1,
      cities: { p1: { level: 1, queue: [{ type: 'house', remaining: 4 }] } },
    });
  });

  it('empty cities complete nothing', () => {
    const out = completeConstructions({ schemaVersion: 1, cities: {} }, housed());
    expect(out).toEqual({
      cities: { schemaVersion: 1, cities: {} },
      buildings: housed(),
    });
  });
});

describe('buildStartedProducer (unit: direct)', () => {
  it('throws on invalid params (golden via E2E)', () => {
    const state = createWorldState({ players: [P1, P2] });
    expect(() =>
      buildStartedProducer({
        type: BUILD_TRANSITION,
        caller: P1,
        params: 'x',
        before: state,
        after: state,
      }),
    ).toThrow(/invalid params/);
    expect(() =>
      buildStartedProducer({
        type: BUILD_TRANSITION,
        caller: P1,
        params: { type: 42 },
        before: state,
        after: state,
      }),
    ).toThrow(/invalid params/);
  });
});

describe('completionProducer (unit: direct)', () => {
  function states(before: BuildingsData | undefined, after: BuildingsData | undefined) {
    const mk = (buildings: BuildingsData | undefined): WorldState =>
      buildings === undefined
        ? createWorldState({ players: [P1, P2] })
        : createWorldState({ players: [P1, P2], buildings });
    return { before: mk(before), after: mk(after) };
  }

  it('emits nothing without buildings on either side', () => {
    const { before, after } = states(undefined, undefined);
    expect(
      completionProducer({ type: 'match.advance', caller: P1, params: {}, before, after }),
    ).toEqual([]);
  });

  it('ignores decreases (robustness; no decrements exist)', () => {
    const { before, after } = states(housed(), undefined);
    expect(
      completionProducer({ type: 'match.advance', caller: P1, params: {}, before, after }),
    ).toEqual([]);
  });

  it('golden: one fact per unit, holders sorted, BUILDING_IDS order', () => {
    const after: BuildingsData = {
      schemaVersion: 1,
      buildings: {
        p2: { 'town-center': 0, house: 0, storage: 0, barracks: 0, wall: 1, tower: 1 },
        p1: { 'town-center': 0, house: 1, storage: 0, barracks: 0, wall: 2, tower: 0 },
      },
    };
    const { before, after: world } = states(undefined, after);
    expect(
      completionProducer({ type: 'match.advance', caller: P1, params: {}, before, after: world }),
    ).toEqual([
      { type: 'build.completed', priority: 'normal', payload: { player: 'p1', building: 'house' } },
      { type: 'build.completed', priority: 'normal', payload: { player: 'p1', building: 'wall' } },
      { type: 'build.completed', priority: 'normal', payload: { player: 'p1', building: 'wall' } },
      { type: 'build.completed', priority: 'normal', payload: { player: 'p2', building: 'wall' } },
      { type: 'build.completed', priority: 'normal', payload: { player: 'p2', building: 'tower' } },
    ]);
  });
});

describe('city E2E (real Match)', () => {
  it('build golden: paid + enqueued + build.started fact', () => {
    const match = cityMatch(customBuildings(), flush());
    expect(build(match, 'r1', P1, 'tower')).toEqual({
      status: 'applied',
      revision: 1,
      summary: 'started tower (1 ticks)',
    });
    const snapshot = match.getSnapshot();
    expect(snapshot.cities).toEqual({
      schemaVersion: 1,
      cities: { p1: { level: 1, queue: [{ type: 'tower', remaining: 1 }] } },
    });
    expect(match.getEvents()).toHaveLength(2);
    expect(match.getEvents()[1]).toEqual({
      seq: 2,
      tick: 0,
      revision: 1,
      type: 'build.started',
      priority: 'normal',
      payload: { player: 'p1', building: 'tower' },
    });
  });

  it('advance completes due builds: counts + build.completed in sequence', () => {
    const match = cityMatch(customBuildings(), flush());
    build(match, 'r1', P1, 'tower');
    expect(tick(match, 'r2', P1)).toEqual({ status: 'applied', revision: 2, summary: 'tick=1' });
    const snapshot = match.getSnapshot();
    expect(snapshot.cities).toEqual({
      schemaVersion: 1,
      cities: { p1: { level: 1, queue: [] } },
    });
    expect(snapshot.buildings).toEqual({
      schemaVersion: 1,
      buildings: { p1: { 'town-center': 0, house: 0, storage: 0, barracks: 0, wall: 0, tower: 1 } },
    });
    expect(match.getEvents().map((e) => e.type)).toEqual([
      'match.started',
      'build.started',
      'match.advanced',
      'build.completed',
    ]);
    expect(match.getEvents()[3]).toEqual({
      seq: 4,
      tick: 1,
      revision: 2,
      type: 'build.completed',
      priority: 'normal',
      payload: { player: 'p1', building: 'tower' },
    });
  });

  it('two-tick build: first advance only decrements (no counts, no fact)', () => {
    const match = cityMatch(customBuildings(), flush());
    build(match, 'r1', P1, 'house');
    tick(match, 'r2', P1);
    const mid = match.getSnapshot();
    expect(mid.tick).toBe(1);
    expect(mid.cities).toEqual({
      schemaVersion: 1,
      cities: { p1: { level: 1, queue: [{ type: 'house', remaining: 1 }] } },
    });
    expect('buildings' in mid).toBe(false);
    expect(match.getEvents().map((e) => e.type)).toEqual([
      'match.started',
      'build.started',
      'match.advanced',
    ]);
    tick(match, 'r3', P1);
    expect(match.getSnapshot().buildings).toEqual({
      schemaVersion: 1,
      buildings: { p1: { 'town-center': 0, house: 1, storage: 0, barracks: 0, wall: 0, tower: 0 } },
    });
    expect(match.getEvents()).toHaveLength(5);
  });

  it('multi-completion order: holders sorted, BUILDING_IDS within (deterministic)', () => {
    const fast: BuildingsConfig = {
      ...customBuildings(),
      house: { cost: {}, buildTime: 1 },
      wall: { cost: {}, buildTime: 1 },
      tower: { cost: {}, buildTime: 1 },
    };
    const match = cityMatch(fast, flush());
    build(match, 'r1', P1, 'wall');
    build(match, 'r2', P1, 'house');
    build(match, 'r3', P2, 'tower');
    tick(match, 'r4', P1);
    expect(
      match
        .getEvents()
        .filter((e) => e.type === 'build.completed')
        .map((e) => e.payload),
    ).toEqual([
      { player: 'p1', building: 'house' },
      { player: 'p1', building: 'wall' },
      { player: 'p2', building: 'tower' },
    ]);
  });

  it('default config: free zero-time builds complete on next advance', () => {
    const match = cityMatch();
    build(match, 'r1', P1, 'tower');
    expect(match.getSnapshot().cities).toEqual({
      schemaVersion: 1,
      cities: { p1: { level: 1, queue: [{ type: 'tower', remaining: 0 }] } },
    });
    tick(match, 'r2', P1);
    expect(match.getSnapshot().buildings).toEqual({
      schemaVersion: 1,
      buildings: { p1: { 'town-center': 0, house: 0, storage: 0, barracks: 0, wall: 0, tower: 1 } },
    });
  });

  it('unaffordable → recorded-but-unapplied, untouched', () => {
    const match = cityMatch(customBuildings(), held());
    const before = match.getSnapshot();
    expect(build(match, 'r1', P1, 'barracks')).toEqual({
      status: 'rejected',
      reason: 'build: cannot afford.',
    });
    expect(match.getSnapshot()).toEqual(before);
    expect(match.getRevision()).toBe(0);
  });

  it('unknown building → recorded-but-unapplied, untouched', () => {
    const match = cityMatch(customBuildings(), flush());
    const before = match.getSnapshot();
    expect(build(match, 'r1', P1, 'lava')).toEqual({
      status: 'rejected',
      reason: 'build: unknown building.',
    });
    expect(match.getSnapshot()).toEqual(before);
  });

  it('malformed params rejected (pre-rule), state untouched', () => {
    const match = cityMatch(customBuildings(), flush());
    const session = match.join(P1);
    const before = match.getSnapshot();
    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: BUILD_TRANSITION, payload: 'x' }),
      ),
    ).toEqual({
      status: 'rejected',
      reason: 'validation: [build-params] build takes { type }',
    });
    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r2', playerId: 'p1', type: BUILD_TRANSITION, payload: {} }),
      ),
    ).toEqual({
      status: 'rejected',
      reason: 'validation: [build-params] build takes a string type',
    });
    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r3', playerId: 'p1', type: BUILD_TRANSITION, payload: { type: 42 } }),
      ),
    ).toEqual({
      status: 'rejected',
      reason: 'validation: [build-params] build takes a string type',
    });
    expect(match.getSnapshot()).toEqual(before);
    expect(match.getRevision()).toBe(0);
  });

  it('upgrade flow: materializes, climbs to 3, caps recorded', () => {
    const match = cityMatch(customBuildings(), flush());
    expect(raise(match, 'r1', P1)).toEqual({
      status: 'applied',
      revision: 1,
      summary: 'upgraded to level 2',
    });
    expect(match.getSnapshot().cities).toEqual({
      schemaVersion: 1,
      cities: { p1: { level: 2, queue: [] } },
    });
    expect(raise(match, 'r2', P1)).toEqual({
      status: 'applied',
      revision: 2,
      summary: 'upgraded to level 3',
    });
    const before = match.getSnapshot();
    expect(raise(match, 'r3', P1)).toEqual({
      status: 'rejected',
      reason: 'upgrade: already max level.',
    });
    expect(match.getSnapshot()).toEqual(before);
    expect(match.getRevision()).toBe(2);
    expect(match.getTimeline()).toHaveLength(3);
  });

  it('init-placed city: build preserves level, upgrade preserves queue', () => {
    const placed: CitiesData = {
      schemaVersion: 1,
      cities: { p1: { level: 2, queue: [{ type: 'house', remaining: 5 }] } },
    };
    const match = cityMatch(customBuildings(), flush(), placed);
    build(match, 'r1', P1, 'tower');
    expect(match.getSnapshot().cities).toEqual({
      schemaVersion: 1,
      cities: {
        p1: {
          level: 2,
          queue: [
            { type: 'house', remaining: 5 },
            { type: 'tower', remaining: 1 },
          ],
        },
      },
    });
    raise(match, 'r2', P1);
    const city = match.getSnapshot().cities?.cities['p1'];
    expect(city?.level).toBe(3);
    expect(city?.queue).toHaveLength(2);
  });

  it('upgrade takes no params (no-params pre-rule)', () => {
    const match = cityMatch();
    const session = match.join(P1);
    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: UPGRADE_TRANSITION, payload: { x: 1 } }),
      ),
    ).toEqual({
      status: 'rejected',
      reason: 'validation: [no-params] city.upgrade takes no parameters',
    });
  });

  it('cityless advance keeps M005 identity (tick-only, no extra facts)', () => {
    const match = cityMatch(customBuildings(), flush());
    const before = match.getSnapshot();
    expect(tick(match, 'r1', P1)).toEqual({ status: 'applied', revision: 1, summary: 'tick=1' });
    expect(match.getSnapshot()).toEqual({ ...before, tick: 1 });
    expect(match.getEvents().map((e) => e.type)).toEqual(['match.started', 'match.advanced']);
  });
});

describe('WorldState extension: cities (integration)', () => {
  it('accepts cities without a map (cities are map-independent)', () => {
    const placed: CitiesData = {
      schemaVersion: 1,
      cities: { p1: { level: 2, queue: [{ type: 'house', remaining: 5 }] } },
    };
    const world = createWorldState({ players: [P1, P2], cities: placed });
    expect(world.cities).toEqual(placed);
  });

  it('rejects malformed cities', () => {
    expect(() => createWorldState({ players: [P1, P2], cities: {} as CitiesData })).toThrow(
      /invalid initial world/,
    );
    const world = createWorldState({ players: [P1, P2] });
    expect(isWorldState({ ...world, cities: { schemaVersion: 1, cities: {} } })).toBe(true);
    expect(isWorldState({ ...world, cities: { schemaVersion: 2, cities: {} } })).toBe(false);
  });

  it('omits cities when absent (bytes intact)', () => {
    const world = createWorldState({ players: [P1, P2] });
    expect('cities' in world).toBe(false);
  });
});

describe('perception carry: city (integration)', () => {
  it('perceive carries the city alongside knowledge (golden)', () => {
    const placed: CitiesData = {
      schemaVersion: 1,
      cities: { p1: { level: 2, queue: [{ type: 'house', remaining: 5 }] } },
    };
    const world = createWorldState({ players: [P1, P2], cities: placed });
    const known = perceive(world, P1);
    expect(known.city).toEqual({ level: 2, queue: [{ type: 'house', remaining: 5 }] });
    expect(known.exploredCells).toEqual([]);
  });

  it('virtual idle when absent; others cities stay out (fail-closed)', () => {
    const world = createWorldState({ players: [P1, P2] });
    expect(perceive(world, P1).city).toEqual({ level: 1, queue: [] });
    const crowded: CitiesData = {
      schemaVersion: 1,
      cities: {
        p1: { level: 2, queue: [] },
        zx: { level: 3, queue: [{ type: 'tower', remaining: 9 }] },
      },
    };
    const known = perceive(createWorldState({ players: [P1, P2], cities: crowded }), P1);
    expect(known.city).toEqual({ level: 2, queue: [] });
  });
});
