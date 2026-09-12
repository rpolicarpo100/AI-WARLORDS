/**
 * M048 — Confidence engine tests: the five M046 reason evaluators plus
 * the composite score, as pure queries over fabricated battle states
 * (D-042, voted reason-eval). Rules are hand-built literals (injected,
 * warfareHandlers precedent); the Match adaptation is pinned in
 * match-confidence.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { PlayerId } from './authority.js';
import type { CommanderOrder, CommanderRecord } from './commanders.js';
import { confidenceOfOrder, type ConfidenceRules, type ConfidenceUnitStats } from './confidence.js';
import { isMapData, neighborsOf, type MapCell, type MapData } from './map.js';
import { createWorldState, type WorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

const STATS: Record<string, ConfidenceUnitStats> = {
  worker: { damage: 1, maxHp: 5, cost: { food: 10 } },
  warrior: { damage: 4, maxHp: 12, cost: { food: 20, gold: 5 } },
  archer: { damage: 3, maxHp: 8, cost: { wood: 15, gold: 10 } },
};

const FUNDS: Record<string, { food: number; wood: number; stone: number; gold: number }> = {
  p1: { food: 60, wood: 45, stone: 30, gold: 25 },
  p2: { food: 5, wood: 0, stone: 0, gold: 0 },
};

const RULES: ConfidenceRules = {
  unitStatsOf: (type) => STATS[type],
  buildCostOf: (type) => (type === 'house' ? { food: 50 } : undefined),
  passable: (terrain) => terrain !== 'river',
  defenseOf: (terrain) => (terrain === 'mountain' ? 2 : 0),
  canAfford: (holder, cost) => {
    const funds = FUNDS[holder] ?? { food: 0, wood: 0, stone: 0, gold: 0 };
    return (
      funds.food >= (cost.food ?? 0) &&
      funds.wood >= (cost.wood ?? 0) &&
      funds.stone >= (cost.stone ?? 0) &&
      funds.gold >= (cost.gold ?? 0)
    );
  },
};

interface BattleOptions {
  readonly node?: number;
  readonly map?: boolean;
  readonly orders?: ReadonlyArray<CommanderOrder>;
  readonly owner?: string;
}

/** 3x3 grid: gold node at (0,0), river at (2,0), mountain at (2,1) (M045 mold). */
function battleMap(node: number): MapData {
  const cells: MapCell[] = [
    { col: 0, row: 0, terrain: 'resource', resource: { type: 'gold', amount: node } },
    { col: 1, row: 0, terrain: 'field' },
    { col: 2, row: 0, terrain: 'river' },
    { col: 0, row: 1, terrain: 'field' },
    { col: 1, row: 1, terrain: 'field' },
    { col: 2, row: 1, terrain: 'mountain' },
    { col: 0, row: 2, terrain: 'field' },
    { col: 1, row: 2, terrain: 'field' },
    { col: 2, row: 2, terrain: 'field' },
  ];
  const map: MapData = {
    schemaVersion: 1,
    id: 'confidence-drill' as MapData['id'],
    width: 3,
    height: 3,
    stagger: 'odd',
    cells,
    spawns: [],
  };
  if (!isMapData(map)) {
    throw new Error('TEST BUG: confidence map invalid');
  }
  return map;
}

