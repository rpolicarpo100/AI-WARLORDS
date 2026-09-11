/**
 * M026 — Military Tests: transversal arc suite (units → movement → combat →
 * damage → training composed in one Match, plus battle determinism).
 * Complements the per-transition suites; proves the military arc as a whole.
 */
import { describe, expect, it } from 'vitest';
import { markUntrusted, type ClientRequest, type PlayerId, type Untrusted } from './authority.js';
import { isMapData, type MapCell, type MapData } from './map.js';
import { Match, STANDARD_RULESET } from './match.js';
import {
  ATTACK_TRANSITION,
  MOVE_TRANSITION,
  TRAIN_TRANSITION,
  type UnitsConfig,
} from './warfare.js';
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

/** Simulates untrusted wire bytes: unknown input, marked at the boundary. */
function raw(value: unknown): Untrusted<ClientRequest> {
  return markUntrusted(value as ClientRequest);
}

function fieldStrip(cells: number, id: string): MapData {
  const row: MapCell[] = [];
  for (let col = 0; col < cells; col += 1) {
    row.push({ col, row: 0, terrain: 'field' });
  }
  const map: MapData = {
    schemaVersion: 1,
    id: id as MapData['id'],
    width: cells,
    height: 1,
    stagger: 'odd',
    cells: row,
    spawns: [],
  };
  if (!isMapData(map)) {
    throw new Error('TEST BUG: fieldStrip invalid');
  }
  return map;
}

function campaign(): Match {
  return new Match({
    seed: 26,
    ruleset: STANDARD_RULESET,
    players: [P1, P2],
    initialState: createWorldState({
      players: [P1, P2],
      map: fieldStrip(4, 'test-campaign'),
      units: {
        schemaVersion: 1,
        nextId: 2,
        units: [
          { id: 'u0', owner: 'p1', type: 'warrior', hp: 12, col: 0, row: 0 },
          { id: 'u1', owner: 'p2', type: 'warrior', hp: 12, col: 1, row: 0 },
        ],
      },
      stockpiles: {
        schemaVersion: 1,
        stockpiles: { p1: { food: 100, wood: 50, stone: 0, gold: 20 } },
      },
    }),
    unitsConfig: drillUnits(),
  });
}

function order(match: Match, rid: string, player: PlayerId, type: string, params: unknown) {
  return match.dispatch(
    match.join(player),
    raw({ requestId: rid, playerId: player, type, payload: params }),
  );
}

describe('military arc journey (real Match)', () => {
  it('train → attack ×3 → slain → train again: ids never recycled, funds exact', () => {
    const match = campaign();
    expect(
      order(match, 'r1', P1, TRAIN_TRANSITION, { type: 'warrior', col: 2, row: 0 }),
    ).toMatchObject({ status: 'applied', summary: 'trained warrior u2 at 2,0' });
    expect(order(match, 'r2', P1, ATTACK_TRANSITION, { id: 'u2', target: 'u1' })).toMatchObject({
      status: 'applied',
      summary: 'attacked u1 for 4 (hp 12→8)',
    });
    expect(order(match, 'r3', P1, ATTACK_TRANSITION, { id: 'u2', target: 'u1' })).toMatchObject({
      status: 'applied',
      summary: 'attacked u1 for 4 (hp 8→4)',
    });
    expect(order(match, 'r4', P1, ATTACK_TRANSITION, { id: 'u2', target: 'u1' })).toMatchObject({
      status: 'applied',
      summary: 'attacked u1 for 4 (hp 4→0), slain',
    });
    expect(order(match, 'r5', P1, TRAIN_TRANSITION, { type: 'archer', col: 3, row: 0 })).toMatchObject(
      { status: 'applied', summary: 'trained archer u3 at 3,0' },
    );
    expect(order(match, 'r6', P1, MOVE_TRANSITION, { id: 'u0', col: 1, row: 0 })).toMatchObject({
      status: 'applied',
    });
    expect(match.getRevision()).toBe(6);
    const snapshot = match.getSnapshot();
    expect(snapshot.units).toEqual({
      schemaVersion: 1,
      nextId: 4,
      units: [
        { id: 'u0', owner: 'p1', type: 'warrior', hp: 12, col: 1, row: 0 },
        { id: 'u2', owner: 'p1', type: 'warrior', hp: 12, col: 2, row: 0 },
        { id: 'u3', owner: 'p1', type: 'archer', hp: 8, col: 3, row: 0 },
      ],
    });
    expect(snapshot.stockpiles?.stockpiles['p1']).toEqual({
      food: 80,
      wood: 35,
      stone: 0,
      gold: 5,
    });
    expect(match.getEvents().map((e) => e.type).filter((t) => t.startsWith('unit.'))).toEqual([
      'unit.trained',
      'unit.attacked',
      'unit.attacked',
      'unit.attacked',
      'unit.slain',
      'unit.trained',
      'unit.moved',
    ]);
    expect(match.getEvents().filter((e) => e.type === 'unit.slain')).toEqual([
      expect.objectContaining({ payload: { player: 'p1', unit: 'u2', target: 'u1' } }),
    ]);
  });
});

describe('battle determinism (twin Matches)', () => {
  it('same seed + same script incl. a kill: identical snapshot and events', () => {
    const script: Array<[string, unknown]> = [
      [TRAIN_TRANSITION, { type: 'warrior', col: 2, row: 0 }],
      [ATTACK_TRANSITION, { id: 'u2', target: 'u1' }],
      [ATTACK_TRANSITION, { id: 'u2', target: 'u1' }],
      [ATTACK_TRANSITION, { id: 'u2', target: 'u1' }],
      [TRAIN_TRANSITION, { type: 'archer', col: 3, row: 0 }],
      [MOVE_TRANSITION, { id: 'u0', col: 1, row: 0 }],
    ];
    const run = (): { snapshot: unknown; events: unknown } => {
      const match = campaign();
      script.forEach(([type, params], index) => {
        const result = order(match, `r${index + 1}`, P1, type, params);
        if (result.status !== 'applied') {
          throw new Error(`TEST BUG: script step ${index + 1} not applied`);
        }
      });
      return { snapshot: match.getSnapshot(), events: match.getEvents() };
    };
    const first = run();
    const second = run();
    expect(second.snapshot).toEqual(first.snapshot);
    expect(second.events).toEqual(first.events);
  });
});
