/**
 * M046 — Refutation records data tests: closed reason vocabulary, total
 * reason/refutation guards, kind-mirror agreement with orders.ts, bounds.
 * Data-first: no transitions, no events, no readers until M047+.
 */
import { describe, expect, it } from 'vitest';
import { ORDER_IDS } from './orders.js';
import {
  isCommanderRefutation,
  isRefutationReason,
  MAX_REFUTATION_BY_CHARS,
  REFUTATION_REASONS,
} from './refutations.js';

const VALID = { orderIndex: 0, kind: 'unit.move', reason: 'blocked', by: 'c1' };

describe('REFUTATION_REASONS (challenge vocabulary)', () => {
  it('locks the five reasons, alphabetical', () => {
    expect([...REFUTATION_REASONS]).toEqual([
      'blocked',
      'out-of-range',
      'redundant',
      'suicidal',
      'unaffordable',
    ]);
  });
});

describe('isRefutationReason (total)', () => {
  it.each([...REFUTATION_REASONS])('accepts reason %s', (reason) => {
    expect(isRefutationReason(reason)).toBe(true);
  });

  it('rejects lookalikes and non-strings', () => {
    for (const bad of ['BLOCKED', 'blocked ', ' suicidal', '', 7, null, undefined, [], {}]) {
      expect(isRefutationReason(bad)).toBe(false);
    }
  });
});

describe('isCommanderRefutation (total)', () => {
  it('accepts a head challenge with every reason', () => {
    for (const reason of REFUTATION_REASONS) {
      expect(isCommanderRefutation({ ...VALID, reason })).toBe(true);
    }
  });

  it('accepts every orderable kind (mirror agrees with canonical)', () => {
    for (const kind of ORDER_IDS) {
      expect(isCommanderRefutation({ ...VALID, kind })).toBe(true);
    }
  });

  it('ignores extras (M015 precedent)', () => {
    expect(isCommanderRefutation({ ...VALID, note: 'scouted', depth: 2 })).toBe(true);
  });

  it('rejects non-objects', () => {
    for (const bad of [7, 'unit.move', null, [], 'x']) {
      expect(isCommanderRefutation(bad)).toBe(false);
    }
  });

  it('rejects missing fields', () => {
    for (const key of ['orderIndex', 'kind', 'reason', 'by'] as const) {
      const rest = Object.fromEntries(Object.entries(VALID).filter(([k]) => k !== key));
      expect(isCommanderRefutation(rest)).toBe(false);
    }
  });

  it('rejects bad queue indexes', () => {
    for (const orderIndex of [-1, 1.5, Number.NaN, 0x100000000, '0', null]) {
      expect(isCommanderRefutation({ ...VALID, orderIndex })).toBe(false);
    }
  });

  it('rejects bad kinds', () => {
    for (const kind of ['city.upgrade', 'UNIT.MOVE', 'unit.move ', '', 7, null]) {
      expect(isCommanderRefutation({ ...VALID, kind })).toBe(false);
    }
  });

  it('rejects bad reasons', () => {
    for (const reason of ['doomed', 'BLOCKED', '', 7, null]) {
      expect(isCommanderRefutation({ ...VALID, reason })).toBe(false);
    }
  });

  it('rejects bad challengers', () => {
    for (const by of ['', 'c'.repeat(65), 7, null, []]) {
      expect(isCommanderRefutation({ ...VALID, by })).toBe(false);
    }
  });

  it('accepts index zero and the uint32 ceiling', () => {
    expect(isCommanderRefutation({ ...VALID, orderIndex: 0 })).toBe(true);
    expect(isCommanderRefutation({ ...VALID, orderIndex: 0xffffffff })).toBe(true);
    expect(isCommanderRefutation({ ...VALID, by: 'c'.repeat(64) })).toBe(true);
  });
});

describe('refutation bounds (exported)', () => {
  it('locks the challenger-id ceiling at 64', () => {
    expect(MAX_REFUTATION_BY_CHARS).toBe(64);
  });
});
