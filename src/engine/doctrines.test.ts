/**
 * M033 — Doctrine tests: fixed-6 vocabulary, voted DNA deltas
 * (exact matrix golden), fresh-copy lookup, bounds conformance.
 */
import { describe, expect, it } from 'vitest';
import {
  DELTA_MAX,
  DELTA_MIN,
  dnaDeltasOf,
  DOCTRINE_DNA_DELTAS,
  DOCTRINE_IDS,
  isDoctrineId,
} from './doctrines.js';

describe('doctrine vocabulary', () => {
  it('locks the six ids in master #24 order', () => {
    expect([...DOCTRINE_IDS]).toEqual([
      'blitz',
      'turtle',
      'economic-empire',
      'guerrilla',
      'siege-master',
      'counterstrike',
    ]);
  });

  it('isDoctrineId accepts the six, rejects the rest', () => {
    for (const id of DOCTRINE_IDS) {
      expect(isDoctrineId(id)).toBe(true);
    }
    for (const bad of ['BLITZ', 'conqueror', 'economic_empire', '', 7, null, undefined, {}, []]) {
      expect(isDoctrineId(bad)).toBe(false);
    }
  });
});

describe('DNA deltas (voted matrix 2026-09-11)', () => {
  it('locks the ±30 delta scale (voted)', () => {
    expect(DELTA_MIN).toBe(-30);
    expect(DELTA_MAX).toBe(30);
  });

  it('golden: exact 6×10 matrix (trait order: aggr/def/econ/expl/risk/expa/dipl/pati/greed/adap)', () => {
    expect(DOCTRINE_DNA_DELTAS).toEqual({
      blitz: {
        aggression: 25,
        defense: -15,
        economy: -10,
        exploration: 10,
        risk: 25,
        expansion: 15,
        diplomacy: -10,
        patience: -20,
        greed: 10,
        adaptability: 10,
      },
      turtle: {
        aggression: -20,
        defense: 30,
        economy: 10,
        exploration: -15,
        risk: -20,
        expansion: -10,
        diplomacy: 0,
        patience: 25,
        greed: 0,
        adaptability: -10,
      },
      'economic-empire': {
        aggression: -10,
        defense: 10,
        economy: 30,
        exploration: 10,
        risk: -10,
        expansion: 20,
        diplomacy: 15,
        patience: 20,
        greed: 20,
        adaptability: 0,
      },
      guerrilla: {
        aggression: 15,
        defense: -10,
        economy: 0,
        exploration: 25,
        risk: 20,
        expansion: 10,
        diplomacy: 0,
        patience: 10,
        greed: 10,
        adaptability: 25,
      },
      'siege-master': {
        aggression: 10,
        defense: 15,
        economy: 15,
        exploration: -5,
        risk: 0,
        expansion: 5,
        diplomacy: -10,
        patience: 30,
        greed: 10,
        adaptability: 0,
      },
      counterstrike: {
        aggression: 10,
        defense: 25,
        economy: 0,
        exploration: 0,
        risk: 5,
        expansion: 0,
        diplomacy: 0,
        patience: 20,
        greed: 0,
        adaptability: 15,
      },
    });
  });

  it('every delta sits inside ±30 and rides multiples of 5 (convention proof)', () => {
    for (const id of DOCTRINE_IDS) {
      const deltas = DOCTRINE_DNA_DELTAS[id as keyof typeof DOCTRINE_DNA_DELTAS];
      for (const value of Object.values(deltas)) {
        expect(value).toBeGreaterThanOrEqual(DELTA_MIN);
        expect(value).toBeLessThanOrEqual(DELTA_MAX);
        expect(Math.abs(value % 5)).toBe(0);
      }
    }
  });

  it('deltas are frozen (canonical, never mutated)', () => {
    expect(Object.isFrozen(DOCTRINE_DNA_DELTAS)).toBe(true);
    for (const id of DOCTRINE_IDS) {
      expect(Object.isFrozen(DOCTRINE_DNA_DELTAS[id as keyof typeof DOCTRINE_DNA_DELTAS])).toBe(
        true,
      );
    }
  });
});

describe('dnaDeltasOf (lookup)', () => {
  it('returns a fresh copy (mutating results never touches canonical)', () => {
    const first = dnaDeltasOf('blitz');
    expect(first?.aggression).toBe(25);
    expect(first).not.toBe(DOCTRINE_DNA_DELTAS.blitz);
    if (first !== undefined) {
      (first as unknown as Record<string, number>).aggression = 0;
    }
    expect(dnaDeltasOf('blitz')?.aggression).toBe(25);
    expect(DOCTRINE_DNA_DELTAS.blitz.aggression).toBe(25);
  });

  it('unknown ids stay undefined (fail-soft lookup)', () => {
    expect(dnaDeltasOf('conqueror' as never)).toBeUndefined();
  });
});
