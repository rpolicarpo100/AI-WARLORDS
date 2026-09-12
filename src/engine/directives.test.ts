/**
 * M055 — Commander directive data tests: closed kind/autonomy
 * vocabularies, stance-mirror agreement with stance.ts, total
 * per-kind guards. Data-first: no transitions, no readers until
 * M056+.
 */
import { describe, expect, it } from 'vitest';
import {
  AUTONOMY_LEVELS,
  DIRECTIVE_KINDS,
  isAutonomyLevel,
  isCommanderDirectives,
  isDirectiveKind,
} from './directives.js';
import { STANCE_IDS } from './stance.js';

describe('directive vocabularies (closed)', () => {
  it('locks the two kinds', () => {
    expect([...DIRECTIVE_KINDS]).toEqual(['autonomy', 'stance']);
  });

  it('locks the three autonomy levels', () => {
    expect([...AUTONOMY_LEVELS]).toEqual(['manual', 'assisted', 'autonomous']);
  });

  it.each([...DIRECTIVE_KINDS])('accepts kind %s', (kind) => {
    expect(isDirectiveKind(kind)).toBe(true);
  });

  it.each([...AUTONOMY_LEVELS])('accepts autonomy %s', (level) => {
    expect(isAutonomyLevel(level)).toBe(true);
  });

  it('rejects lookalikes and non-strings', () => {
    for (const bad of ['AUTO', 'stance ', ' manual', '', 7, null, undefined, [], {}]) {
      expect(isDirectiveKind(bad)).toBe(false);
      expect(isAutonomyLevel(bad)).toBe(false);
    }
  });
});

describe('isCommanderDirectives (total)', () => {
  it('accepts full, partial, and empty sets (absent means unset)', () => {
    expect(isCommanderDirectives({ autonomy: 'manual', stance: 'defensive' })).toBe(true);
    expect(isCommanderDirectives({ autonomy: 'autonomous' })).toBe(true);
    expect(isCommanderDirectives({ stance: 'balanced' })).toBe(true);
    expect(isCommanderDirectives({})).toBe(true);
  });

  it('accepts every stance id (mirror agrees with canonical)', () => {
    for (const stance of STANCE_IDS) {
      expect(isCommanderDirectives({ stance })).toBe(true);
    }
  });

  it('ignores extras (M015 precedent)', () => {
    expect(isCommanderDirectives({ autonomy: 'manual', note: 'hold' })).toBe(true);
  });

  it('rejects non-objects', () => {
    for (const bad of [7, 'manual', null, [], 'x']) {
      expect(isCommanderDirectives(bad)).toBe(false);
    }
  });

  it('rejects bad autonomy values', () => {
    for (const autonomy of ['auto', 'MANUAL', '', 7, null, []]) {
      expect(isCommanderDirectives({ autonomy })).toBe(false);
    }
  });

  it('rejects bad stance values', () => {
    for (const stance of ['turtle', 'DEFENSIVE', '', 7, null, []]) {
      expect(isCommanderDirectives({ stance })).toBe(false);
    }
  });
});
