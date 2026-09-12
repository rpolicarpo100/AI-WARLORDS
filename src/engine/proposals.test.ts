/**
 * M057 — Commander proposal data tests: closed kind vocabulary,
 * kind-switched payloads, mirror agreement (orders + stance +
 * directives), total guards. Data-first: no transitions, no readers
 * until M058.
 */
import { describe, expect, it } from 'vitest';
import { ORDER_IDS } from './orders.js';
import { AUTONOMY_LEVELS } from './directives.js';
import { isCommanderProposal, isProposalKind, PROPOSAL_KINDS } from './proposals.js';
import { STANCE_IDS } from './stance.js';

describe('PROPOSAL_KINDS (suggestion vocabulary)', () => {
  it('locks the three kinds, alphabetical', () => {
    expect([...PROPOSAL_KINDS]).toEqual(['autonomy', 'order', 'stance']);
  });

  it.each([...PROPOSAL_KINDS])('accepts kind %s', (kind) => {
    expect(isProposalKind(kind)).toBe(true);
  });

  it('rejects lookalikes and non-strings', () => {
    for (const bad of ['ORDER', 'order ', ' stance', '', 7, null, undefined, [], {}]) {
      expect(isProposalKind(bad)).toBe(false);
    }
  });
});

describe('isCommanderProposal (total)', () => {
  it('accepts order proposals with and without params (mirror agrees)', () => {
    for (const kind of ORDER_IDS) {
      expect(isCommanderProposal({ kind: 'order', order: { kind } })).toBe(true);
    }
    expect(
      isCommanderProposal({
        kind: 'order',
        order: { kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } },
      }),
    ).toBe(true);
  });

  it('accepts every stance id and autonomy level (mirrors agree)', () => {
    for (const stance of STANCE_IDS) {
      expect(isCommanderProposal({ kind: 'stance', stance })).toBe(true);
    }
    for (const autonomy of AUTONOMY_LEVELS) {
      expect(isCommanderProposal({ kind: 'autonomy', autonomy })).toBe(true);
    }
  });

  it('ignores sibling payloads and extras (M015 precedent)', () => {
    expect(
      isCommanderProposal({
        kind: 'order',
        order: { kind: 'unit.move' },
        stance: 'defensive',
        note: 'flank',
      }),
    ).toBe(true);
  });

  it('rejects non-objects and bad kinds', () => {
    for (const bad of [7, 'order', null, [], 'x']) {
      expect(isCommanderProposal(bad)).toBe(false);
    }
    expect(isCommanderProposal({ kind: 'support' })).toBe(false);
    expect(isCommanderProposal({})).toBe(false);
  });

  it('rejects order kinds without a valid order', () => {
    for (const order of [
      undefined,
      7,
      null,
      [],
      { kind: 'city.upgrade' },
      { kind: 'unit.move', params: 7 },
      {
        kind: 'unit.move',
        params: { id: 'u0', p1: 1, p2: 2, p3: 3, p4: 4, p5: 5, p6: 6, p7: 7, p8: 8 },
      },
      { kind: 'unit.move', params: { '': 'u0' } },
      { kind: 'unit.move', params: { id: 'u'.repeat(65) } },
      { kind: 'unit.move', params: { id: Number.POSITIVE_INFINITY } },
      { kind: 'unit.move', params: { id: ['u0'] } },
    ]) {
      expect(isCommanderProposal({ kind: 'order', order })).toBe(false);
    }
  });

  it('rejects stance and autonomy kinds without valid values', () => {
    for (const stance of [undefined, 'turtle', '', 7, null]) {
      expect(isCommanderProposal({ kind: 'stance', stance })).toBe(false);
    }
    for (const autonomy of [undefined, 'auto', '', 7, null]) {
      expect(isCommanderProposal({ kind: 'autonomy', autonomy })).toBe(false);
    }
  });
});