function battle(options: BattleOptions = {}): { state: WorldState; record: CommanderRecord } {
  const geometry = battleMap(5);
  const foeSpots = neighborsOf(geometry, 1, 0);
  const foe = foeSpots.find((cell) => !(cell.col === 0 && cell.row === 0)) ?? foeSpots[0]!;
  const map = options.map === false ? undefined : battleMap(options.node ?? 5);
  const state = createWorldState({
    players: [P1, P2],
    map,
    units: {
      schemaVersion: 1,
      nextId: 8,
      units: [
        { id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 },
        { id: 'u1', owner: 'p1', type: 'warrior', hp: 12, col: 1, row: 0 },
        { id: 'u2', owner: 'p2', type: 'archer', hp: 8, col: foe.col, row: foe.row },
        { id: 'u4', owner: 'p1', type: 'warrior', hp: 2, col: 0, row: 1 },
        { id: 'u5', owner: 'p2', type: 'archer', hp: 8, col: 0, row: 2 },
        { id: 'u6', owner: 'p2', type: 'warrior', hp: 12, col: 2, row: 1 },
        { id: 'u7', owner: 'p1', type: 'worker', hp: 5, col: 2, row: 2 },
        { id: 'u9a', owner: 'p1', type: 'warrior', hp: 12, col: 9, row: 9 },
        { id: 'u9b', owner: 'p2', type: 'archer', hp: 8, col: 9, row: 9 },
      ],
    },
  });
  const record: CommanderRecord = {
    id: 'c0',
    owner: options.owner ?? 'p1',
    active: true,
    orders: [...(options.orders ?? [])],
  };
  return { state, record };
}

function judge(order: CommanderOrder, options: BattleOptions = {}, rules: ConfidenceRules = RULES) {
  const { state, record } = battle({ ...options, orders: [order] });
  return confidenceOfOrder(record, 0, state, rules);
}

describe('confidence fail-soft (queries never throw)', () => {
  it('yields undefined for missing records', () => {
    const { state } = battle();
    expect(confidenceOfOrder(undefined, 0, state, RULES)).toBeUndefined();
  });

  it('yields undefined for records without queues', () => {
    const { state } = battle();
    const bare: CommanderRecord = { id: 'c0', owner: 'p1', active: true };
    expect(confidenceOfOrder(bare, 0, state, RULES)).toBeUndefined();
  });

  it('yields undefined for indexes outside the queue', () => {
    const { state, record } = battle({ orders: [{ kind: 'unit.move' }] });
    expect(confidenceOfOrder(record, 5, state, RULES)).toBeUndefined();
    expect(confidenceOfOrder(record, -1, state, RULES)).toBeUndefined();
  });
});

describe('blocked (move onto impassable)', () => {
  it('fires on river targets (far bank: blocked and out-of-range)', () => {
    expect(judge({ kind: 'unit.move', params: { id: 'u0', col: 2, row: 0 } })).toEqual({
      orderIndex: 0,
      kind: 'unit.move',
      score: 60,
      failed: ['blocked', 'out-of-range'],
    });
  });

  it('passes on field targets', () => {
    const verdict = judge({ kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } });
    expect(verdict?.failed).toEqual([]);
  });

  it('abstains on non-moves and incomplete targets', () => {
    const orders: CommanderOrder[] = [
      { kind: 'unit.attack', params: { id: 'u1', target: 'u2' } },
      { kind: 'unit.move' },
      { kind: 'unit.move', params: { id: 'u0' } },
      { kind: 'unit.move', params: { id: 'u0', col: 1 } },
      { kind: 'unit.move', params: { id: 'u0', row: 0 } },
    ];
    for (const order of orders) {
      expect(judge(order)?.failed).toEqual([]);
    }
    // Off-map targets abstain on blocked (range still fires — nowhere is far).
    const offmap = judge({ kind: 'unit.move', params: { id: 'u0', col: 9, row: 9 } });
    expect(offmap?.failed).not.toContain('blocked');
    expect(
      judge({ kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } }, { map: false })?.failed,
    ).toEqual([]);
  });
});

