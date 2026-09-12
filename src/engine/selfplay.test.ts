/**
 * M065 — simplePolicy unit tests: hand-built snapshots (cast seam,
 * M029 precedent — the policy is pure, no validation inside).
 * Attack > gather > approach > patrol > idle; deterministic ties.
 */
import { describe, expect, it } from 'vitest';
import type { PlayerId } from './authority.js';
import { axialDistance, neighborsOf, offsetToAxial, type MapCell, type MapData } from './map.js';
import { simplePolicy } from './selfplay.js';
import type { WorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;

const FIELD_ONLY = (terrain: string): boolean => terrain === 'field';

function mapWith(cells: ReadonlyArray<MapCell>): MapData {
  return {
    schemaVersion: 1,
    id: 'test-policy' as MapData['id'],
    width: 3,
    height: 3,
    stagger: 'odd',
    cells: [...cells],
    spawns: [],
  };
}

function fieldGrid(): MapData {
  const cells: MapCell[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      cells.push({ col, row, terrain: 'field' });
    }
  }
  return mapWith(cells);
}

interface UnitSeed {
  readonly id: string;
  readonly owner: string;
  readonly type: string;
  readonly hp: number;
  readonly col: number;
  readonly row: number;
}

function snapshot(
  map: MapData | undefined,
  units: ReadonlyArray<UnitSeed> | undefined,
): WorldState {
  return {
    schemaVersion: 1,
    players: [{ id: 'p1' as PlayerId }, { id: 'p2' as PlayerId }],
    map,
    units:
      units === undefined
        ? undefined
        : {
            schemaVersion: 1,
            nextId: units.length,
            units: units.map((unit) => ({ ...unit })),
          },
  } as WorldState;
}

