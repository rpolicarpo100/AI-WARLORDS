/**
 * M031 — DNA tests: canonical vocabulary + bounds + total guard.
 * The commanders.ts mirror is cross-checked in commanders.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { DNA_MAX, DNA_MIN, isDnaTraitId, isDnaTraits, TRAIT_IDS, type DnaTraits } from './dna.js';

function full(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    aggression: 60,
    defense: 50,
    economy: 50,
    exploration: 40,
    risk: 30,
    expansion: 55,
    diplomacy: 45,
    patience: 70,
    greed: 20,
    adaptability: 65,
    ...overrides,
  };
}

describe('DNA vocabulary', () => {
  it('locks the ten trait ids in master #22 order', () => {
    expect([...TRAIT_IDS]).toEqual([
      'aggression',
      'defense',
      'economy',
      'exploration',
      'risk',
      'expansion',
      'diplomacy',
      'patience',
      'greed',
      'adaptability',
    ]);
  });

  it('locks the 0–100 integer scale (voted)', () => {
    expect(DNA_MIN).toBe(0);
    expect(DNA_MAX).toBe(100);
  });

  it('isDnaTraitId accepts the ten, rejects the rest', () => {
    for (const trait of TRAIT_IDS) {
      expect(isDnaTraitId(trait)).toBe(true);
    }
    for (const bad of ['AGGRESSION', 'skill', '', 7, null, undefined, {}, []]) {
      expect(isDnaTraitId(bad)).toBe(false);
    }
  });
});

describe('isDnaTraits (guard)', () => {
  it('accepts a complete in-range record (golden)', () => {
    const dna = full();
    expect(isDnaTraits(dna)).toBe(true);
    const typed = dna as unknown as DnaTraits;
    expect(typed.aggression).toBe(60);
    expect(typed.adaptability).toBe(65);
  });

  it('accepts boundary values 0 and 100 on every trait', () => {
    for (const trait of TRAIT_IDS) {
      expect(isDnaTraits(full({ [trait]: 0 }))).toBe(true);
      expect(isDnaTraits(full({ [trait]: 100 }))).toBe(true);
    }
  });

  it.each([-1, 101, 1.5, NaN, '50', null, undefined, {}, []])(
    'rejects out-of-range value %p on every trait',
    (bad) => {
      for (const trait of TRAIT_IDS) {
        expect(isDnaTraits(full({ [trait]: bad }))).toBe(false);
      }
    },
  );

  it('rejects a missing trait', () => {
    const dna = full();
    delete dna['patience'];
    expect(isDnaTraits(dna)).toBe(false);
  });

  it('ignores extra keys (M015 leniency)', () => {
    expect(isDnaTraits(full({ skill: 'elite', name: 'Bastion' }))).toBe(true);
  });

  it.each([null, undefined, 7, 'dna', [], [['aggression', 1]]])('rejects non-object %p', (bad) => {
    expect(isDnaTraits(bad)).toBe(false);
  });
});
