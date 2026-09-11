/**
 * M034 — Personality Tests: transversal block suite (M031 DNA × M032
 * personality × M033 doctrine composed in one Match, plus determinism).
 * Complements the per-leaf suites; proves the personality block as a whole.
 */
import { describe, expect, it } from 'vitest';
import { markUntrusted, type ClientRequest, type PlayerId, type Untrusted } from './authority.js';
import {
  ACTIVATE_TRANSITION,
  COMMISSION_TRANSITION,
  DEACTIVATE_TRANSITION,
} from './commander-state.js';
import type { CommanderDna } from './commanders.js';
import { isDnaTraits } from './dna.js';
import { isDoctrineId } from './doctrines.js';
import { Match, STANDARD_RULESET } from './match.js';
import { isPersonalityId } from './personalities.js';
import { perceive } from './views.js';
import { createWorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

const C0_DNA: CommanderDna = {
  aggression: 50,
  defense: 50,
  economy: 50,
  exploration: 50,
  risk: 50,
  expansion: 50,
  diplomacy: 50,
  patience: 50,
  greed: 50,
  adaptability: 50,
};
const C1_DNA: CommanderDna = {
  aggression: 60,
  defense: 61,
  economy: 62,
  exploration: 63,
  risk: 64,
  expansion: 65,
  diplomacy: 66,
  patience: 67,
  greed: 68,
  adaptability: 69,
};

/** Simulates untrusted wire bytes: unknown input, marked at the boundary. */
function raw(value: unknown): Untrusted<ClientRequest> {
  return markUntrusted(value as ClientRequest);
}

function campaign(): Match {
  return new Match({
    seed: 34,
    ruleset: STANDARD_RULESET,
    players: [P1, P2],
    initialState: createWorldState({
      players: [P1, P2],
      commanders: {
        schemaVersion: 1,
        nextId: 2,
        commanders: [
          {
            id: 'c0',
            owner: 'p1',
            active: true,
            dna: C0_DNA,
            personality: 'strategist',
            doctrine: 'turtle',
          },
          {
            id: 'c1',
            owner: 'p2',
            active: true,
            dna: C1_DNA,
            personality: 'conqueror',
            doctrine: 'blitz',
          },
        ],
      },
    }),
  });
}

function order(match: Match, rid: string, player: PlayerId, type: string, params: unknown) {
  return match.dispatch(
    match.join(player),
    raw({ requestId: rid, playerId: player, type, payload: params }),
  );
}

describe('personality arc journey (real Match)', () => {
  it('commission ×2 → flips ×4: triples intact, minted bare, events + perception exact', () => {
    const match = campaign();
    expect(order(match, 'r1', P1, COMMISSION_TRANSITION, {})).toMatchObject({
      status: 'applied',
      summary: 'commissioned c2',
    });
    expect(order(match, 'r2', P2, COMMISSION_TRANSITION, {})).toMatchObject({
      status: 'applied',
      summary: 'commissioned c3',
    });
    expect(order(match, 'r3', P1, DEACTIVATE_TRANSITION, { id: 'c2' })).toMatchObject({
      status: 'applied',
      summary: 'deactivated c2',
    });
    expect(order(match, 'r4', P1, ACTIVATE_TRANSITION, { id: 'c2' })).toMatchObject({
      status: 'applied',
      summary: 'activated c2',
    });
    expect(order(match, 'r5', P2, DEACTIVATE_TRANSITION, { id: 'c1' })).toMatchObject({
      status: 'applied',
      summary: 'deactivated c1',
    });
    expect(order(match, 'r6', P2, ACTIVATE_TRANSITION, { id: 'c1' })).toMatchObject({
      status: 'applied',
      summary: 'activated c1',
    });
    expect(match.getRevision()).toBe(6);
    const snapshot = match.getSnapshot();
    expect(snapshot.commanders).toEqual({
      schemaVersion: 1,
      nextId: 4,
      commanders: [
        {
          id: 'c0',
          owner: 'p1',
          active: true,
          dna: C0_DNA,
          personality: 'strategist',
          doctrine: 'turtle',
        },
        {
          id: 'c1',
          owner: 'p2',
          active: true,
          dna: C1_DNA,
          personality: 'conqueror',
          doctrine: 'blitz',
        },
        { id: 'c2', owner: 'p1', active: true },
        { id: 'c3', owner: 'p2', active: true },
      ],
    });
    expect(
      match
        .getEvents()
        .map((e) => e.type)
        .filter((t) => t.startsWith('commander.')),
    ).toEqual([
      'commander.commissioned',
      'commander.commissioned',
      'commander.deactivated',
      'commander.activated',
      'commander.deactivated',
      'commander.activated',
    ]);
    expect(match.getEvents().filter((e) => e.type === 'commander.commissioned')).toEqual([
      expect.objectContaining({ payload: { player: 'p1', commander: 'c2' } }),
      expect.objectContaining({ payload: { player: 'p2', commander: 'c3' } }),
    ]);
    // Perception: own commanders flow whole, foe commanders stay out (M027/M031).
    expect(perceive(snapshot, P1).commanders).toEqual([
      {
        id: 'c0',
        owner: 'p1',
        active: true,
        dna: C0_DNA,
        personality: 'strategist',
        doctrine: 'turtle',
      },
      { id: 'c2', owner: 'p1', active: true },
    ]);
    expect(perceive(snapshot, P2).commanders).toEqual([
      {
        id: 'c1',
        owner: 'p2',
        active: true,
        dna: C1_DNA,
        personality: 'conqueror',
        doctrine: 'blitz',
      },
      { id: 'c3', owner: 'p2', active: true },
    ]);
    // Canonical leaves agree on the live triples (runtime cross-check).
    for (const record of snapshot.commanders?.commanders ?? []) {
      if (record.id === 'c0' || record.id === 'c1') {
        expect(isDnaTraits(record.dna)).toBe(true);
        expect(isPersonalityId(record.personality)).toBe(true);
        expect(isDoctrineId(record.doctrine)).toBe(true);
      }
    }
  });
});

describe('personality determinism (twin Matches)', () => {
  it('same seed + same script incl. commissions + flips: identical snapshot and events', () => {
    const script: Array<[PlayerId, string, unknown]> = [
      [P1, COMMISSION_TRANSITION, {}],
      [P2, COMMISSION_TRANSITION, {}],
      [P1, DEACTIVATE_TRANSITION, { id: 'c2' }],
      [P1, ACTIVATE_TRANSITION, { id: 'c2' }],
      [P2, DEACTIVATE_TRANSITION, { id: 'c1' }],
      [P2, ACTIVATE_TRANSITION, { id: 'c1' }],
    ];
    const run = (): { snapshot: unknown; events: unknown } => {
      const match = campaign();
      script.forEach(([player, type, params], index) => {
        const result = order(match, `r${index + 1}`, player, type, params);
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
