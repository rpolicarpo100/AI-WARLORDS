/**
 * M053 — Memory recall tests: stream-validated recollection over stub
 * logs (D-047, voted attribute-recall). Fresh iff the seq resolves
 * with agreeing revision + kind; everything else flags stale (the
 * forgery signature). Subject narrows to one entity.
 */
import { describe, expect, it } from 'vitest';
import type { CommanderMemory, CommanderRecord } from './commanders.js';
import { recallMemories, type StreamLookup } from './memory-recall.js';

function memory(overrides: Partial<CommanderMemory> = {}): CommanderMemory {
  return { seq: 5, revision: 2, kind: 'order.executed', subject: 'c0', ...overrides };
}

function holder(memories: readonly CommanderMemory[]): CommanderRecord {
  return { id: 'c0', owner: 'p1', active: true, memories: [...memories] };
}

function lookupOf(entries: ReadonlyMap<number, { revision: number; kind: string }>): StreamLookup {
  return (seq) => entries.get(seq);
}

describe('recallMemories (stream-validated)', () => {
  it('fails soft on missing records', () => {
    expect(recallMemories(undefined, lookupOf(new Map()))).toBeUndefined();
  });

  it('recalls empty logs as empty splits', () => {
    expect(recallMemories(holder([]), lookupOf(new Map()))).toEqual({ fresh: [], stale: [] });
    const bare: CommanderRecord = { id: 'c0', owner: 'p1', active: true };
    expect(recallMemories(bare, lookupOf(new Map()))).toEqual({ fresh: [], stale: [] });
  });

  it('passes fresh memories (seq resolves, revision + kind agree)', () => {
    const log = holder([
      memory(),
      memory({ seq: 7, revision: 3, kind: 'unit.attacked', subject: 'u1' }),
    ]);
    const stream = new Map([
      [5, { revision: 2, kind: 'order.executed' }],
      [7, { revision: 3, kind: 'unit.attacked' }],
    ]);
    expect(recallMemories(log, lookupOf(stream))).toEqual({
      fresh: [memory(), memory({ seq: 7, revision: 3, kind: 'unit.attacked', subject: 'u1' })],
      stale: [],
    });
  });

  it('flags missing seqs as stale (the forgery signature)', () => {
    const log = holder([memory({ seq: 999, revision: 9 })]);
    expect(recallMemories(log, lookupOf(new Map()))).toEqual({
      fresh: [],
      stale: [memory({ seq: 999, revision: 9 })],
    });
  });

  it('flags revision drift and kind mismatch as stale', () => {
    const log = holder([
      memory({ seq: 5 }),
      memory({ seq: 6, revision: 2, kind: 'order.executed', subject: 'c0' }),
    ]);
    const stream = new Map([
      [5, { revision: 99, kind: 'order.executed' }],
      [6, { revision: 2, kind: 'unit.moved' }],
    ]);
    const recollection = recallMemories(log, lookupOf(stream));
    expect(recollection?.fresh).toEqual([]);
    expect(recollection?.stale).toHaveLength(2);
  });

  it('splits mixed logs (fresh safe, stale flagged)', () => {
    const log = holder([memory(), memory({ seq: 999, revision: 9 })]);
    const stream = new Map([[5, { revision: 2, kind: 'order.executed' }]]);
    expect(recallMemories(log, lookupOf(stream))).toEqual({
      fresh: [memory()],
      stale: [memory({ seq: 999, revision: 9 })],
    });
  });

  it('narrows by subject (about X)', () => {
    const log = holder([
      memory(),
      memory({ seq: 7, revision: 3, kind: 'unit.attacked', subject: 'u1' }),
    ]);
    const stream = new Map([
      [5, { revision: 2, kind: 'order.executed' }],
      [7, { revision: 3, kind: 'unit.attacked' }],
    ]);
    expect(recallMemories(log, lookupOf(stream), 'u1')).toEqual({
      fresh: [memory({ seq: 7, revision: 3, kind: 'unit.attacked', subject: 'u1' })],
      stale: [],
    });
    expect(recallMemories(log, lookupOf(stream), 'nobody')).toEqual({ fresh: [], stale: [] });
  });
});
