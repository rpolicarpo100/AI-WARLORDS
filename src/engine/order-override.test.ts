/**
 * M047 — Order override tests: head substitution over a fresh M046
 * challenge (D-041, voted override-head). Mapless Matches keep the
 * event stream exact (no M030 riders); refutations arrive init-placed
 * (M027 precedent — raise belongs to M048+).
 */
import { describe, expect, it } from 'vitest';
import {
  markUntrusted,
  type ClientRequest,
  type PlayerId,
  type SessionHandle,
  type Untrusted,
} from './authority.js';
import type { CommanderRecord, CommandersData } from './commanders.js';
import { Match, STANDARD_RULESET } from './match.js';
import {
  OVERRIDE_TRANSITION,
  orderOverriddenProducer,
  orderOverrideHandlers,
  overrideParamsRule,
} from './order-override.js';
import { createWorldState, type WorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

function challenged(overrides: Partial<CommanderRecord> = {}): CommanderRecord {
  return {
    id: 'c0',
    owner: 'p1',
    active: true,
    orders: [
      { kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } },
      { kind: 'economy.gather', params: { col: 0, row: 0 } },
    ],
    refutation: { orderIndex: 0, kind: 'unit.move', reason: 'blocked', by: 'c1' },
    ...overrides,
  };
}

function staffed(match: Match): { match: Match; session: SessionHandle } {
  return { match, session: match.join(P1) };
}

function makeMatch(records: ReadonlyArray<CommanderRecord>): Match {
  const commanders: CommandersData = { schemaVersion: 1, nextId: 2, commanders: [...records] };
  return new Match({
    seed: 47,
    ruleset: STANDARD_RULESET,
    players: [P1, P2],
    initialState: createWorldState({ players: [P1, P2], commanders }),
  });
}

function dispatch(
  match: Match,
  session: SessionHandle,
  requestId: string,
  player: PlayerId,
  payload: unknown,
): { status: string; reason?: string } {
  const req = markUntrusted({
    requestId,
    playerId: player,
    type: OVERRIDE_TRANSITION,
    payload,
  } as ClientRequest) as Untrusted<ClientRequest>;
  const outcome = match.dispatch(session, req);
  return outcome.status === 'rejected'
    ? { status: outcome.status, reason: outcome.reason }
    : { status: outcome.status };
}

function queueOf(match: Match, id: string): unknown {
  return match.getSnapshot().commanders?.commanders.find((r) => r.id === id)?.orders ?? [];
}

function refutationOf(match: Match, id: string): unknown {
  return match.getSnapshot().commanders?.commanders.find((r) => r.id === id)?.refutation;
}

describe('order override (registration)', () => {
  it('registers exactly the override transition', () => {
    expect([...orderOverrideHandlers().keys()]).toEqual([OVERRIDE_TRANSITION]);
    expect(OVERRIDE_TRANSITION).toBe('order.override');
  });

  it('routes through the Match (unknown commander, never UNKNOWN_TRANSITION)', () => {
    const { match, session } = staffed(makeMatch([]));
    expect(dispatch(match, session, 'r1', P1, { id: 'c9', kind: 'unit.move' })).toEqual({
      status: 'rejected',
      reason: 'override: unknown commander.',
    });
  });
});

