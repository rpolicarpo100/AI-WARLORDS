/**
 * M035 — Effective-DNA composer tests: hand-computed goldens from the
 * voted matrices, clamp pins, precedence chain, 84-combo validity
 * battery, fail-soft abuse, fresh-copy, no-mutation.
 */
import { describe, expect, it } from 'vitest';
import type {
  CommanderDna,
  CommanderDoctrine,
  CommanderPersonality,
  CommanderRecord,
} from './commanders.js';
import { isDnaTraits } from './dna.js';
import { DOCTRINE_IDS } from './doctrines.js';
import { NEUTRAL_DNA, effectiveDnaOf } from './effective-dna.js';
import { PERSONALITY_IDS, dnaPresetOf } from './personalities.js';

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

const SAMPLE_DNA: CommanderDna = {
  aggression: 10,
  defense: 20,
  economy: 30,
  exploration: 40,
  risk: 50,
  expansion: 60,
  diplomacy: 70,
  patience: 80,
  greed: 90,
  adaptability: 100,
};

function record(fields: Partial<CommanderRecord> & { id: string }): CommanderRecord {
  return { owner: 'p1', active: true, ...fields };
}

describe('neutral base', () => {
  it('NEUTRAL_DNA is the voted emperor preset (conformance, not trust)', () => {
    expect(NEUTRAL_DNA).toEqual(dnaPresetOf('emperor'));
    expect(NEUTRAL_DNA).toEqual(FIFTIES);
    expect(isDnaTraits(NEUTRAL_DNA)).toBe(true);
    expect(Object.isFrozen(NEUTRAL_DNA)).toBe(true);
  });
});

describe('goldens (hand-computed from voted matrices)', () => {
  it('strategist + turtle: preset base + deltas, patience clamps at 100', () => {
    expect(
      effectiveDnaOf(record({ id: 'c0', personality: 'strategist', doctrine: 'turtle' })),
    ).toEqual({
      aggression: 25,
      defense: 90,
      economy: 70,
      exploration: 40,
      risk: 15,
      expansion: 40,
      diplomacy: 50,
      patience: 100,
      greed: 40,
      adaptability: 60,
    });
  });

  it('conqueror + blitz: aggression clamps at 100', () => {
    expect(
      effectiveDnaOf(record({ id: 'c0', personality: 'conqueror', doctrine: 'blitz' })),
    ).toEqual({
      aggression: 100,
      defense: 25,
      economy: 30,
      exploration: 60,
      risk: 100,
      expansion: 85,
      diplomacy: 10,
      patience: 10,
      greed: 70,
      adaptability: 60,
    });
  });

  it('record-dna beats preset (conqueror ignored when dna present)', () => {
    expect(
      effectiveDnaOf(
        record({ id: 'c0', dna: FIFTIES, personality: 'conqueror', doctrine: 'blitz' }),
      ),
    ).toEqual({
      aggression: 75,
      defense: 35,
      economy: 40,
      exploration: 60,
      risk: 75,
      expansion: 65,
      diplomacy: 40,
      patience: 30,
      greed: 60,
      adaptability: 60,
    });
  });

  it('bottom clamp: patience 5 + blitz −20 floors at 0, aggression 90 + 25 caps at 100', () => {
    const dna: CommanderDna = { ...FIFTIES, aggression: 90, patience: 5 };
    expect(effectiveDnaOf(record({ id: 'c0', dna, doctrine: 'blitz' }))).toEqual({
      aggression: 100,
      defense: 35,
      economy: 40,
      exploration: 60,
      risk: 75,
      expansion: 65,
      diplomacy: 40,
      patience: 0,
      greed: 60,
      adaptability: 60,
    });
  });

  it('doctrine-only resolves over neutral (turtle over 50s)', () => {
    expect(effectiveDnaOf(record({ id: 'c0', doctrine: 'turtle' }))).toEqual({
      aggression: 30,
      defense: 80,
      economy: 60,
      exploration: 35,
      risk: 30,
      expansion: 40,
      diplomacy: 50,
      patience: 75,
      greed: 50,
      adaptability: 40,
    });
  });

  it('personality-only resolves to the preset copy (defender)', () => {
    expect(effectiveDnaOf(record({ id: 'c0', personality: 'defender' }))).toEqual({
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
    });
  });
});

