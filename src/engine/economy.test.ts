/**
 * M016 — Economy tests: config guard + neutral default, exact ops
 * (credit/debit/canAfford), WorldState extension, perception carry.
 */
import { describe, expect, it } from 'vitest';
import type { PlayerId } from './authority.js';
import { canAfford, credit, debit, DEFAULT_ECONOMY_CONFIG, isEconomyConfig } from './economy.js';
import type { StockpilesData } from './stockpiles.js';
import { createWorldValidator } from './validation.js';
import { createWorldState, isWorldState } from './world-state.js';
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
