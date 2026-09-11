/**
 * M040 — AI assessment events tests: upgrade snapshots (full goldens for
 * both holders), non-upgrade silence, defaults-config, twin determinism,
 * repeat upgrades. First AI→stream channel.
 */
import { describe, expect, it } from 'vitest';
import { markUntrusted, type ClientRequest, type PlayerId, type Untrusted } from './authority.js';
import { Match, STANDARD_RULESET } from './match.js';
import type { UnitsConfig } from './warfare.js';
import { createWorldState } from './world-state.js';
import { COMMISSION_TRANSITION } from './commander-state.js';
import { UPGRADE_TRANSITION } from './economy.js';

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
    seed: 40,
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
        cities: { p1: { level: 1, queue: [] } },
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

function aiFacts(match: Match): unknown[] {
  return match.getEvents().filter((e) => e.type === 'ai.assessment');
}

describe('upgrade snapshots (goldens)', () => {
  it('one upgrade emits two low-priority snapshots (players order) with full payloads', () => {
    const match = campaign(drillUnits());
    expect(aiFacts(match)).toEqual([]);
    expect(order(match, 'r1', P1, UPGRADE_TRANSITION, {})).toMatchObject({
      status: 'applied',
      summary: 'upgraded to level 2',
    });
    const facts = aiFacts(match);
    expect(facts.length).toBe(2);
    expect(facts[0]).toMatchObject({
      type: 'ai.assessment',
      priority: 'low',
      payload: {
        player: 'p1',
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
          stances: [
            { id: 'c0', stance: 'defensive' },
            { id: 'c1', stance: 'balanced' },
          ],
        },
      },
    });
    expect(facts[1]).toMatchObject({
      type: 'ai.assessment',
      priority: 'low',
      payload: {
        player: 'p2',
        military: { units: 1, totalHp: 8, totalDamage: 3 },
        economy: {
          stockpile: { food: 0, wood: 0, stone: 0, gold: 0 },
          buildings: { 'town-center': 0, house: 0, storage: 0, barracks: 0, wall: 0, tower: 0 },
          cityLevel: 1,
        },
        commanders: { count: 0, active: 0, stances: [] },
      },
    });
    // Exact: the key is OMITTED (never undefined — freezeState forbids it).
    const p2commanders = (facts[1] as { payload: { commanders: unknown } }).payload.commanders;
    expect(p2commanders).toEqual({ count: 0, active: 0, stances: [] });
  });

  it('repeat upgrade (2→3) snapshots again with the new level', () => {
    const match = campaign(drillUnits());
    expect(order(match, 'r1', P1, UPGRADE_TRANSITION, {})).toMatchObject({ status: 'applied' });
    expect(order(match, 'r2', P1, UPGRADE_TRANSITION, {})).toMatchObject({
      status: 'applied',
      summary: 'upgraded to level 3',
    });
    const facts = aiFacts(match);
    expect(facts.length).toBe(4);
    expect(facts[2]).toMatchObject({ payload: { player: 'p1', economy: { cityLevel: 3 } } });
    expect(facts[3]).toMatchObject({ payload: { player: 'p2', economy: { cityLevel: 1 } } });
  });
});

describe('channel discipline', () => {
  it('non-upgrade dispatches stay silent (noop, commission)', () => {
    const match = campaign(drillUnits());
    expect(order(match, 'r1', P1, 'world.noop', {})).toMatchObject({ status: 'applied' });
    expect(order(match, 'r2', P1, COMMISSION_TRANSITION, {})).toMatchObject({ status: 'applied' });
    expect(aiFacts(match)).toEqual([]);
  });

  it('default units config wires neutral damage into facts', () => {
    const match = campaign();
    expect(order(match, 'r1', P1, UPGRADE_TRANSITION, {})).toMatchObject({ status: 'applied' });
    const facts = aiFacts(match);
    expect(facts.length).toBe(2);
    expect(facts[0]).toMatchObject({ payload: { player: 'p1', military: { totalDamage: 0 } } });
    expect(facts[1]).toMatchObject({ payload: { player: 'p2', military: { totalDamage: 0 } } });
  });

  it('twin matches emit identical snapshots (deterministic channel)', () => {
    const run = (): unknown => {
      const match = campaign(drillUnits());
      const result = order(match, 'r1', P1, UPGRADE_TRANSITION, {});
      if (result.status !== 'applied') {
        throw new Error('TEST BUG: upgrade not applied');
      }
      return match.getEvents();
    };
    expect(run()).toEqual(run());
  });
});