describe('out-of-range (melee legs only)', () => {
  it('fires on far moves', () => {
    const verdict = judge({ kind: 'unit.move', params: { id: 'u0', col: 2, row: 2 } });
    expect(verdict?.failed).toEqual(['out-of-range']);
  });

  it('passes on adjacent moves', () => {
    const verdict = judge({ kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } });
    expect(verdict?.failed).toEqual([]);
  });

  it('abstains on incomplete move legs', () => {
    const orders: CommanderOrder[] = [
      { kind: 'unit.move' },
      { kind: 'unit.move', params: { col: 1, row: 0 } },
      { kind: 'unit.move', params: { id: 'u9', col: 1, row: 0 } },
      { kind: 'unit.move', params: { id: 'u0', row: 0 } },
      { kind: 'unit.move', params: { id: 'u0', col: 1 } },
    ];
    for (const order of orders) {
      expect(judge(order)?.failed).toEqual([]);
    }
    expect(
      judge({ kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } }, { map: false })?.failed,
    ).toEqual([]);
  });

  it('fires on far attacks', () => {
    const verdict = judge({ kind: 'unit.attack', params: { id: 'u1', target: 'u5' } });
    expect(verdict?.failed).toEqual(['out-of-range']);
  });

  it('passes on adjacent attacks', () => {
    const verdict = judge({ kind: 'unit.attack', params: { id: 'u1', target: 'u2' } });
    expect(verdict?.failed).toEqual([]);
  });

  it('abstains on incomplete attack legs', () => {
    const orders: CommanderOrder[] = [
      { kind: 'unit.attack' },
      { kind: 'unit.attack', params: { target: 'u2' } },
      { kind: 'unit.attack', params: { id: 'u1' } },
      { kind: 'unit.attack', params: { id: 'u9', target: 'u2' } },
      { kind: 'unit.attack', params: { id: 'u1', target: 'u9' } },
    ];
    for (const order of orders) {
      expect(judge(order)?.failed).toEqual([]);
    }
    expect(
      judge({ kind: 'unit.attack', params: { id: 'u1', target: 'u2' } }, { map: false })?.failed,
    ).toEqual([]);
  });

  it('never ranges non-march kinds', () => {
    const verdict = judge({ kind: 'economy.gather', params: { col: 0, row: 0 } });
    expect(verdict?.failed).toEqual([]);
  });
});

describe('redundant (marching in place, gathering dust)', () => {
  it('fires on same-cell moves (and range — a march nowhere is no march)', () => {
    const verdict = judge({ kind: 'unit.move', params: { id: 'u0', col: 0, row: 0 } });
    expect(verdict?.failed).toEqual(['out-of-range', 'redundant']);
    expect(verdict?.score).toBe(60);
  });

  it('passes on genuine marches', () => {
    const verdict = judge({ kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } });
    expect(verdict?.failed).toEqual([]);
  });

  it('abstains on incomplete move legs', () => {
    const orders: CommanderOrder[] = [
      { kind: 'unit.move' },
      { kind: 'unit.move', params: { col: 0, row: 0 } },
      { kind: 'unit.move', params: { id: 'u9', col: 0, row: 0 } },
      { kind: 'unit.move', params: { id: 'u0', row: 0 } },
      { kind: 'unit.move', params: { id: 'u0', col: 0 } },
    ];
    for (const order of orders) {
      expect(judge(order)?.failed).not.toContain('redundant');
    }
  });

  it('fires on depleted nodes', () => {
    const verdict = judge({ kind: 'economy.gather', params: { col: 0, row: 0 } }, { node: 0 });
    expect(verdict?.failed).toEqual(['redundant']);
  });

  it('passes on live nodes', () => {
    const verdict = judge({ kind: 'economy.gather', params: { col: 0, row: 0 } });
    expect(verdict?.failed).toEqual([]);
  });

  it('fires on resourceless ground', () => {
    const verdict = judge({ kind: 'economy.gather', params: { col: 1, row: 0 } });
    expect(verdict?.failed).toEqual(['redundant']);
  });

  it('abstains on incomplete gather legs', () => {
    const orders: CommanderOrder[] = [
      { kind: 'economy.gather' },
      { kind: 'economy.gather', params: { row: 0 } },
      { kind: 'economy.gather', params: { col: 0 } },
      { kind: 'economy.gather', params: { col: 9, row: 9 } },
    ];
    for (const order of orders) {
      expect(judge(order)?.failed).toEqual([]);
    }
    expect(
      judge({ kind: 'economy.gather', params: { col: 0, row: 0 } }, { map: false })?.failed,
    ).toEqual([]);
  });
});

