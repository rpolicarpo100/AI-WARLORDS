/**
 * M036 — Player assessment tests: hand-computed goldens (full + sparse),
 * fail-soft abuse (unknown unit type, absent slots), average bounds
 * battery, fresh-copy, no-mutation.
 */
import { describe, expect, it } from 'vitest';
import type { PlayerId } from './authority.js';
import { assessPlayer, type StatsOf } from './assessment.js';
import type { WorldState } from './world-state.js';
import { createWorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

/** Drill stats (injected rules — the assessment invents nothing). */
const STATS: StatsOf = (type: string) => {
  const table: Record<string, { damage: number; maxHp: number }> = {
    worker: { damage: 1, maxHp: 5 },
    warrior: { damage: 4, maxHp: 12 },
    archer: { damage: 3, maxHp: 8 },
  };
  return table[type];
};

function campaign(): WorldState {
  return createWorldState({
    players: [P1, P2],
    units: {
      schemaVersion: 1,
      nextId: 3,
      units: [
        { id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 },
        { id: 'u1', owner: 'p1', type: 'warrior', hp: 12, col: 1, row: 0 },
        { id: 'u2', owner: 'p2', type: 'archer', hp: 8, col: 2, row: 0 },
      ],
    },
    stockpiles: {
      schemaVersion: 1,
      stockpiles: { p1: { food: 60, wood: 45, stone: 30, gold: 25 } },
    },
    buildings: {
      schemaVersion: 1,
      buildings: { p1: { 'town-center': 1, house: 2, storage: 1, barracks: 0, wall: 0, tower: 0 } },
    },
    cities: {
      schemaVersion: 1,
      cities: { p1: { level: 2, queue: [] } },
    },
    commanders: {
      schemaVersion: 1,
      nextId: 2,
      commanders: [
        { id: 'c0', owner: 'p1', active: true, personality: 'strategist', doctrine: 'turtle' },
        { id: 'c1', owner: 'p1', active: false },
      ],
    },
  });
}

describe('goldens (hand-computed)', () => {
  it('full holder: military sums + economy passthrough + exact average over mixed pair', () => {
    expect(assessPlayer(campaign(), 'p1', STATS)).toEqual({
      military: { units: 2, totalHp: 17, totalDamage: 5 },
      economy: {
        stockpile: { food: 60, wood: 45, stone: 30, gold: 25 },
        buildings: { 'town-center': 1, house: 2, storage: 1, barracks: 0, wall: 0, tower: 0 },
        cityLevel: 2,
      },
      commanders: {
        count: 2,
        active: 1,
        avgEffective: {
          aggression: 37.5,
          defense: 70,
          economy: 60,
          exploration: 45,
          risk: 32.5,
          expansion: 45,
          diplomacy: 50,
          patience: 75,
          greed: 45,
          adaptability: 55,
        },
      },
    });
  });

  it('sparse holder: own unit counted, absent slots fail soft, no commanders honest', () => {
    expect(assessPlayer(campaign(), 'p2', STATS)).toEqual({
      military: { units: 1, totalHp: 8, totalDamage: 3 },
      economy: {
        stockpile: { food: 0, wood: 0, stone: 0, gold: 0 },
        buildings: { 'town-center': 0, house: 0, storage: 0, barracks: 0, wall: 0, tower: 0 },
        cityLevel: 1,
      },
      commanders: { count: 0, active: 0, avgEffective: undefined },
    });
  });
});

describe('fail-soft edges', () => {
  it('unknown unit type counts hp but zero damage', () => {
    const state = {
      players: ['p1', 'p2'],
      units: {
        schemaVersion: 1,
        nextId: 1,
        units: [{ id: 'u0', owner: 'p1', type: 'xx', hp: 7, col: 0, row: 0 }],
      },
    } as unknown as WorldState;
    expect(assessPlayer(state, 'p1', STATS).military).toEqual({
      units: 1,
      totalHp: 7,
      totalDamage: 0,
    });
  });

  it('bare state resolves everything (zeros, virtual city, no commanders)', () => {
    const state = createWorldState({ players: [P1, P2] });
    expect(assessPlayer(state, 'p1', STATS)).toEqual({
      military: { units: 0, totalHp: 0, totalDamage: 0 },
      economy: {
        stockpile: { food: 0, wood: 0, stone: 0, gold: 0 },
        buildings: { 'town-center': 0, house: 0, storage: 0, barracks: 0, wall: 0, tower: 0 },
        cityLevel: 1,
      },
      commanders: { count: 0, active: 0, avgEffective: undefined },
    });
  });
});

describe('average bounds battery', () => {
  it('average over 11 mixed commanders stays finite inside 0–100', () => {
    const state = createWorldState({
      players: [P1, P2],
      commanders: {
        schemaVersion: 1,
        nextId: 11,
        commanders: [
          { id: 'c0', owner: 'p1', active: true, personality: 'conqueror' },
          { id: 'c1', owner: 'p1', active: true, personality: 'strategist' },
          { id: 'c2', owner: 'p1', active: false, personality: 'defender' },
          { id: 'c3', owner: 'p1', active: true, personality: 'manipulator' },
          { id: 'c4', owner: 'p1', active: true, personality: 'emperor' },
          { id: 'c5', owner: 'p1', active: true, doctrine: 'blitz' },
          { id: 'c6', owner: 'p1', active: false, doctrine: 'turtle' },
          { id: 'c7', owner: 'p1', active: true, doctrine: 'economic-empire' },
          { id: 'c8', owner: 'p1', active: true, doctrine: 'guerrilla' },
          { id: 'c9', owner: 'p1', active: true, doctrine: 'siege-master' },
          { id: 'c10', owner: 'p1', active: true, doctrine: 'counterstrike' },
        ],
      },
    });
    const command = assessPlayer(state, 'p1', STATS).commanders;
    expect(command.count).toBe(11);
    expect(command.active).toBe(9);
    expect(command.avgEffective).toBeDefined();
    for (const value of Object.values(command.avgEffective ?? {})) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe('purity', () => {
  it('result is a fresh copy (mutating it never affects later calls)', () => {
    const state = campaign();
    const first = assessPlayer(state, 'p1', STATS);
    (first as unknown as { military: { totalHp: number } }).military.totalHp = 0;
    (
      first as unknown as { commanders: { avgEffective: Record<string, number> } }
    ).commanders.avgEffective.aggression = 0;
    const second = assessPlayer(state, 'p1', STATS);
    expect(second.military.totalHp).toBe(17);
    expect(second.commanders.avgEffective?.aggression).toBe(37.5);
  });

  it('input state is never mutated', () => {
    const state = campaign();
    const before = JSON.stringify(state);
    assessPlayer(state, 'p1', STATS);
    assessPlayer(state, 'p2', STATS);
    expect(JSON.stringify(state)).toBe(before);
  });
});
