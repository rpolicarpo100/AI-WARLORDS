/**
 * M049 — Match counterfactual wiring tests: live whatIf queries over a
 * real Match (D-043, voted sim-query). Hypotheticals run the live
 * domain handlers over forks — the real Match never moves (hash,
 * events, revision, prompts all pinned intact).
 */
import { describe, expect, it } from 'vitest';
import type { PlayerId } from './authority.js';
import type { CommanderOrder, CommandersData } from './commanders.js';
import { isMapData, type MapCell, type MapData } from './map.js';
import { Match, STANDARD_RULESET } from './match.js';
import type { UnitsConfig } from './warfare.js';
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
    id: 'whatif-live' as MapData['id'],
    width: 3,
    height: 3,
    stagger: 'odd',
    cells,
    spawns: [],
  };
  if (!isMapData(map)) {
    throw new Error('TEST BUG: whatif map invalid');
  }
  return map;
}

interface CampaignOptions {
  readonly p1Orders?: ReadonlyArray<CommanderOrder>;
  readonly commanders?: boolean;
  readonly tightFunds?: boolean;
}

function campaign(options: CampaignOptions = {}): Match {
  const commanders: CommandersData | undefined =
    options.commanders === false
      ? undefined
      : {
          schemaVersion: 1,
          nextId: 1,
          commanders: [
            { id: 'c0', owner: 'p1', active: true, orders: [...(options.p1Orders ?? [])] },
          ],
        };
  return new Match({
    seed: 49,
    ruleset: STANDARD_RULESET,
    players: [P1, P2],
    initialState: createWorldState({
      players: [P1, P2],
      map: liveMap(),
      units: {
        schemaVersion: 1,
        nextId: 3,
        units: [
          { id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 },
          { id: 'u1', owner: 'p1', type: 'warrior', hp: 12, col: 1, row: 0 },
          { id: 'u2', owner: 'p2', type: 'archer', hp: 8, col: 1, row: 1 },
        ],
      },
      stockpiles: {
        schemaVersion: 1,
        stockpiles: options.tightFunds
          ? { p1: { food: 20, wood: 0, stone: 0, gold: 5 } }
          : {
              p1: { food: 200, wood: 200, stone: 200, gold: 200 },
              p2: { food: 5, wood: 0, stone: 0, gold: 0 },
            },
      },
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
  });
}

function unitAt(match: Match, id: string): { col: number; row: number } | undefined {
  const found = match.getSnapshot().units?.units.find((unit) => unit.id === id);
  return found === undefined ? undefined : { col: found.col, row: found.row };
}

describe('whatIf (live query)', () => {
  it('simulates a march through the live handler and scores the outcome', () => {
    const match = campaign({
      p1Orders: [{ kind: 'unit.move', params: { id: 'u0', col: 0, row: 1 } }],
    });
    // Hypothetical marches u0 to (0,1); the target then marches nowhere.
    expect(
      match.whatIf('c0', 0, { kind: 'unit.move', params: { id: 'u0', col: 0, row: 1 } }),
    ).toEqual({
      applied: true,
      outcome: {
        orderIndex: 0,
        kind: 'unit.move',
        score: 60,
        failed: ['out-of-range', 'redundant'],
      },
    });
    // Reality never moved.
    expect(unitAt(match, 'u0')).toEqual({ col: 0, row: 0 });
  });

  it('simulates spending: affordable now, unaffordable after the hypothetical train', () => {
    const match = campaign({
      p1Orders: [{ kind: 'unit.train', params: { type: 'warrior', col: 1, row: 2 } }],
      tightFunds: true,
    });
    expect(match.confidenceOf('c0', 0)?.failed).toEqual([]);
    expect(
      match.whatIf('c0', 0, {
        kind: 'unit.train',
        params: { type: 'warrior', col: 1, row: 2 },
      }),
    ).toEqual({
      applied: true,
      outcome: {
        orderIndex: 0,
        kind: 'unit.train',
        score: 80,
        failed: ['unaffordable'],
      },
    });
    // Reality never paid.
    expect(match.confidenceOf('c0', 0)?.failed).toEqual([]);
  });

  it('surfaces live handler rejections verbatim', () => {
    const match = campaign({
      p1Orders: [{ kind: 'unit.move', params: { id: 'u0', col: 0, row: 1 } }],
    });
    expect(
      match.whatIf('c0', 0, { kind: 'unit.move', params: { id: 'u0', col: 2, row: 2 } }),
    ).toEqual({ applied: false, reason: 'move: not adjacent.' });
  });

  it('surfaces live rule details verbatim', () => {
    const match = campaign({
      p1Orders: [{ kind: 'unit.move', params: { id: 'u0', col: 0, row: 1 } }],
    });
    expect(match.whatIf('c0', 0, { kind: 'unit.move', params: { id: 'u0' } })).toEqual({
      applied: false,
      reason: 'move takes { id string, col/row uint32 }',
    });
  });

  it('rejects non-orderable hypotheticals', () => {
    const match = campaign({
      p1Orders: [{ kind: 'unit.move', params: { id: 'u0', col: 0, row: 1 } }],
    });
    expect(match.whatIf('c0', 0, { kind: 'city.upgrade', params: {} })).toEqual({
      applied: false,
      reason: 'counterfactual: not orderable.',
    });
  });

  it('yields undefined for unknown commanders, bad indexes, and missing data', () => {
    const match = campaign({ p1Orders: [{ kind: 'unit.move' }] });
    expect(
      match.whatIf('c9', 0, { kind: 'unit.move', params: { id: 'u0', col: 0, row: 1 } }),
    ).toBeUndefined();
    expect(
      match.whatIf('c0', 5, { kind: 'unit.move', params: { id: 'u0', col: 0, row: 1 } }),
    ).toBeUndefined();
    const bare = campaign({ commanders: false });
    expect(
      bare.whatIf('c0', 0, { kind: 'unit.move', params: { id: 'u0', col: 0, row: 1 } }),
    ).toBeUndefined();
  });

  it('leaves no trace (hash, events, revision, prompts intact)', () => {
    const match = campaign({
      p1Orders: [{ kind: 'unit.move', params: { id: 'u0', col: 0, row: 1 } }],
    });
    const hash = match.getStateHash();
    const events = match.getEvents().length;
    const revision = match.getRevision();
    const prompts = JSON.parse(JSON.stringify(match.getSnapshot().prompts)) as unknown;
    const verdict = match.whatIf('c0', 0, {
      kind: 'unit.move',
      params: { id: 'u0', col: 0, row: 1 },
    });
    expect(verdict?.applied).toBe(true);
    expect(match.getStateHash()).toBe(hash);
    expect(match.getEvents().length).toBe(events);
    expect(match.getRevision()).toBe(revision);
    expect(JSON.parse(JSON.stringify(match.getSnapshot().prompts)) as unknown).toEqual(prompts);
  });
});