describe('override journeys (substitute the challenged head)', () => {
  it('replaces the head, clears the challenge, emits one exact fact', () => {
    const { match, session } = staffed(makeMatch([challenged()]));
    const before = match.getEvents().length;
    expect(
      dispatch(match, session, 'r1', P1, {
        id: 'c0',
        kind: 'unit.attack',
        params: { id: 'u0', target: 'u9' },
      }),
    ).toEqual({ status: 'applied' });
    expect(queueOf(match, 'c0')).toEqual([
      { kind: 'unit.attack', params: { id: 'u0', target: 'u9' } },
      { kind: 'economy.gather', params: { col: 0, row: 0 } },
    ]);
    expect(refutationOf(match, 'c0')).toBeUndefined();
    expect(match.getEvents().slice(before)).toMatchObject([
      {
        type: 'order.overridden',
        priority: 'normal',
        payload: {
          player: 'p1',
          commander: 'c0',
          kind: 'unit.attack',
          over: 'unit.move',
          reason: 'blocked',
        },
      },
    ]);
  });

  it('stores substitutes without params as kind-only', () => {
    const { match, session } = staffed(makeMatch([challenged()]));
    expect(dispatch(match, session, 'r1', P1, { id: 'c0', kind: 'city.build' })).toEqual({
      status: 'applied',
    });
    expect(queueOf(match, 'c0')).toEqual([
      { kind: 'city.build' },
      { kind: 'economy.gather', params: { col: 0, row: 0 } },
    ]);
  });

  it('allows same-kind substitutes (the challenge is still consumed)', () => {
    const { match, session } = staffed(makeMatch([challenged()]));
    expect(
      dispatch(match, session, 'r1', P1, {
        id: 'c0',
        kind: 'unit.move',
        params: { id: 'u0', col: 2, row: 0 },
      }),
    ).toEqual({ status: 'applied' });
    expect(queueOf(match, 'c0')).toEqual([
      { kind: 'unit.move', params: { id: 'u0', col: 2, row: 0 } },
      { kind: 'economy.gather', params: { col: 0, row: 0 } },
    ]);
    expect(refutationOf(match, 'c0')).toBeUndefined();
  });

  it('honours self-challenges (by may equal the holder)', () => {
    const record = challenged({
      refutation: { orderIndex: 0, kind: 'unit.move', reason: 'redundant', by: 'c0' },
    });
    const { match, session } = staffed(makeMatch([record]));
    expect(dispatch(match, session, 'r1', P1, { id: 'c0', kind: 'unit.train' })).toEqual({
      status: 'applied',
    });
    expect(refutationOf(match, 'c0')).toBeUndefined();
  });

  it('leaves bystander commanders untouched', () => {
    const other: CommanderRecord = {
      id: 'c1',
      owner: 'p2',
      active: true,
      orders: [{ kind: 'unit.move' }],
      refutation: { orderIndex: 0, kind: 'unit.move', reason: 'suicidal', by: 'c0' },
    };
    const { match, session } = staffed(makeMatch([challenged(), other]));
    expect(dispatch(match, session, 'r1', P1, { id: 'c0', kind: 'unit.train' })).toEqual({
      status: 'applied',
    });
    expect(queueOf(match, 'c1')).toEqual([{ kind: 'unit.move' }]);
    expect(refutationOf(match, 'c1')).toEqual({
      orderIndex: 0,
      kind: 'unit.move',
      reason: 'suicidal',
      by: 'c0',
    });
  });
});

describe('override fail-closed (queue and challenge intact)', () => {
  function rejectedFixture(record: CommanderRecord, payload: unknown, reason: string): void {
    const { match, session } = staffed(makeMatch([record]));
    const beforeEvents = match.getEvents().length;
    const beforeQueue = queueOf(match, 'c0');
    const beforeRefutation = refutationOf(match, 'c0');
    expect(dispatch(match, session, 'r1', P1, payload)).toEqual({ status: 'rejected', reason });
    expect(queueOf(match, 'c0')).toEqual(beforeQueue);
    expect(refutationOf(match, 'c0')).toEqual(beforeRefutation);
    expect(match.getEvents().length).toBe(beforeEvents);
  }

  it('rejects not-owner callers', () => {
    const match = makeMatch([challenged()]);
    const s2 = match.join(P2);
    const req = markUntrusted({
      requestId: 'r1',
      playerId: P2,
      type: OVERRIDE_TRANSITION,
      payload: { id: 'c0', kind: 'unit.move' },
    } as ClientRequest) as Untrusted<ClientRequest>;
    expect(match.dispatch(s2, req)).toEqual({ status: 'rejected', reason: 'override: not owner.' });
  });

  it('rejects unchallenged queues', () => {
    const plain: CommanderRecord = {
      id: 'c0',
      owner: 'p1',
      active: true,
      orders: [{ kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } }],
    };
    rejectedFixture(plain, { id: 'c0', kind: 'unit.move' }, 'override: no refutation.');
  });

  it('rejects tail-anchored challenges (head only)', () => {
    const record = challenged({
      refutation: { orderIndex: 1, kind: 'economy.gather', reason: 'blocked', by: 'c1' },
    });
    rejectedFixture(record, { id: 'c0', kind: 'unit.move' }, 'override: not head.');
  });

  it('rejects empty queues (challenge outlived its orders)', () => {
    const record = challenged({ orders: [] });
    rejectedFixture(record, { id: 'c0', kind: 'unit.move' }, 'override: queue empty.');
  });

  it('rejects absent queues (absent means empty, M044)', () => {
    const record: CommanderRecord = {
      id: 'c0',
      owner: 'p1',
      active: true,
      refutation: { orderIndex: 0, kind: 'unit.move', reason: 'blocked', by: 'c1' },
    };
    rejectedFixture(record, { id: 'c0', kind: 'unit.move' }, 'override: queue empty.');
  });

  it('rejects kind drift (queue moved under the challenge)', () => {
    const record = challenged({
      refutation: { orderIndex: 0, kind: 'unit.attack', reason: 'blocked', by: 'c1' },
    });
    rejectedFixture(record, { id: 'c0', kind: 'unit.move' }, 'override: stale refutation.');
  });

  it('rejects unknown substitute kinds', () => {
    rejectedFixture(challenged(), { id: 'c0', kind: 'city.upgrade' }, 'override: unknown kind.');
  });

  it('rejects envelope-breaking params', () => {
    rejectedFixture(
      challenged(),
      { id: 'c0', kind: 'unit.move', params: { nested: {} } },
      'override: bad params.',
    );
  });
});