describe('simplePolicy (template player)', () => {
  it('attacks adjacent foes (id order, workers brawl too)', () => {
    const seen = snapshot(fieldGrid(), [
      { id: 'u2', owner: 'p2', type: 'archer', hp: 8, col: 0, row: 0 },
      { id: 'u1', owner: 'p1', type: 'worker', hp: 5, col: 2, row: 2 },
      { id: 'u0', owner: 'p1', type: 'warrior', hp: 12, col: 0, row: 1 },
    ]);
    expect(simplePolicy(seen, P1, FIELD_ONLY)).toEqual({
      type: 'unit.attack',
      payload: { id: 'u0', target: 'u2' },
    });
    const brawl = snapshot(fieldGrid(), [
      { id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 1 },
      { id: 'u2', owner: 'p2', type: 'archer', hp: 8, col: 0, row: 0 },
    ]);
    expect(simplePolicy(brawl, P1, FIELD_ONLY)).toEqual({
      type: 'unit.attack',
      payload: { id: 'u0', target: 'u2' },
    });
  });

  it('gathers on live nodes, skips depleted ones', () => {
    const cells: MapCell[] = [];
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        cells.push(
          col === 0 && row === 0
            ? { col, row, terrain: 'resource', resource: { type: 'gold', amount: 5 } }
            : { col, row, terrain: 'field' },
        );
      }
    }
    const rich = snapshot(mapWith(cells), [
      { id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 },
      { id: 'u2', owner: 'p2', type: 'archer', hp: 8, col: 2, row: 2 },
    ]);
    expect(simplePolicy(rich, P1, FIELD_ONLY)).toEqual({
      type: 'economy.gather',
      payload: { col: 0, row: 0 },
    });
    const spent = cells.map((cell) =>
      cell.col === 0 && cell.row === 0
        ? { col: 0, row: 0, terrain: 'resource', resource: { type: 'gold', amount: 0 } }
        : cell,
    );
    const poor = snapshot(mapWith(spent as MapCell[]), [
      { id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 },
      { id: 'u2', owner: 'p2', type: 'archer', hp: 8, col: 2, row: 2 },
    ]);
    expect(simplePolicy(poor, P1, FIELD_ONLY)?.type).toBe('unit.move');
  });

  it('approaches the nearest foe (strict progress)', () => {
    const map = fieldGrid();
    const seen = snapshot(map, [
      { id: 'u1', owner: 'p1', type: 'warrior', hp: 12, col: 0, row: 0 },
      { id: 'u2', owner: 'p2', type: 'archer', hp: 8, col: 2, row: 0 },
      { id: 'u3', owner: 'p2', type: 'archer', hp: 8, col: 2, row: 2 },
    ]);
    const move = simplePolicy(seen, P1, FIELD_ONLY);
    expect(move?.type).toBe('unit.move');
    const payload = move?.payload as { readonly col: number; readonly row: number };
    const neighbors = neighborsOf(map, 0, 0);
    expect(neighbors.some((cell) => cell.col === payload.col && cell.row === payload.row)).toBe(
      true,
    );
    const before = Math.min(
      axialDistance(offsetToAxial(0, 0, 'odd'), offsetToAxial(2, 0, 'odd')),
      axialDistance(offsetToAxial(0, 0, 'odd'), offsetToAxial(2, 2, 'odd')),
    );
    const after = Math.min(
      axialDistance(offsetToAxial(payload.col, payload.row, 'odd'), offsetToAxial(2, 0, 'odd')),
      axialDistance(offsetToAxial(payload.col, payload.row, 'odd'), offsetToAxial(2, 2, 'odd')),
    );
    expect(after).toBeLessThan(before);
  });

  it('patrols the smallest cell without foes (deterministic ties)', () => {
    const map = fieldGrid();
    const seen = snapshot(map, [{ id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 1, row: 1 }]);
    const first = simplePolicy(seen, P1, FIELD_ONLY);
    const second = simplePolicy(seen, P1, FIELD_ONLY);
    expect(first).toEqual(second);
    expect(first?.type).toBe('unit.move');
    const payload = first?.payload as { readonly col: number; readonly row: number };
    const options = neighborsOf(map, 1, 1)
      .filter((cell) => cell.terrain === 'field')
      .map((cell) => `${cell.col},${cell.row}`)
      .sort();
    expect(`${payload.col},${payload.row}`).toBe(options[0]);
  });

  it('skips impassable neighbors', () => {
    const cells: MapCell[] = [];
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        cells.push(
          col === 1 && row === 0
            ? { col, row, terrain: 'field' }
            : { col, row, terrain: 'mountain' },
        );
      }
    }
    // No foes: the patrol branch crosses the same passable filter.
    const seen = snapshot(mapWith(cells), [
      { id: 'u1', owner: 'p1', type: 'warrior', hp: 12, col: 1, row: 1 },
    ]);
    expect(simplePolicy(seen, P1, FIELD_ONLY)).toEqual({
      type: 'unit.move',
      payload: { id: 'u1', col: 1, row: 0 },
    });
  });

  it('idles without map, units, foes-to-reach or living flesh', () => {
    expect(simplePolicy(snapshot(undefined, []), P1, FIELD_ONLY)).toBeNull();
    expect(simplePolicy(snapshot(fieldGrid(), undefined), P1, FIELD_ONLY)).toBeNull();
    expect(
      simplePolicy(
        snapshot(fieldGrid(), [{ id: 'u2', owner: 'p2', type: 'archer', hp: 8, col: 2, row: 2 }]),
        P1,
        FIELD_ONLY,
      ),
    ).toBeNull();
    expect(
      simplePolicy(
        snapshot(fieldGrid(), [{ id: 'u1', owner: 'p1', type: 'warrior', hp: 0, col: 1, row: 1 }]),
        P1,
        FIELD_ONLY,
      ),
    ).toBeNull();
    const water: MapCell[] = [];
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        water.push({ col, row, terrain: 'mountain' });
      }
    }
    expect(
      simplePolicy(
        snapshot(mapWith(water), [
          { id: 'u1', owner: 'p1', type: 'warrior', hp: 12, col: 1, row: 1 },
        ]),
        P1,
        FIELD_ONLY,
      ),
    ).toBeNull();
    expect(
      simplePolicy(
        snapshot(fieldGrid(), [{ id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 9, row: 9 }]),
        P1,
        FIELD_ONLY,
      ),
    ).toBeNull();
  });

  it('ignores adjacent allies (bloodthirst is exclusive)', () => {
    const seen = snapshot(fieldGrid(), [
      { id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 },
      { id: 'u1', owner: 'p1', type: 'warrior', hp: 12, col: 1, row: 0 },
      { id: 'u2', owner: 'p2', type: 'archer', hp: 8, col: 2, row: 2 },
    ]);
    const move = simplePolicy(seen, P1, FIELD_ONLY);
    expect(move?.type).toBe('unit.move');
  });
});
