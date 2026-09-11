/**
 * M042 — Strategy transversal suite: the full M035–M040 AI chain pinned
 * end-to-end through live Matches (journey + twin determinism). Closes
 * the Strategic AI block (D-036). Zero production code.
 */
import { describe, expect, it } from 'vitest';
import { markUntrusted, type ClientRequest, type PlayerId, type Untrusted } from './authority.js';
import type { CommanderRecord } from './commanders.js';
import type { DnaTraits } from './dna.js';
import { effectiveDnaOf } from './effective-dna.js';
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

/** Match-assessment mold (M038): p1 city L2, c0 triple + c1 bare, p2 commanderless. */
function campaign(): Match {
  return new Match({
    seed: 42,
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
    unitsConfig: drillUnits(),
  });
}

function order(match: Match, rid: string, player: PlayerId, type: string, params: unknown) {
  return match.dispatch(
    match.join(player),
    raw({ requestId: rid, playerId: player, type, payload: params }),
  );
}

function rosterOf(match: Match): ReadonlyArray<CommanderRecord> {
  return match.getSnapshot().commanders?.commanders ?? [];
}

describe('strategy transversal (M035–M040 chain, live)', () => {
  it('journey: commission → flip → upgrade composes the whole AI arc', () => {
    const match = campaign();
    const before = match.assessmentOf('p1');
    expect(before.military).toEqual({ units: 2, totalHp: 17, totalDamage: 5 });
    expect(before.commanders.count).toBe(2);
    expect(before.commanders.active).toBe(1);
    expect(before.commanders.avgEffective).toBeDefined();

    // 1. Commission mints bare c2 at the roster end (M029); the chain
    // picks it up: counts move and the average becomes the exact mean
    // of the three effective vectors (M035 composer is the oracle).
    const c0 = rosterOf(match)[0]!;
    const c0eff = effectiveDnaOf(c0);
    expect(order(match, 't1', P1, 'commander.commission', {})).toMatchObject({ status: 'applied' });
    expect(rosterOf(match).map((r) => r.id)).toEqual(['c0', 'c1', 'c2']);
    expect(rosterOf(match)[2]).toMatchObject({ owner: 'p1', active: true });
    const factsAfterCommission = match.getEvents();
    expect(factsAfterCommission[factsAfterCommission.length - 1]).toMatchObject({
      type: 'commander.commissioned',
      payload: { player: 'p1', commander: 'c2' },
    });
    const commissioned = match.assessmentOf('p1');
    expect(commissioned.commanders.count).toBe(3);
    expect(commissioned.commanders.active).toBe(2);
    const avg = commissioned.commanders.avgEffective!;
    for (const trait of Object.keys(c0eff) as (keyof DnaTraits)[]) {
      expect(avg[trait]).toBeCloseTo((c0eff[trait] + 50 + 50) / 3, 10);
    }

    // 2. Deactivating c0 moves activity only: the average still covers
    // the whole roster (M036 semantics, pinned through the live chain).
    expect(order(match, 't2', P1, 'commander.deactivate', { id: 'c0' })).toMatchObject({
      status: 'applied',
    });
    const factsAfterFlip = match.getEvents();
    expect(factsAfterFlip[factsAfterFlip.length - 1]).toMatchObject({
      type: 'commander.deactivated',
      payload: { player: 'p1', commander: 'c0' },
    });
    const flipped = match.assessmentOf('p1');
    expect(flipped.commanders.count).toBe(3);
    expect(flipped.commanders.active).toBe(1);
    expect(flipped.commanders.avgEffective).toEqual(avg);
    expect(match.stancesOf('p1').map((s) => s.id)).toEqual(['c0', 'c1', 'c2']);
    const posture = match.postureOf('p1');
    expect(Object.values(posture.distribution).reduce((a, b) => a + b, 0)).toBe(3);

    // 3. The free L2→L3 upgrade emits EXACTLY two facts (no structural
    // city fact rides along — producers map, M040), and both mirror
    // the live queries; commanderless p2 stays honest (key omitted).
    const eventsBefore = match.getEvents().length;
    expect(order(match, 't3', P1, 'city.upgrade', {})).toMatchObject({ status: 'applied' });
    const fresh = match.getEvents().slice(eventsBefore);
    expect(fresh.map((e) => e.type)).toEqual(['ai.assessment', 'ai.assessment']);
    const live = match.assessmentOf('p1');
    expect(live.economy.cityLevel).toBe(3);
    expect(fresh[0]).toMatchObject({ priority: 'low' });
    expect(fresh[0]!.payload).toEqual({
      player: 'p1',
      military: live.military,
      economy: live.economy,
      commanders: {
        count: 3,
        active: 1,
        avgEffective: live.commanders.avgEffective,
        stances: match.stancesOf('p1'),
      },
    });
    const p2 = match.assessmentOf('p2');
    expect(fresh[1]!.payload).toEqual({
      player: 'p2',
      military: { units: 1, totalHp: 8, totalDamage: 3 },
      economy: p2.economy,
      commanders: { count: 0, active: 0, stances: [] },
    });
    expect(fresh[1]!.payload).not.toHaveProperty('commanders.avgEffective');

    // 4. The whole arc, in order (past the leading match.started).
    expect(
      match
        .getEvents()
        .slice(1)
        .map((e) => e.type),
    ).toEqual([
      'commander.commissioned',
      'commander.deactivated',
      'ai.assessment',
      'ai.assessment',
    ]);
  });

  it('twin Matches replay the arc bit-identically (snapshot + events + queries)', () => {
    const script: ReadonlyArray<readonly [string, PlayerId, string, unknown]> = [
      ['u1', P1, 'commander.commission', {}],
      ['u2', P1, 'commander.deactivate', { id: 'c0' }],
      ['u3', P1, 'city.upgrade', {}],
    ];
    const run = (): Match => {
      const match = campaign();
      for (const [rid, player, type, params] of script) {
        expect(order(match, rid, player, type, params)).toMatchObject({ status: 'applied' });
      }
      return match;
    };
    const a = run();
    const b = run();
    expect(a.getSnapshot()).toEqual(b.getSnapshot());
    expect(a.getEvents()).toEqual(b.getEvents());
    for (const holder of ['p1', 'p2'] as const) {
      expect(a.assessmentOf(holder)).toEqual(b.assessmentOf(holder));
      expect(a.stancesOf(holder)).toEqual(b.stancesOf(holder));
      expect(a.postureOf(holder)).toEqual(b.postureOf(holder));
    }
  });
});