describe('override wire-shape (pre-rule)', () => {
  it('pins the rule contract directly', () => {
    expect(overrideParamsRule(P1, { id: 'c0', kind: 'unit.move' })).toBeNull();
    expect(overrideParamsRule(P1, { id: 'c0', kind: 'unit.move', params: { a: 1 } })).toBeNull();
    for (const bad of [7, 'x', null, []]) {
      expect(overrideParamsRule(P1, bad)).toMatchObject({ rule: 'override-params' });
    }
    for (const bad of [{}, { id: 'c0' }, { kind: 'unit.move' }, { id: 7, kind: 'unit.move' }]) {
      expect(overrideParamsRule(P1, bad)).toMatchObject({ rule: 'override-params' });
    }
    for (const bad of [{ id: 'c0', kind: 'unit.move', params: 7 }]) {
      expect(overrideParamsRule(P1, bad)).toMatchObject({ rule: 'override-params' });
    }
  });

  it('rejects bad wire shapes on the dispatch path', () => {
    const { match, session } = staffed(makeMatch([challenged()]));
    expect(dispatch(match, session, 'r1', P1, { id: 'c0' })).toMatchObject({ status: 'rejected' });
  });
});

describe('overridden producer (unit: structural diff)', () => {
  function states(
    before: CommanderRecord | undefined,
    after: CommanderRecord | undefined,
  ): { before: WorldState; after: WorldState } {
    const wrap = (record: CommanderRecord | undefined): WorldState =>
      createWorldState({
        players: [P1, P2],
        commanders:
          record === undefined ? undefined : { schemaVersion: 1, nextId: 1, commanders: [record] },
      });
    return { before: wrap(before), after: wrap(after) };
  }

  function produce(before: CommanderRecord | undefined, after: CommanderRecord | undefined) {
    const { before: b, after: a } = states(before, after);
    return orderOverriddenProducer({
      type: OVERRIDE_TRANSITION,
      caller: P1,
      params: { id: 'c0', kind: 'unit.attack' },
      before: b,
      after: a,
    });
  }

  it('fires exactly on refutation clears with a replaced head', () => {
    const after: CommanderRecord = {
      id: 'c0',
      owner: 'p1',
      active: true,
      orders: [{ kind: 'unit.attack' }],
    };
    expect(produce(challenged(), after)).toEqual([
      {
        type: 'order.overridden',
        priority: 'normal',
        payload: {
          player: 'p1',
          commander: 'c0',
          kind: 'unit.attack',
          over: 'unit.move',
          reason: 'blocked',
        },
      },
    ]);
  });

  it('stays silent without after-commanders', () => {
    expect(produce(challenged(), undefined)).toEqual([]);
  });

  it('stays silent without before-commanders (birth side unknown)', () => {
    const after: CommanderRecord = {
      id: 'c0',
      owner: 'p1',
      active: true,
      orders: [{ kind: 'unit.attack' }],
    };
    expect(produce(undefined, after)).toEqual([]);
  });

  it('stays silent when no challenge stood before', () => {
    const plain: CommanderRecord = {
      id: 'c0',
      owner: 'p1',
      active: true,
      orders: [{ kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } }],
    };
    const after: CommanderRecord = {
      id: 'c0',
      owner: 'p1',
      active: true,
      orders: [{ kind: 'unit.attack' }],
    };
    expect(produce(plain, after)).toEqual([]);
  });

  it('stays silent when the challenge survives', () => {
    expect(produce(challenged(), challenged())).toEqual([]);
  });

  it('stays silent when the before-queue is empty', () => {
    const before = challenged({ orders: [] });
    const after: CommanderRecord = {
      id: 'c0',
      owner: 'p1',
      active: true,
      orders: [{ kind: 'unit.attack' }],
    };
    expect(produce(before, after)).toEqual([]);
  });

  it('stays silent when the after-queue is empty', () => {
    const after: CommanderRecord = {
      id: 'c0',
      owner: 'p1',
      active: true,
      orders: [],
    };
    expect(produce(challenged(), after)).toEqual([]);
  });

  it('stays silent when the after-queue is absent', () => {
    const after: CommanderRecord = { id: 'c0', owner: 'p1', active: true };
    expect(produce(challenged(), after)).toEqual([]);
  });
});

describe('override one-shot (integration)', () => {
  it('consumes the challenge: a second override fails without refutation', () => {
    const { match, session } = staffed(makeMatch([challenged()]));
    expect(dispatch(match, session, 'r1', P1, { id: 'c0', kind: 'unit.attack' })).toEqual({
      status: 'applied',
    });
    expect(dispatch(match, session, 'r2', P1, { id: 'c0', kind: 'unit.train' })).toEqual({
      status: 'rejected',
      reason: 'override: no refutation.',
    });
    expect(queueOf(match, 'c0')).toEqual([
      { kind: 'unit.attack' },
      { kind: 'economy.gather', params: { col: 0, row: 0 } },
    ]);
  });
});
