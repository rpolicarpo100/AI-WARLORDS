/**
 * M037 — Stance tests: fixed-5 vocabulary, voted margin pin, goldens
 * (chained + constructed + edges 14/15), 42-combo validity battery.
 */
import { describe, expect, it } from 'vitest';
import type {
  CommanderDna,
  CommanderDoctrine,
  CommanderPersonality,
  CommanderRecord,
} from './commanders.js';
import { DOCTRINE_IDS } from './doctrines.js';
import { PERSONALITY_IDS } from './personalities.js';
import { STANCE_IDS, STANCE_MARGIN, isStanceId, stanceOf } from './stance.js';

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
