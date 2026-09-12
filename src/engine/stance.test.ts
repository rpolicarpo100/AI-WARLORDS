/**
 * M037 — Stance tests: fixed-5 vocabulary, voted margin pin, goldens
 * (chained + constructed + edges 14/15), 42-combo validity battery.
 */
import { describe, expect, it } from 'vitest';
import type {
  CommanderDna,
  CommanderDoctrine,
  CommanderMemory,
  CommanderPersonality,
  CommanderRecord,
} from './commanders.js';
import { DOCTRINE_IDS } from './doctrines.js';
import { PERSONALITY_IDS } from './personalities.js';
import {
  STANCE_IDS,
  STANCE_MARGIN,
  STANCE_RECALL_CAP,
  STANCE_RECALL_NUDGE,
  isStanceId,
  stanceOf,
  stanceWithRecall,
  type StanceRecollection,
} from './stance.js';

function record(fields: Partial<CommanderRecord> & { id: string }): CommanderRecord {
  return { owner: 'p1', active: true, ...fields };
}

const FIFTIES: CommanderDna = {
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

describe('stance vocabulary', () => {
  it('locks the five ids in voted order', () => {
    expect([...STANCE_IDS]).toEqual([
      'aggressive',
      'defensive',
      'expansionist',
      'diplomatic',
      'balanced',
    ]);
  });

  it('isStanceId accepts the five, rejects the rest', () => {
    for (const id of STANCE_IDS) {
      expect(isStanceId(id)).toBe(true);
    }
    for (const bad of ['AGGRESSIVE', 'conqueror', 'turtle', '', 7, null, undefined, {}, []]) {
      expect(isStanceId(bad)).toBe(false);
    }
  });

  it('locks the voted dominance margin (15)', () => {
    expect(STANCE_MARGIN).toBe(15);
  });
});

describe('goldens (dominant-with-margin)', () => {
  it('conqueror + blitz reads aggressive (100−85 = 15 wins the edge)', () => {
    expect(stanceOf(record({ id: 'c0', personality: 'conqueror', doctrine: 'blitz' }))).toBe(
      'aggressive',
    );
  });

  it('strategist + turtle reads defensive (90−50 = 40)', () => {
    expect(stanceOf(record({ id: 'c0', personality: 'strategist', doctrine: 'turtle' }))).toBe(
      'defensive',
    );
  });

  it('constructed expansionist (expansion 90 clears 50s by 40)', () => {
    expect(stanceOf(record({ id: 'c0', dna: { ...FIFTIES, expansion: 90 } }))).toBe('expansionist');
  });

  it('constructed diplomatic (diplomacy 90 clears 50s by 40)', () => {
    expect(stanceOf(record({ id: 'c0', dna: { ...FIFTIES, diplomacy: 90 } }))).toBe('diplomatic');
  });

  it('bare record reads balanced (no dominance)', () => {
    expect(stanceOf(record({ id: 'c7' }))).toBe('balanced');
  });

  it('edge below: 64−50 = 14 stays balanced', () => {
    expect(stanceOf(record({ id: 'c0', dna: { ...FIFTIES, aggression: 64 } }))).toBe('balanced');
  });

  it('edge at: 65−50 = 15 turns aggressive', () => {
    expect(stanceOf(record({ id: 'c0', dna: { ...FIFTIES, aggression: 65 } }))).toBe('aggressive');
  });
});

describe('validity battery', () => {
  it('every stance reads a valid id (6 × 7 personalities/doctrines + 3 edges)', () => {
    const personalities: Array<CommanderPersonality | undefined> = [
      undefined,
      ...(PERSONALITY_IDS as readonly CommanderPersonality[]),
    ];
    const doctrines: Array<CommanderDoctrine | undefined> = [
      undefined,
      ...(DOCTRINE_IDS as readonly CommanderDoctrine[]),
    ];
    let combos = 0;
    for (const personality of personalities) {
      for (const doctrine of doctrines) {
        combos += 1;
        const stance = stanceOf(
          record({
            id: `c${combos}`,
            ...(personality === undefined ? {} : { personality }),
            ...(doctrine === undefined ? {} : { doctrine }),
          }),
        );
        expect(isStanceId(stance)).toBe(true);
      }
    }
    expect(combos).toBe(42);
    expect(isStanceId(stanceOf(record({ id: 'bare' })))).toBe(true);
    expect(isStanceId(stanceOf(record({ id: 'd0', dna: FIFTIES })))).toBe(true);
    expect(
      isStanceId(
        stanceOf(record({ id: 'd1', dna: { ...FIFTIES, aggression: 100, defense: 100 } })),
      ),
    ).toBe(true);
  });
});

describe('stanceWithRecall (M054 experience nudge)', () => {
  function fresh(kinds: ReadonlyArray<CommanderMemory['kind']>): StanceRecollection {
    return {
      fresh: kinds.map((kind, seq) => ({ seq, revision: 1, kind, subject: 'c0' })),
      stale: [],
    };
  }

  it('reads stanceOf exactly when nothing steers (empty, neutral, stale)', () => {
    const veteran = record({ id: 'c0', dna: { ...FIFTIES, aggression: 60 } });
    expect(stanceOf(veteran)).toBe('balanced');
    expect(stanceWithRecall(veteran, fresh([]))).toBe('balanced');
    expect(stanceWithRecall(veteran, fresh(['order.executed', 'unit.spotted']))).toBe('balanced');
    const haunted: StanceRecollection = {
      fresh: [],
      stale: [
        { seq: 0, revision: 1, kind: 'order.canceled', subject: 'c0' },
        { seq: 1, revision: 1, kind: 'order.canceled', subject: 'c0' },
      ],
    };
    expect(stanceWithRecall(veteran, haunted)).toBe('balanced');
  });

  it('emboldens from recalled battles (attacked + slain count)', () => {
    const veteran = record({ id: 'c0', dna: { ...FIFTIES, aggression: 60 } });
    expect(stanceWithRecall(veteran, fresh(['unit.attacked', 'unit.attacked']))).toBe('aggressive');
    expect(stanceWithRecall(veteran, fresh(['unit.slain', 'unit.slain']))).toBe('aggressive');
    // One battle short of the edge (65 − 50 = 15 wins; 60 + 5 = 65).
    expect(stanceWithRecall(veteran, fresh(['unit.attacked']))).toBe('aggressive');
  });

  it('humbles from recalled failures (overridden + canceled count)', () => {
    const veteran = record({ id: 'c0', dna: { ...FIFTIES, defense: 60 } });
    expect(stanceOf(veteran)).toBe('balanced');
    expect(stanceWithRecall(veteran, fresh(['order.overridden', 'order.canceled']))).toBe(
      'defensive',
    );
    expect(stanceWithRecall(veteran, fresh(['order.canceled', 'order.canceled']))).toBe(
      'defensive',
    );
  });

  it('caps each side at two memories (feedback-loop bound)', () => {
    const rookie = record({ id: 'c0', dna: FIFTIES });
    // Three battles nudge +10, not +15 (60 − 50 = 10 stays balanced).
    expect(
      stanceWithRecall(rookie, fresh(['unit.attacked', 'unit.attacked', 'unit.attacked'])),
    ).toBe('balanced');
    expect(
      stanceWithRecall(rookie, fresh(['order.canceled', 'order.canceled', 'order.canceled'])),
    ).toBe('balanced');
  });

  it('counts both sides (mixed battle + failure)', () => {
    const veteran = record({ id: 'c0', dna: { ...FIFTIES, aggression: 60 } });
    // Battle-only would flip (65 − 50 = 15); the failure holds it (65 − 55 = 10).
    expect(stanceWithRecall(veteran, fresh(['unit.attacked', 'order.canceled']))).toBe('balanced');
  });

  it('locks the recall tuning (nudge 5, cap 2)', () => {
    expect(STANCE_RECALL_NUDGE).toBe(5);
    expect(STANCE_RECALL_CAP).toBe(2);
  });

  it('ordered posture beats DNA and recall alike (M056 precedence)', () => {
    const veteran = record({
      id: 'c0',
      dna: { ...FIFTIES, aggression: 100 },
      directives: { stance: 'defensive' },
    });
    expect(stanceOf(veteran)).toBe('aggressive');
    expect(stanceWithRecall(veteran, fresh([]))).toBe('defensive');
    expect(stanceWithRecall(veteran, fresh(['unit.attacked', 'unit.slain', 'unit.attacked']))).toBe(
      'defensive',
    );
  });
});
