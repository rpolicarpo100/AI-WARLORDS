/**
 * M067 — arena scoring tests: hand-built states (cast seam,
 * M065 precedent — scoring is pure derivation, no validation).
 * All-ones v1 weights; missing sections/holders score zero.
 */
import { describe, expect, it } from 'vitest';
import type { PlayerId } from './authority.js';
import { rankPlayers, scorePlayer, scoreTable } from './score.js';
import type { WorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

function state(sections: Record<string, unknown>): WorldState {
  return {
    schemaVersion: 1,
    players: [{ id: P1 }, { id: P2 }],
    ...sections,
  } as WorldState;
}

describe('scorePlayer (arena scoring)', () => {
  it('scores zero without sections (missing everything)', () => {
    const seen = state({});
    expect(scorePlayer(seen, P1)).toBe(0);
    expect(scorePlayer(seen, P2)).toBe(0);
    expect(rankPlayers(seen, [P2, P1])).toEqual([P1, P2]);
  });

  it('counts living own flesh only (corpses and foes excluded)', () => {
    const seen = state({
      units: {
        schemaVersion: 1,
        nextId: 3,
        units: [
          { id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 },
          { id: 'u1', owner: 'p1', type: 'warrior', hp: 0, col: 1, row: 0 },
          { id: 'u9', owner: 'p2', type: 'archer', hp: 8, col: 2, row: 2 },
        ],
      },
    });
    expect(scorePlayer(seen, P1)).toBe(5);
    expect(scorePlayer(seen, P2)).toBe(8);
  });

  it('adds wealth, cities and buildings (missing holders zero)', () => {
    const seen = state({
      stockpiles: {
        schemaVersion: 1,
        stockpiles: { p1: { food: 1, wood: 2, stone: 3, gold: 4 } },
      },
      cities: { schemaVersion: 1, cities: { p1: { level: 2, queue: [] } } },
      buildings: { schemaVersion: 1, buildings: { p1: { house: 2, mill: 1 } } },
    });
    expect(scorePlayer(seen, P1)).toBe(10 + 2 + 3);
    expect(scorePlayer(seen, P2)).toBe(0);
  });

  it('scores combined states exactly', () => {
    const seen = state({
      units: {
        schemaVersion: 1,
        nextId: 2,
        units: [
          { id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 },
          { id: 'u9', owner: 'p2', type: 'archer', hp: 8, col: 2, row: 2 },
        ],
      },
      stockpiles: {
        schemaVersion: 1,
        stockpiles: {
          p1: { food: 60, wood: 45, stone: 30, gold: 25 },
          p2: { food: 40, wood: 30, stone: 20, gold: 15 },
        },
      },
      cities: {
        schemaVersion: 1,
        cities: { p1: { level: 3, queue: [] }, p2: { level: 1, queue: [] } },
      },
      buildings: { schemaVersion: 1, buildings: { p1: { house: 4 } } },
    });
    expect(scorePlayer(seen, P1)).toBe(5 + 160 + 3 + 4);
    expect(scorePlayer(seen, P2)).toBe(8 + 105 + 1 + 0);
    expect(scoreTable(seen, [P1, P2])).toEqual({ p1: 172, p2: 114 });
  });

  it('ranks by score descending (ties by id)', () => {
    const seen = state({
      units: {
        schemaVersion: 1,
        nextId: 2,
        units: [
          { id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 },
          { id: 'u9', owner: 'p2', type: 'archer', hp: 8, col: 2, row: 2 },
        ],
      },
    });
    expect(rankPlayers(seen, [P1, P2])).toEqual([P2, P1]);
    const tied = state({
      units: {
        schemaVersion: 1,
        nextId: 2,
        units: [
          { id: 'u0', owner: 'p1', type: 'worker', hp: 8, col: 0, row: 0 },
          { id: 'u9', owner: 'p2', type: 'archer', hp: 8, col: 2, row: 2 },
        ],
      },
    });
    expect(rankPlayers(tied, [P2, P1])).toEqual([P1, P2]);
  });
});
