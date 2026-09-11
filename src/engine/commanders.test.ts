/**
 * M027 — Commander data tests: record/data guards, id uniqueness, holder
 * queries, leaf-mirror cross-checks, WorldState slot, own-only perception
 * (test-only imports).
 */
import { describe, expect, it } from 'vitest';
import { MAX_ID_LENGTH, type PlayerId } from './authority.js';
import { MAX_HOLDER_ID_CHARS as STOCKPILE_HOLDER_CAP } from './stockpiles.js';
import {
  commanderById,
  COMMANDERS_SCHEMA_VERSION,
  commandersOf,
  isCommanderRecord,
  isCommandersData,
  MAX_COMMANDER_ID_CHARS,
  MAX_HOLDER_ID_CHARS,
  type CommandersData,
} from './commanders.js';
import { isDnaTraits, TRAIT_IDS } from './dna.js';
import { perceive } from './views.js';
import { createWorldState, isWorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

describe('isCommanderRecord (unit)', () => {
  it('accepts a populated record', () => {
    expect(isCommanderRecord({ id: 'c0', owner: 'p1', active: true })).toBe(true);
    expect(isCommanderRecord({ id: 'c1', owner: 'p2', active: false })).toBe(true);
  });

  it.each([[null], [[]], ['x']] as Array<[unknown]>)('rejects non-object %j', (value) => {
    expect(isCommanderRecord(value)).toBe(false);
  });

  it.each([
    [{ owner: 'p1', active: true }],
    [{ id: '', owner: 'p1', active: true }],
    [{ id: 'x'.repeat(65), owner: 'p1', active: true }],
    [{ id: 42, owner: 'p1', active: true }],
  ] as Array<[unknown]>)('rejects bad id %j', (value) => {
    expect(isCommanderRecord(value)).toBe(false);
  });

  it.each([
    [{ id: 'c0', active: true }],
    [{ id: 'c0', owner: '', active: true }],
    [{ id: 'c0', owner: 'x'.repeat(65), active: true }],
  ] as Array<[unknown]>)('rejects bad owner %j', (value) => {
    expect(isCommanderRecord(value)).toBe(false);
  });

  it.each([
    [{ id: 'c0', owner: 'p1' }],
    [{ id: 'c0', owner: 'p1', active: 0 }],
    [{ id: 'c0', owner: 'p1', active: 1 }],
    [{ id: 'c0', owner: 'p1', active: 'yes' }],
    [{ id: 'c0', owner: 'p1', active: null }],
  ] as Array<[unknown]>)('rejects non-boolean active %j', (value) => {
    expect(isCommanderRecord(value)).toBe(false);
  });
});

describe('isCommandersData (unit)', () => {
  function populated(): CommandersData {
    return {
      schemaVersion: 1,
      nextId: 2,
      commanders: [
        { id: 'c0', owner: 'p1', active: true },
        { id: 'c1', owner: 'p2', active: false },
      ],
    };
  }

  it('accepts populated and empty rosters', () => {
    expect(isCommandersData(populated())).toBe(true);
    expect(isCommandersData({ schemaVersion: 1, nextId: 0, commanders: [] })).toBe(true);
  });

  it.each([[null], [[]], ['x']] as Array<[unknown]>)('rejects non-object %j', (value) => {
    expect(isCommandersData(value)).toBe(false);
  });

  it.each([[0], [2], ['1']] as Array<[unknown]>)('rejects schemaVersion %j', (value) => {
    expect(isCommandersData({ schemaVersion: value, nextId: 0, commanders: [] })).toBe(false);
  });

  it.each([[-1], [1.5], [0x100000000], ['0']] as Array<[unknown]>)('rejects nextId %j', (value) => {
    expect(isCommandersData({ schemaVersion: 1, nextId: value, commanders: [] })).toBe(false);
  });

  it('rejects non-array commanders and invalid members', () => {
    expect(isCommandersData({ schemaVersion: 1, nextId: 0, commanders: {} })).toBe(false);
    expect(
      isCommandersData({
        schemaVersion: 1,
        nextId: 1,
        commanders: [{ id: 'c0', owner: 'p1', active: true }, 'x'],
      }),
    ).toBe(false);
  });

  it('rejects duplicate ids', () => {
    const record = { id: 'c0', owner: 'p1', active: true } as const;
    expect(
      isCommandersData({ schemaVersion: 1, nextId: 2, commanders: [record, { ...record, owner: 'p2' }] }),
    ).toBe(false);
  });
});

describe('commandersOf (unit)', () => {
  function roster(): CommandersData {
    return {
      schemaVersion: 1,
      nextId: 3,
      commanders: [
        { id: 'c0', owner: 'p1', active: true },
        { id: 'c1', owner: 'p2', active: false },
        { id: 'c2', owner: 'p1', active: true },
      ],
    };
  }

  it('returns own commanders in array order', () => {
    expect(commandersOf(roster(), 'p1')).toEqual([
      { id: 'c0', owner: 'p1', active: true },
      { id: 'c2', owner: 'p1', active: true },
    ]);
  });

  it('fail-soft: [] for absent data and unknown holders', () => {
    expect(commandersOf(undefined, 'p1')).toEqual([]);
    expect(commandersOf(roster(), 'zx')).toEqual([]);
  });

  it('returns fresh copies (never live refs)', () => {
    const data = roster();
    const mine = commandersOf(data, 'p1');
    expect(mine).toHaveLength(2);
    const first = mine[0];
    const live = data.commanders[0];
    if (first === undefined || live === undefined) {
      throw new Error('TEST BUG: fixture commanders missing');
    }
    expect(first).not.toBe(live);
    expect(first).toEqual(live);
  });
});

describe('commanderById (unit)', () => {
  function roster(): CommandersData {
    return {
      schemaVersion: 1,
      nextId: 2,
      commanders: [
        { id: 'c0', owner: 'p1', active: true },
        { id: 'c1', owner: 'p2', active: false },
      ],
    };
  }

  it('finds by id as a fresh copy', () => {
    const data = roster();
    const found = commanderById(data, 'c1');
    const live = data.commanders[1];
    if (found === undefined || live === undefined) {
      throw new Error('TEST BUG: fixture commander missing');
    }
    expect(found).toEqual({ id: 'c1', owner: 'p2', active: false });
    expect(found).not.toBe(live);
  });

  it('fail-soft: undefined when missing or absent', () => {
    expect(commanderById(roster(), 'c9')).toBeUndefined();
    expect(commanderById(undefined, 'c0')).toBeUndefined();
  });
});

describe('leaf mirrors (unit)', () => {
  it('holder bound matches stockpiles + authority (all 64)', () => {
    expect(MAX_HOLDER_ID_CHARS).toBe(64);
    expect(MAX_HOLDER_ID_CHARS).toBe(STOCKPILE_HOLDER_CAP);
    expect(MAX_HOLDER_ID_CHARS).toBe(MAX_ID_LENGTH);
    expect(MAX_COMMANDER_ID_CHARS).toBe(64);
  });

  it('schema version is 1', () => {
    expect(COMMANDERS_SCHEMA_VERSION).toBe(1);
  });
});

describe('WorldState commanders slot (integration)', () => {
  function staffed(): CommandersData {
    return {
      schemaVersion: 1,
      nextId: 2,
      commanders: [
        { id: 'c0', owner: 'p1', active: true },
        { id: 'c1', owner: 'p2', active: false },
      ],
    };
  }

  it('round-trips a roster through createWorldState', () => {
    const state = createWorldState({ players: [P1, P2], commanders: staffed() });
    expect(state.commanders).toEqual(staffed());
  });

  it('rejects malformed commanders loud (guard arm + builder)', () => {
    const bad = {
      schemaVersion: 1,
      nextId: 1,
      commanders: [{ id: 'c0', owner: 'p1' }],
    } as never;
    expect(() => createWorldState({ players: [P1, P2], commanders: bad })).toThrow(
      /invalid initial world/,
    );
    const base = createWorldState({ players: [P1, P2] });
    expect(isWorldState({ ...base, commanders: bad })).toBe(false);
  });

  it('absent when unplaced (init-placed doctrine)', () => {
    expect(createWorldState({ players: [P1, P2] }).commanders).toBeUndefined();
  });
});

describe('commander perception (integration: own-only)', () => {
  it('sees own commanders, foe commanders stay out (fail-closed →M028+)', () => {
    const state = createWorldState({
      players: [P1, P2],
      commanders: {
        schemaVersion: 1,
        nextId: 2,
        commanders: [
          { id: 'c0', owner: 'p1', active: true },
          { id: 'c1', owner: 'p2', active: false },
        ],
      },
    });
    expect(perceive(state, P1).commanders).toEqual([{ id: 'c0', owner: 'p1', active: true }]);
    expect(perceive(state, P2).commanders).toEqual([{ id: 'c1', owner: 'p2', active: false }]);
  });

  it('absent roster perceives as []', () => {
    expect(perceive(createWorldState({ players: [P1, P2] }), P1).commanders).toEqual([]);
  });

  it('own DNA rides the record; foe DNA stays out (M031 pin)', () => {
    const dna = {
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
    };
    const state = createWorldState({
      players: [P1, P2],
      commanders: {
        schemaVersion: 1,
        nextId: 2,
        commanders: [
          { id: 'c0', owner: 'p1', active: true, dna },
          { id: 'c1', owner: 'p2', active: false, dna },
        ],
      },
    });
    expect(perceive(state, P1).commanders).toEqual([{ id: 'c0', owner: 'p1', active: true, dna }]);
    expect(perceive(state, P2).commanders).toEqual([{ id: 'c1', owner: 'p2', active: false, dna }]);
  });
});

describe('DNA embed (M031)', () => {
  function dna(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

  function staffed(): CommandersData {
    return {
      schemaVersion: 1,
      nextId: 1,
      commanders: [{ id: 'c0', owner: 'p1', active: true, dna: dna() as never }],
    };
  }

  it('record without dna stays valid (backward compatible)', () => {
    expect(isCommanderRecord({ id: 'c0', owner: 'p1', active: true })).toBe(true);
  });

  it('record with valid dna validates (golden)', () => {
    expect(isCommanderRecord({ id: 'c0', owner: 'p1', active: true, dna: dna() })).toBe(true);
  });

  it.each([...TRAIT_IDS])('record with abused trait %s rejects', (trait) => {
    for (const bad of [-1, 101, 1.5, 'x', null, undefined, {}, []]) {
      expect(
        isCommanderRecord({ id: 'c0', owner: 'p1', active: true, dna: dna({ [trait]: bad }) }),
      ).toBe(false);
    }
    const missing = dna();
    delete missing[trait];
    expect(isCommanderRecord({ id: 'c0', owner: 'p1', active: true, dna: missing })).toBe(false);
  });

  it('queries return dna by fresh copy (mutating results never aliases canonical)', () => {
    const data = staffed();
    const seen = commandersOf(data, 'p1');
    const first = seen[0];
    expect(first?.dna?.aggression).toBe(60);
    if (first?.dna !== undefined) {
      (first.dna as unknown as Record<string, number>).aggression = 0;
    }
    expect(commandersOf(data, 'p1')[0]?.dna?.aggression).toBe(60);
    const solo = commanderById(data, 'c0');
    if (solo?.dna !== undefined) {
      (solo.dna as unknown as Record<string, number>).aggression = 0;
    }
    expect(commanderById(data, 'c0')?.dna?.aggression).toBe(60);
    expect(data.commanders[0]).toEqual({
      id: 'c0',
      owner: 'p1',
      active: true,
      dna: dna(),
    });
  });

  it('WorldState slot round-trips dna; malformed dna rejects loud', () => {
    const state = createWorldState({ players: [P1, P2], commanders: staffed() });
    expect(state.commanders?.commanders[0]?.dna).toEqual(dna());
    expect(() =>
      createWorldState({
        players: [P1, P2],
        commanders: {
          schemaVersion: 1,
          nextId: 1,
          commanders: [{ id: 'c0', owner: 'p1', active: true, dna: dna({ greed: 101 }) } as never],
        },
      }),
    ).toThrow(/invalid initial world/);
  });
});

describe('DNA mirror cross-check (M031)', () => {
  function dna(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

  function recordOf(candidate: unknown): Record<string, unknown> {
    return { id: 'c0', owner: 'p1', active: true, dna: candidate };
  }

  it('mirror agrees with canonical on valid + boundary records', () => {
    const cases: unknown[] = [dna()];
    for (const trait of TRAIT_IDS) {
      cases.push(dna({ [trait]: 0 }), dna({ [trait]: 100 }));
    }
    expect(cases).toHaveLength(21);
    for (const candidate of cases) {
      expect(isDnaTraits(candidate)).toBe(true);
      expect(isCommanderRecord(recordOf(candidate))).toBe(true);
    }
  });

  it.each([...TRAIT_IDS])('mirror agrees with canonical on %s abuse battery', (trait) => {
    for (const bad of [-1, 101, 1.5, NaN, '50', null, undefined, {}, []]) {
      const candidate = dna({ [trait]: bad });
      expect(isCommanderRecord(recordOf(candidate))).toBe(isDnaTraits(candidate));
    }
    const missing = dna();
    delete missing[trait];
    expect(isDnaTraits(missing)).toBe(false);
    expect(isCommanderRecord(recordOf(missing))).toBe(false);
  });

  it('mirror agrees with canonical on non-object dna', () => {
    for (const bad of [7, 'x', [], null]) {
      expect(isDnaTraits(bad)).toBe(false);
      expect(isCommanderRecord(recordOf(bad))).toBe(false);
    }
  });
});
