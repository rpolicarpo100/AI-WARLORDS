/**
 * M048 — Match confidence wiring tests: live confidenceOf queries over a
 * real Match (D-042, voted reason-eval). Custom units config (defaults
 * are placeholders — costless, hp 1, damage 0); costly-house variant
 * for the build-cost path. Read-only: queries never mutate the Match.
 */
import { describe, expect, it } from 'vitest';
import { markUntrusted, type ClientRequest, type PlayerId, type Untrusted } from './authority.js';
import type { CommanderOrder, CommandersData } from './commanders.js';
import { DEFAULT_BUILDINGS_CONFIG } from './economy.js';
import { isMapData, type MapCell, type MapData } from './map.js';
import { Match, STANDARD_RULESET } from './match.js';
import type { StockpilesData } from './stockpiles.js';
import { TRAIN_TRANSITION, type UnitsConfig } from './warfare.js';
import { createWorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

/** Same battle-proven numbers as warfare.test.ts customUnits. */
function drillUnits(): UnitsConfig {
  return {
    worker: { cost: { food: 10 }, maxHp: 5, damage: 1 },
    warrior: { cost: { food: 20, gold: 5 }, maxHp: 12, damage: 4 },
    archer: { cost: { wood: 15, gold: 10 }, maxHp: 8, damage: 3 },
  };
}

function raw(value: unknown): Untrusted<ClientRequest> {
  return markUntrusted(value as ClientRequest);
}

interface CampaignOptions {
  readonly p1Orders?: ReadonlyArray<CommanderOrder>;
  readonly p2Orders?: ReadonlyArray<CommanderOrder>;
  readonly stockpiles?: boolean;
  readonly commanders?: boolean;
  readonly costlyHouse?: boolean;
  readonly tightFunds?: boolean;
}

/** Typed 3x3 grid (M045 mold — the MapId brand forbids inline literals). */
function liveMap(): MapData {
  const cells: MapCell[] = [
    { col: 0, row: 0, terrain: 'resource', resource: { type: 'gold', amount: 5 } },
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
    id: 'confidence-live' as MapData['id'],
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

function campaign(options: CampaignOptions = {}): Match {
  const stockpiles: StockpilesData = options.tightFunds
    ? { schemaVersion: 1, stockpiles: { p1: { food: 20, wood: 0, stone: 0, gold: 5 } } }
    : {
        schemaVersion: 1,
        stockpiles: {
          p1: { food: 200, wood: 200, stone: 200, gold: 200 },
          p2: { food: 5, wood: 0, stone: 0, gold: 0 },
        },
      };
  const commanders: CommandersData | undefined =
    options.commanders === false
      ? undefined
      : {
          schemaVersion: 1,
          nextId: 2,
          commanders: [
            { id: 'c0', owner: 'p1', active: true, orders: [...(options.p1Orders ?? [])] },
            { id: 'c1', owner: 'p2', active: true, orders: [...(options.p2Orders ?? [])] },
          ],
        };
  return new Match({
    seed: 48,
    ruleset: STANDARD_RULESET,
    players: [P1, P2],
    initialState: createWorldState({
      players: [P1, P2],
      map: liveMap(),
      units: {
        schemaVersion: 1,
        nextId: 4,
        units: [
          { id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 },
          { id: 'u1', owner: 'p1', type: 'warrior', hp: 12, col: 1, row: 0 },
          { id: 'u2', owner: 'p2', type: 'archer', hp: 8, col: 1, row: 1 },
          { id: 'u6', owner: 'p2', type: 'warrior', hp: 12, col: 2, row: 1 },
          { id: 'u7', owner: 'p1', type: 'worker', hp: 5, col: 2, row: 2 },
        ],
      },
      stockpiles: options.stockpiles === false ? undefined : stockpiles,
      buildings: {
        schemaVersion: 1,
        buildings: {
          p1: { 'town-center': 1, house: 0, storage: 1, barracks: 0, wall: 0, tower: 0 },
          p2: { 'town-center': 1, house: 0, storage: 0, barracks: 0, wall: 0, tower: 0 },
        },
      },
      cities: {
        schemaVersion: 1,
        cities: {
          p1: { level: 1, queue: [] },
          p2: { level: 1, queue: [] },
        },
      },
      commanders,
    }),
    unitsConfig: drillUnits(),
    ...(options.costlyHouse === true
      ? {
          buildingsConfig: {
            ...DEFAULT_BUILDINGS_CONFIG,
            house: { cost: { food: 999 }, buildTime: 0 },
          },
        }
      : {}),
  });
}

describe('confidenceOf (live query)', () => {
  it('prices a far march over live terrain', () => {
    const match = campaign({
      p1Orders: [{ kind: 'unit.move', params: { id: 'u0', col: 2, row: 2 } }],
    });
    expect(match.confidenceOf('c0', 0)).toEqual({
      orderIndex: 0,
      kind: 'unit.move',
      score: 80,
      failed: ['out-of-range'],
    });
  });

  it('fires blocked through the live passable adapter', () => {
    const match = campaign({
      p1Orders: [{ kind: 'unit.move', params: { id: 'u0', col: 2, row: 0 } }],
    });
    expect(match.confidenceOf('c0', 0)?.failed).toEqual(['blocked', 'out-of-range']);
  });

  it('fires suicidal through live damage and defense', () => {
    const match = campaign({
      p1Orders: [{ kind: 'unit.attack', params: { id: 'u7', target: 'u6' } }],
    });
    expect(match.confidenceOf('c0', 0)?.failed).toEqual(['suicidal']);
  });

  it('passes affordable trains through the live treasury', () => {
    const match = campaign({
      p1Orders: [{ kind: 'unit.train', params: { type: 'warrior', col: 1, row: 2 } }],
    });
    expect(match.confidenceOf('c0', 0)?.failed).toEqual([]);
  });

  it('fires unaffordable for poor holders', () => {
    const match = campaign({
      p2Orders: [{ kind: 'unit.train', params: { type: 'warrior', col: 1, row: 2 } }],
    });
    expect(match.confidenceOf('c1', 0)?.failed).toEqual(['unaffordable']);
  });

  it('prices builds through the live buildings config (costly house)', () => {
    const match = campaign({
      p1Orders: [{ kind: 'city.build', params: { type: 'house' } }],
      costlyHouse: true,
    });
    expect(match.confidenceOf('c0', 0)?.failed).toEqual(['unaffordable']);
  });

  it('yields undefined for unknown commanders and bad indexes', () => {
    const match = campaign({ p1Orders: [{ kind: 'unit.move' }] });
    expect(match.confidenceOf('c9', 0)).toBeUndefined();
    expect(match.confidenceOf('c0', 3)).toBeUndefined();
  });

  it('abstains on unknown types (adapters never throw)', () => {
    const match = campaign({
      p1Orders: [
        { kind: 'unit.train', params: { type: 'dragon', col: 1, row: 2 } },
        { kind: 'city.build', params: { type: 'palace' } },
      ],
    });
    expect(match.confidenceOf('c0', 0)?.failed).toEqual([]);
    expect(match.confidenceOf('c0', 1)?.failed).toEqual([]);
  });

  it('treats a missing treasury as unaffordable', () => {
    const match = campaign({
      p1Orders: [{ kind: 'unit.train', params: { type: 'warrior', col: 1, row: 2 } }],
      stockpiles: false,
    });
    expect(match.confidenceOf('c0', 0)?.failed).toEqual(['unaffordable']);
  });

  it('yields undefined without commanders data', () => {
    const match = campaign({ commanders: false });
    expect(match.confidenceOf('c0', 0)).toBeUndefined();
  });

  it('tracks spending (freshness: affordable until the treasury pays)', () => {
    const match = campaign({
      p1Orders: [{ kind: 'unit.train', params: { type: 'warrior', col: 1, row: 2 } }],
      tightFunds: true,
    });
    expect(match.confidenceOf('c0', 0)?.failed).toEqual([]);
    const outcome = match.dispatch(
      match.join(P1),
      raw({
        requestId: 'r1',
        playerId: P1,
        type: TRAIN_TRANSITION,
        payload: { type: 'warrior', col: 1, row: 2 },
      }),
    );
    expect(outcome.status).toBe('applied');
    expect(match.confidenceOf('c0', 0)?.failed).toEqual(['unaffordable']);
  });

  it('never mutates the Match (read-only)', () => {
    const match = campaign({
      p1Orders: [{ kind: 'unit.move', params: { id: 'u0', col: 2, row: 2 } }],
    });
    const before = match.getStateHash();
    match.confidenceOf('c0', 0);
    match.confidenceOf('c9', 0);
    expect(match.getStateHash()).toBe(before);
  });
});
