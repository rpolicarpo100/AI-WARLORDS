/**
 * M039 — Army posture tests: distribution + majority goldens, voted
 * STANCE_IDS-order tie-break, empty-army honesty, 42-combo battery,
 * fresh-copy.
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
import { postureOf } from './posture.js';
import { isStanceId } from './stance.js';

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

describe('goldens (distribution + majority)', () => {
  it('mixed four: counts exact, balanced pair takes the majority', () => {
    expect(
      postureOf([
        record({ id: 'c0', personality: 'conqueror', doctrine: 'blitz' }),
        record({ id: 'c1', personality: 'strategist', doctrine: 'turtle' }),
        record({ id: 'c2' }),
        record({ id: 'c3' }),
      ]),
    ).toEqual({
      distribution: { aggressive: 1, defensive: 1, expansionist: 0, diplomatic: 0, balanced: 2 },
      majority: 'balanced',
    });
  });

  it('tie-break follows STANCE_IDS order (aggressive > defensive > expansionist)', () => {
    expect(
      postureOf([
        record({ id: 'c0', personality: 'conqueror', doctrine: 'blitz' }),
        record({ id: 'c1', personality: 'strategist', doctrine: 'turtle' }),
      ]).majority,
    ).toBe('aggressive');
    expect(
      postureOf([
        record({ id: 'c0', personality: 'strategist', doctrine: 'turtle' }),
        record({ id: 'c1', dna: { ...FIFTIES, expansion: 90 } }),
      ]).majority,
    ).toBe('defensive');
  });

  it('empty army reads zeros + balanced (no dominance without commanders)', () => {
    expect(postureOf([])).toEqual({
      distribution: { aggressive: 0, defensive: 0, expansionist: 0, diplomatic: 0, balanced: 0 },
      majority: 'balanced',
    });
  });

  it('expansionist beats balanced on the tie (order 2 < order 4)', () => {
    expect(
      postureOf([record({ id: 'c0', dna: { ...FIFTIES, expansion: 90 } }), record({ id: 'c1' })]),
    ).toEqual({
      distribution: { aggressive: 0, defensive: 0, expansionist: 1, diplomatic: 0, balanced: 1 },
      majority: 'expansionist',
    });
  });
});

describe('validity battery', () => {
  it('42-combo army: distribution sums to 42, majority valid, deterministic', () => {
    const personalities: Array<CommanderPersonality | undefined> = [
      undefined,
      ...(PERSONALITY_IDS as readonly CommanderPersonality[]),
    ];
    const doctrines: Array<CommanderDoctrine | undefined> = [
      undefined,
      ...(DOCTRINE_IDS as readonly CommanderDoctrine[]),
    ];
    const army: CommanderRecord[] = [];
    for (const personality of personalities) {
      for (const doctrine of doctrines) {
        army.push(
          record({
            id: `c${army.length}`,
            ...(personality === undefined ? {} : { personality }),
            ...(doctrine === undefined ? {} : { doctrine }),
          }),
        );
      }
    }
    expect(army.length).toBe(42);
    const first = postureOf(army);
    const counts = Object.values(first.distribution);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(42);
    expect(isStanceId(first.majority)).toBe(true);
    expect(postureOf(army)).toEqual(first);
  });
});

describe('purity', () => {
  it('result is a fresh copy (mutating it never affects later calls)', () => {
    const army = [record({ id: 'c0', personality: 'conqueror', doctrine: 'blitz' })];
    const first = postureOf(army);
    (first.distribution as unknown as Record<string, number>).aggressive = 0;
    const second = postureOf(army);
    expect(second.distribution.aggressive).toBe(1);
    expect(second.majority).toBe('aggressive');
  });
});
