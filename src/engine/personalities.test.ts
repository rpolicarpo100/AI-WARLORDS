/**
 * M032 — Personality tests: fixed-5 vocabulary, voted DNA presets
 * (exact matrix golden), fresh-copy lookup, canonical-DNA conformance.
 */
import { describe, expect, it } from 'vitest';
import { isDnaTraits } from './dna.js';
import {
  dnaPresetOf,
  isPersonalityId,
  PERSONALITY_DNA_PRESETS,
  PERSONALITY_IDS,
} from './personalities.js';

describe('personality vocabulary', () => {
  it('locks the five ids in master #23 order', () => {
    expect([...PERSONALITY_IDS]).toEqual([
      'conqueror',
      'strategist',
      'defender',
      'manipulator',
      'emperor',
    ]);
  });

  it('isPersonalityId accepts the five, rejects the rest', () => {
    for (const id of PERSONALITY_IDS) {
      expect(isPersonalityId(id)).toBe(true);
    }
    for (const bad of ['CONQUEROR', 'turtle', '', 7, null, undefined, {}, []]) {
      expect(isPersonalityId(bad)).toBe(false);
    }
  });
});

describe('DNA presets (voted matrix 2026-09-11)', () => {
  it('golden: exact 5×10 matrix (trait order: aggr/def/econ/expl/risk/expa/dipl/pati/greed/adap)', () => {
    expect(PERSONALITY_DNA_PRESETS).toEqual({
      conqueror: {
        aggression: 80,
        defense: 40,
        economy: 40,
        exploration: 50,
        risk: 75,
        expansion: 70,
        diplomacy: 20,
        patience: 30,
        greed: 60,
        adaptability: 50,
      },
      strategist: {
        aggression: 45,
        defense: 60,
        economy: 60,
        exploration: 55,
        risk: 35,
        expansion: 50,
        diplomacy: 50,
        patience: 80,
        greed: 40,
        adaptability: 70,
      },
      defender: {
        aggression: 25,
        defense: 85,
        economy: 75,
        exploration: 30,
        risk: 20,
        expansion: 35,
        diplomacy: 55,
        patience: 85,
        greed: 45,
        adaptability: 40,
      },
      manipulator: {
        aggression: 40,
        defense: 45,
        economy: 65,
        exploration: 60,
        risk: 65,
        expansion: 55,
        diplomacy: 85,
        patience: 60,
        greed: 75,
        adaptability: 80,
      },
      emperor: {
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
      },
    });
  });

  it('every preset satisfies the canonical DNA guard (shape-conformance proof)', () => {
    for (const id of PERSONALITY_IDS) {
      expect(isDnaTraits(PERSONALITY_DNA_PRESETS[id as keyof typeof PERSONALITY_DNA_PRESETS])).toBe(
        true,
      );
    }
  });

  it('presets are frozen (canonical, never mutated)', () => {
    expect(Object.isFrozen(PERSONALITY_DNA_PRESETS)).toBe(true);
    for (const id of PERSONALITY_IDS) {
      expect(
        Object.isFrozen(PERSONALITY_DNA_PRESETS[id as keyof typeof PERSONALITY_DNA_PRESETS]),
      ).toBe(true);
    }
  });
});

describe('dnaPresetOf (lookup)', () => {
  it('returns a fresh copy (mutating results never touches canonical)', () => {
    const first = dnaPresetOf('conqueror');
    expect(first?.aggression).toBe(80);
    expect(first).not.toBe(PERSONALITY_DNA_PRESETS.conqueror);
    if (first !== undefined) {
      (first as unknown as Record<string, number>).aggression = 0;
    }
    expect(dnaPresetOf('conqueror')?.aggression).toBe(80);
    expect(PERSONALITY_DNA_PRESETS.conqueror.aggression).toBe(80);
  });

  it('unknown ids stay undefined (fail-soft lookup)', () => {
    expect(dnaPresetOf('turtle' as never)).toBeUndefined();
  });
});
