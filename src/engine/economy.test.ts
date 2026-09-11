/**
 * M016 — Economy tests: config guard + neutral default, exact ops
 * (credit/debit/canAfford), WorldState extension, perception carry.
 */
import { describe, expect, it } from 'vitest';
import { markUntrusted, type ClientRequest, type PlayerId, type Untrusted } from './authority.js';
import {
  canAfford,
  createGatherHandler,
  credit,
  debit,
  DEFAULT_ECONOMY_CONFIG,
  gatherParamsRule,
  gatherProducer,
  GATHER_TRANSITION,
  isEconomyConfig,
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
