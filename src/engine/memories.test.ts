/**
 * M051 — Commander memory records data tests: closed memorable
 * vocabulary, total kind/memory/log guards, bounds. Data-first: no
 * transitions, no events, no readers until M052+. Kind grounding:
 * each code is a REAL emitted event `type:` (verified against
 * producers 2026-09-12 — order facts, battle facts, sightings).
 */
import { describe, expect, it } from 'vitest';
import {
  isCommanderMemory,
  isMemorableKind,
  isMemoryLog,
  MAX_MEMORIES_PER_COMMANDER,
  MAX_MEMORY_SUBJECT_CHARS,
  MEMORABLE_KINDS,
} from './memories.js';

const VALID = { seq: 12, revision: 3, kind: 'unit.slain', subject: 'u7' };

describe('MEMORABLE_KINDS (remembered vocabulary)', () => {
  it('locks the six kinds, alphabetical', () => {
    expect([...MEMORABLE_KINDS]).toEqual([
      'order.canceled',
      'order.executed',
      'order.overridden',
      'unit.attacked',
      'unit.slain',
      'unit.spotted',
    ]);
  });
});

describe('isMemorableKind (total)', () => {
  it.each([...MEMORABLE_KINDS])('accepts kind %s', (kind) => {
    expect(isMemorableKind(kind)).toBe(true);
  });

  it('rejects lookalikes and non-strings', () => {
    for (const bad of [
      'UNIT.SLAIN',
      'unit.slain ',
      ' slain',
      '',
      'ai.assessment',
      'cell.discovered',
      7,
      null,
      undefined,
      [],
      {},
    ]) {
      expect(isMemorableKind(bad)).toBe(false);
    }
  });
});

describe('isCommanderMemory (total)', () => {
  it('accepts a memory with every kind', () => {
    for (const kind of MEMORABLE_KINDS) {
      expect(isCommanderMemory({ ...VALID, kind })).toBe(true);
    }
  });

  it('ignores extras (M015 precedent)', () => {
    expect(isCommanderMemory({ ...VALID, note: 'ambush', depth: 2 })).toBe(true);
  });

  it('rejects non-objects', () => {
    for (const bad of [7, 'unit.slain', null, [], 'x']) {
      expect(isCommanderMemory(bad)).toBe(false);
    }
  });

  it('rejects missing fields', () => {
    for (const key of ['seq', 'revision', 'kind', 'subject'] as const) {
      const rest = Object.fromEntries(Object.entries(VALID).filter(([k]) => k !== key));
      expect(isCommanderMemory(rest)).toBe(false);
    }
  });

  it('rejects bad seqs', () => {
    for (const seq of [-1, 1.5, Number.NaN, 0x100000000, '0', null]) {
      expect(isCommanderMemory({ ...VALID, seq })).toBe(false);
    }
  });

  it('rejects bad revisions', () => {
    for (const revision of [-1, 1.5, Number.NaN, 0x100000000, '0', null]) {
      expect(isCommanderMemory({ ...VALID, revision })).toBe(false);
    }
  });

  it('rejects bad kinds', () => {
    for (const kind of ['city.upgrade', 'UNIT.SLAIN', 'unit.slain ', '', 7, null]) {
      expect(isCommanderMemory({ ...VALID, kind })).toBe(false);
    }
  });

  it('rejects bad subjects', () => {
    for (const subject of ['', 's'.repeat(65), 7, null, []]) {
      expect(isCommanderMemory({ ...VALID, subject })).toBe(false);
    }
  });

  it('accepts zero, the uint32 ceiling, and the 64-char subject', () => {
    expect(isCommanderMemory({ ...VALID, seq: 0, revision: 0 })).toBe(true);
    expect(isCommanderMemory({ ...VALID, seq: 0xffffffff, revision: 0xffffffff })).toBe(true);
    expect(isCommanderMemory({ ...VALID, subject: 's'.repeat(64) })).toBe(true);
  });
});

describe('isMemoryLog (capped)', () => {
  it('accepts empty logs and full logs of eight', () => {
    expect(isMemoryLog([])).toBe(true);
    const full = Array.from({ length: 8 }, (_, seq) => ({ ...VALID, seq }));
    expect(isMemoryLog(full)).toBe(true);
  });

  it('rejects non-arrays, overflows, and invalid entries', () => {
    expect(isMemoryLog({})).toBe(false);
    const overflow = Array.from({ length: 9 }, (_, seq) => ({ ...VALID, seq }));
    expect(isMemoryLog(overflow)).toBe(false);
    expect(isMemoryLog([{ ...VALID }, { ...VALID, kind: 'nope' }])).toBe(false);
  });
});

describe('memory bounds (exported)', () => {
  it('locks the log ceiling at 8 and the subject ceiling at 64', () => {
    expect(MAX_MEMORIES_PER_COMMANDER).toBe(8);
    expect(MAX_MEMORY_SUBJECT_CHARS).toBe(64);
  });
});