describe('suicidal (pricing the foe’s next turn)', () => {
  it('fires when the attacker cannot scratch (net zero)', () => {
    const verdict = judge({ kind: 'unit.attack', params: { id: 'u7', target: 'u6' } });
    expect(verdict?.failed).toEqual(['suicidal']);
  });

  it('fires when the attacker dies if the foe answers (hp within one hit)', () => {
    const verdict = judge({ kind: 'unit.attack', params: { id: 'u4', target: 'u5' } });
    expect(verdict?.failed).toEqual(['suicidal']);
  });

  it('passes fair fights', () => {
    const verdict = judge({ kind: 'unit.attack', params: { id: 'u1', target: 'u2' } });
    expect(verdict?.failed).toEqual([]);
  });

  it('abstains on unknown unit types', () => {
    const blind: ConfidenceRules = { ...RULES, unitStatsOf: () => undefined };
    const verdict = judge({ kind: 'unit.attack', params: { id: 'u1', target: 'u2' } }, {}, blind);
    expect(verdict?.failed).toEqual([]);
    const halfBlind: ConfidenceRules = {
      ...RULES,
      unitStatsOf: (type) => (type === 'warrior' ? STATS['warrior'] : undefined),
    };
    const half = judge({ kind: 'unit.attack', params: { id: 'u1', target: 'u2' } }, {}, halfBlind);
    expect(half?.failed).toEqual([]);
  });

  it('abstains off the map (range still fires — no march reaches nowhere)', () => {
    const verdict = judge({ kind: 'unit.attack', params: { id: 'u9a', target: 'u9b' } });
    expect(verdict?.failed).toEqual(['out-of-range']);
  });
});

describe('unaffordable (treasury truth)', () => {
  it('fires on trains the holder cannot pay', () => {
    const verdict = judge(
      { kind: 'unit.train', params: { type: 'warrior', col: 1, row: 1 } },
      { owner: 'p2' },
    );
    expect(verdict?.failed).toEqual(['unaffordable']);
  });

  it('passes on affordable trains', () => {
    const verdict = judge({ kind: 'unit.train', params: { type: 'warrior', col: 1, row: 1 } });
    expect(verdict?.failed).toEqual([]);
  });

  it('fires on builds the holder cannot pay', () => {
    const verdict = judge({ kind: 'city.build', params: { type: 'house' } }, { owner: 'p2' });
    expect(verdict?.failed).toEqual(['unaffordable']);
  });

  it('passes on affordable builds', () => {
    const verdict = judge({ kind: 'city.build', params: { type: 'house' } });
    expect(verdict?.failed).toEqual([]);
  });

  it('abstains on non-priced kinds and unknown types', () => {
    const orders: CommanderOrder[] = [
      { kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } },
      { kind: 'economy.gather', params: { col: 0, row: 0 } },
      { kind: 'unit.train' },
      { kind: 'unit.train', params: { col: 1, row: 1 } },
      { kind: 'unit.train', params: { type: 'dragon', col: 1, row: 1 } },
      { kind: 'city.build', params: { type: 'palace' } },
    ];
    for (const order of orders) {
      expect(judge(order)?.failed).toEqual([]);
    }
  });
});

describe('composite score (flat −20, canonical order)', () => {
  it('scores clean orders at 100', () => {
    expect(judge({ kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } })).toEqual({
      orderIndex: 0,
      kind: 'unit.move',
      score: 100,
      failed: [],
    });
  });

  it('scores single failures at 80', () => {
    const verdict = judge({ kind: 'unit.move', params: { id: 'u0', col: 2, row: 2 } });
    expect(verdict?.failed).toEqual(['out-of-range']);
    expect(verdict?.score).toBe(80);
  });

  it('evaluates per position (index echo on multi-order queues)', () => {
    const { state, record } = battle({
      orders: [
        { kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } },
        { kind: 'unit.move', params: { id: 'u0', col: 2, row: 2 } },
      ],
    });
    expect(confidenceOfOrder(record, 0, state, RULES)).toMatchObject({
      orderIndex: 0,
      score: 100,
    });
    expect(confidenceOfOrder(record, 1, state, RULES)).toMatchObject({
      orderIndex: 1,
      score: 80,
    });
  });
});