describe('precedence + totality', () => {
  it('bare commission-minted record resolves to neutral', () => {
    expect(effectiveDnaOf(record({ id: 'c7' }))).toEqual(FIFTIES);
  });

  it('precedence chain is strict: dna > preset > neutral', () => {
    const withDna = effectiveDnaOf(
      record({ id: 'c0', dna: FIFTIES, personality: 'strategist', doctrine: 'turtle' }),
    );
    const presetOnly = effectiveDnaOf(
      record({ id: 'c0', personality: 'strategist', doctrine: 'turtle' }),
    );
    const neutralOnly = effectiveDnaOf(record({ id: 'c0', doctrine: 'turtle' }));
    expect(withDna).not.toEqual(presetOnly);
    expect(presetOnly).not.toEqual(neutralOnly);
    expect(withDna).toEqual(effectiveDnaOf(record({ id: 'c0', dna: FIFTIES, doctrine: 'turtle' })));
  });

  it('unknown labels fail soft (leaf undefined = absent)', () => {
    const abused = {
      id: 'c0',
      owner: 'p1',
      active: true,
      personality: 'xx',
      doctrine: 'yy',
    } as unknown as CommanderRecord;
    expect(effectiveDnaOf(abused)).toEqual(FIFTIES);
    const abusedDoctrine = {
      id: 'c0',
      owner: 'p1',
      active: true,
      dna: SAMPLE_DNA,
      doctrine: 'yy',
    } as unknown as CommanderRecord;
    expect(effectiveDnaOf(abusedDoctrine)).toEqual(SAMPLE_DNA);
  });
});

describe('validity battery', () => {
  it('every effective vector is valid DNA (6 personalities × 7 doctrines × 2 dna = 84)', () => {
    const personalities: Array<CommanderPersonality | undefined> = [
      undefined,
      ...(PERSONALITY_IDS as readonly CommanderPersonality[]),
    ];
    const doctrines: Array<CommanderDoctrine | undefined> = [
      undefined,
      ...(DOCTRINE_IDS as readonly CommanderDoctrine[]),
    ];
    const dnas: Array<CommanderDna | undefined> = [undefined, SAMPLE_DNA];
    let combos = 0;
    for (const personality of personalities) {
      for (const doctrine of doctrines) {
        for (const dna of dnas) {
          combos += 1;
          const fields: Partial<CommanderRecord> & { id: string } = {
            id: `c${combos}`,
            ...(personality === undefined ? {} : { personality }),
            ...(doctrine === undefined ? {} : { doctrine }),
            ...(dna === undefined ? {} : { dna }),
          };
          expect(isDnaTraits(effectiveDnaOf(record(fields)))).toBe(true);
        }
      }
    }
    expect(combos).toBe(84);
  });
});

describe('purity', () => {
  it('output is a fresh copy (mutating results never affects later calls)', () => {
    const fields = { id: 'c0', personality: 'strategist', doctrine: 'turtle' } as const;
    const first = effectiveDnaOf(record({ ...fields }));
    expect(first).not.toBe(NEUTRAL_DNA);
    (first as unknown as Record<string, number>).aggression = 0;
    expect(effectiveDnaOf(record({ ...fields })).aggression).toBe(25);
  });

  it('input record is never mutated (deep-frozen input survives)', () => {
    const dna = Object.freeze({ ...SAMPLE_DNA });
    const input = Object.freeze(
      record({ id: 'c0', dna, personality: 'conqueror', doctrine: 'blitz' }),
    );
    const before = JSON.stringify(input);
    const result = effectiveDnaOf(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(isDnaTraits(result)).toBe(true);
  });
});
