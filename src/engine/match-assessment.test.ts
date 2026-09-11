/**
 * M038 — Match assessment wiring tests: live assessmentOf/stancesOf
 * queries over a real Match (journey + defaults-config + unknown
 * holder + freshness). Read-only: queries never mutate the Match.
 */
import { describe, expect, it } from 'vitest';
import { markUntrusted, type ClientRequest, type PlayerId, type Untrusted } from './authority.js';
import { COMMISSION_TRANSITION } from './commander-state.js';
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

/** Simulates untrusted wire bytes: unknown input, marked at the boundary. */
function raw(value: unknown): Untrusted<ClientRequest> {
  return markUntrusted(value as ClientRequest);
}

function campaign(unitsConfig?: UnitsConfig): Match {
  return new Match({
    seed: 38,
    ruleset: STANDARD_RULESET,
    players: [P1, P2],
    initialState: createWorldState({
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
        buildings: {
          p1: { 'town-center': 1, house: 2, storage: 1, barracks: 0, wall: 0, tower: 0 },
        },
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
    }),
    ...(unitsConfig === undefined ? {} : { unitsConfig }),
  });
}

function order(match: Match, rid: string, player: PlayerId, type: string, params: unknown) {
  return match.dispatch(
    match.join(player),
    raw({ requestId: rid, playerId: player, type, payload: params }),
  );
}

describe('assessmentOf (live query)', () => {
  it('reads the live snapshot: full golden, then commission updates counts + average exactly', () => {
    const match = campaign(drillUnits());
    expect(match.assessmentOf('p1')).toEqual({
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
    expect(order(match, 'r1', P1, COMMISSION_TRANSITION, {})).toMatchObject({
      status: 'applied',
      summary: 'commissioned c2',
    });
    // Average over three: (strategist+turtle effective + 50s + 50s) / 3 — fractions exact.
    expect(match.assessmentOf('p1').commanders).toEqual({
      count: 3,
      active: 2,
      avgEffective: {
        aggression: 125 / 3,
        defense: 190 / 3,
        economy: 170 / 3,
        exploration: 140 / 3,
        risk: 115 / 3,
        expansion: 140 / 3,
        diplomacy: 150 / 3,
        patience: 200 / 3,
        greed: 140 / 3,
        adaptability: 160 / 3,
      },
    });
    expect(match.assessmentOf('p1').military).toEqual({ units: 2, totalHp: 17, totalDamage: 5 });
  });

  it('unknown holder resolves fail-soft (zeros, virtual city, no commanders)', () => {
    const match = campaign(drillUnits());
    expect(match.assessmentOf('px')).toEqual({
      military: { units: 0, totalHp: 0, totalDamage: 0 },
      economy: {
        stockpile: { food: 0, wood: 0, stone: 0, gold: 0 },
        buildings: { 'town-center': 0, house: 0, storage: 0, barracks: 0, wall: 0, tower: 0 },
        cityLevel: 1,
      },
      commanders: { count: 0, active: 0, avgEffective: undefined },
    });
  });

  it('default units config wires neutral damage (0) with live hp sums', () => {
    const match = campaign();
    expect(match.assessmentOf('p1').military).toEqual({ units: 2, totalHp: 17, totalDamage: 0 });
    expect(match.assessmentOf('p2').military).toEqual({ units: 1, totalHp: 8, totalDamage: 0 });
  });
});

describe('stancesOf (live query)', () => {
  it('reads per-commander stances in roster order; commissions append; unknown holder empty', () => {
    const match = campaign(drillUnits());
    expect(match.stancesOf('p1')).toEqual([
      { id: 'c0', stance: 'defensive' },
      { id: 'c1', stance: 'balanced' },
    ]);
    expect(match.stancesOf('p2')).toEqual([]);
    expect(match.stancesOf('px')).toEqual([]);
    expect(order(match, 'r1', P1, COMMISSION_TRANSITION, {})).toMatchObject({ status: 'applied' });
    expect(match.stancesOf('p1')).toEqual([
      { id: 'c0', stance: 'defensive' },
      { id: 'c1', stance: 'balanced' },
      { id: 'c2', stance: 'balanced' },
    ]);
  });
});

describe('query purity', () => {
  it('queries return fresh copies (mutating results never touches the Match)', () => {
    const match = campaign(drillUnits());
    const first = match.assessmentOf('p1');
    (first as unknown as { military: { totalHp: number } }).military.totalHp = 0;
    const stancesFirst = match.stancesOf('p1');
    expect(match.stancesOf('p1')).not.toBe(stancesFirst);
    (stancesFirst as unknown as Array<{ stance: string }>)[0]!.stance = 'xx';
    expect(match.assessmentOf('p1').military.totalHp).toBe(17);
    expect(match.stancesOf('p1')).toEqual([
      { id: 'c0', stance: 'defensive' },
      { id: 'c1', stance: 'balanced' },
    ]);
  });
});
