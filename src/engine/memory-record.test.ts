/**
 * M052 — Memory record tests: wire rule + handler over stub states
 * (D-046, voted record-verb + attribute-named). Per-event fail-closed
 * skips, owner-only writes (anti-spam), seq dedup, FIFO cap 8,
 * subject-is-self. Live Match wiring (auto-record, budget-free,
 * fail-stop) rides match-memory-record.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { PlayerId, TransitionHandler } from './authority.js';
import type { CommanderRecord } from './commanders.js';
import {
  MAX_RECORD_EVENTS,
  memoryRecordHandlers,
  RECORD_TRANSITION,
  recordParamsRule,
} from './memory-record.js';
import { createWorldState, type WorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

const HANDLER = memoryRecordHandlers().get(RECORD_TRANSITION) as TransitionHandler<WorldState>;

function orderEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    seq: 5,
    revision: 2,
    type: 'order.executed',
    priority: 'normal',
    payload: { player: 'p1', commander: 'c0', kind: 'unit.move', depth: 0 },
    ...overrides,
  };
}

function staffedState(records: ReadonlyArray<CommanderRecord>): WorldState {
  return createWorldState({
    players: [P1, P2],
    commanders: { schemaVersion: 1, nextId: 2, commanders: [...records] },
  });
}

function holder(overrides: Partial<CommanderRecord> = {}): CommanderRecord {
  return { id: 'c0', owner: 'p1', active: true, ...overrides };
}

function runRecord(state: WorldState, caller: PlayerId, params: unknown) {
  return HANDLER({ state, caller, params });
}

describe('recordParamsRule (wire shape)', () => {
  it('accepts one event and the full envelope of 32', () => {
    expect(recordParamsRule(P1, { events: [orderEvent()] })).toBeNull();
    const full = Array.from({ length: 32 }, (_, seq) => orderEvent({ seq }));
    expect(recordParamsRule(P1, { events: full })).toBeNull();
  });

  it('rejects non-object envelopes', () => {
    for (const params of [7, 'events', null, [], undefined]) {
      expect(recordParamsRule(P1, params)).toEqual({
        rule: 'record-params',
        detail: 'record takes { events }',
      });
    }
  });

  it('rejects non-array, empty, and oversized event lists', () => {
    expect(recordParamsRule(P1, { events: 'nope' })).toEqual({
      rule: 'record-params',
      detail: 'record takes { events: array }',
    });
    expect(recordParamsRule(P1, { events: [] })).toEqual({
      rule: 'record-params',
      detail: 'record takes a non-empty events array',
    });
    const overflow = Array.from({ length: 33 }, (_, seq) => orderEvent({ seq }));
    expect(recordParamsRule(P1, { events: overflow })).toEqual({
      rule: 'record-params',
      detail: 'record takes at most 32 events',
    });
  });
});

describe('record handler (per-event fail-closed)', () => {
  it('records one stamped order event (subject is self)', () => {
    const outcome = runRecord(staffedState([holder()]), P1, { events: [orderEvent()] });
    expect(outcome).toEqual({
      applied: true,
      state: expect.objectContaining({}),
      summary: 'recorded 1 memory',
    });
    const memories =
      outcome.applied === true
        ? outcome.state.commanders?.commanders.find((record) => record.id === 'c0')?.memories
        : undefined;
    expect(memories).toEqual([{ seq: 5, revision: 2, kind: 'order.executed', subject: 'c0' }]);
  });

  it('records batches to one log (plural summary)', () => {
    const outcome = runRecord(staffedState([holder()]), P1, {
      events: [
        orderEvent({ seq: 5, type: 'order.executed' }),
        orderEvent({ seq: 6, type: 'order.overridden' }),
      ],
    });
    expect(outcome.applied === true ? outcome.summary : undefined).toBe('recorded 2 memories');
    const memories =
      outcome.applied === true
        ? outcome.state.commanders?.commanders.find((record) => record.id === 'c0')?.memories
        : undefined;
    expect(memories).toEqual([
      { seq: 5, revision: 2, kind: 'order.executed', subject: 'c0' },
      { seq: 6, revision: 2, kind: 'order.overridden', subject: 'c0' },
    ]);
  });

  it('skips non-memorable kinds whole', () => {
    const outcome = runRecord(staffedState([holder()]), P1, {
      events: [orderEvent({ type: 'unit.moved' }), orderEvent({ type: 'ai.assessment' })],
    });
    expect(outcome).toEqual({ applied: false, reason: 'record: nothing memorable.' });
  });

  it('skips battle and sighting facts (no commander names them — M053 owns)', () => {
    for (const type of ['unit.attacked', 'unit.slain', 'unit.spotted']) {
      const outcome = runRecord(staffedState([holder()]), P1, {
        events: [{ seq: 5, revision: 2, type, priority: 'normal', payload: { player: 'p1' } }],
      });
      expect(outcome).toEqual({ applied: false, reason: 'record: nothing memorable.' });
    }
  });

  it('skips malformed envelopes entries (non-objects, bad payloads)', () => {
    for (const event of [
      7,
      null,
      [],
      orderEvent({ payload: null }),
      orderEvent({ payload: [] }),
      orderEvent({ payload: { player: 'p1' } }),
      orderEvent({ payload: { player: 'p1', commander: 7 } }),
    ]) {
      const outcome = runRecord(staffedState([holder()]), P1, { events: [event] });
      expect(outcome).toEqual({ applied: false, reason: 'record: nothing memorable.' });
    }
  });

  it('skips malformed stamps (bad seq, revision, kind)', () => {
    for (const event of [
      orderEvent({ seq: -1 }),
      orderEvent({ revision: 1.5 }),
      orderEvent({ type: 'ORDER.EXECUTED' }),
    ]) {
      const outcome = runRecord(staffedState([holder()]), P1, { events: [event] });
      expect(outcome).toEqual({ applied: false, reason: 'record: nothing memorable.' });
    }
  });

  it('skips unknown commanders', () => {
    const outcome = runRecord(staffedState([holder()]), P1, {
      events: [orderEvent({ payload: { player: 'p1', commander: 'c9' } })],
    });
    expect(outcome).toEqual({ applied: false, reason: 'record: nothing memorable.' });
  });

  it('writes own logs only (anti-spam: enemy entries die, own survive)', () => {
    const state = staffedState([holder(), { id: 'e0', owner: 'p2', active: true }]);
    const outcome = runRecord(state, P1, {
      events: [
        orderEvent({ seq: 5, payload: { player: 'p1', commander: 'c0' } }),
        orderEvent({ seq: 6, payload: { player: 'p2', commander: 'e0' } }),
      ],
    });
    expect(outcome.applied === true ? outcome.summary : undefined).toBe('recorded 1 memory');
    if (outcome.applied !== true) {
      throw new Error('TEST BUG: mixed record must apply');
    }
    const records = outcome.state.commanders?.commanders ?? [];
    expect(records.find((record) => record.id === 'c0')?.memories).toHaveLength(1);
    expect(records.find((record) => record.id === 'e0')?.memories).toBeUndefined();
  });

  it('rejects pure enemy batches', () => {
    const outcome = runRecord(staffedState([{ id: 'e0', owner: 'p2', active: true }]), P1, {
      events: [orderEvent({ payload: { player: 'p2', commander: 'e0' } })],
    });
    expect(outcome).toEqual({ applied: false, reason: 'record: nothing memorable.' });
  });

  it('dedups by seq (replays reject, in-batch twins collapse)', () => {
    const logged = holder({
      memories: [{ seq: 5, revision: 2, kind: 'order.executed', subject: 'c0' }],
    });
    expect(runRecord(staffedState([logged]), P1, { events: [orderEvent()] })).toEqual({
      applied: false,
      reason: 'record: nothing memorable.',
    });
    const outcome = runRecord(staffedState([holder()]), P1, {
      events: [orderEvent(), orderEvent()],
    });
    expect(outcome.applied === true ? outcome.summary : undefined).toBe('recorded 1 memory');
  });

  it('evicts the oldest memory past the cap of 8 (FIFO forget)', () => {
    const full = holder({
      memories: Array.from({ length: 8 }, (_, seq) => ({
        seq: seq + 1,
        revision: 1,
        kind: 'order.executed' as const,
        subject: 'c0',
      })),
    });
    const outcome = runRecord(staffedState([full]), P1, {
      events: [orderEvent({ seq: 9 })],
    });
    if (outcome.applied !== true) {
      throw new Error('TEST BUG: capped record must apply');
    }
    const memories =
      outcome.state.commanders?.commanders.find((record) => record.id === 'c0')?.memories ?? [];
    expect(memories.map((entry) => entry.seq)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('rejects when no commanders ride the state', () => {
    const bare = createWorldState({ players: [P1, P2] });
    expect(runRecord(bare, P1, { events: [orderEvent()] })).toEqual({
      applied: false,
      reason: 'record: nothing memorable.',
    });
  });

  it('stays total on defensive envelopes (rule gates, handler never throws)', () => {
    const state = staffedState([holder()]);
    for (const params of [7, null, [], { events: 'nope' }, { note: 'extra' }]) {
      expect(runRecord(state, P1, params)).toEqual({
        applied: false,
        reason: 'record: nothing memorable.',
      });
    }
  });
});

describe('record bounds (exported)', () => {
  it('locks the transition name and the envelope ceiling', () => {
    expect(RECORD_TRANSITION).toBe('memory.record');
    expect(MAX_RECORD_EVENTS).toBe(32);
  });
});
