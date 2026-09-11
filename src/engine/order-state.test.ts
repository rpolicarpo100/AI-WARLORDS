/**
 * M044 — Order queue tests: issue/cancel registration, wire-shape rules,
 * FIFO mechanics, owner-only fail-closed, structural producers (D-038).
 * Per-kind executable semantics belong to M045 (L2↛L2, declared cut).
 */
import { describe, expect, it } from 'vitest';
import { markUntrusted, type ClientRequest, type PlayerId, type Untrusted } from './authority.js';
import type { CommanderOrder, CommanderOrderKind, CommandersData } from './commanders.js';
import { Match, STANDARD_RULESET } from './match.js';
import {
  CANCEL_TRANSITION,
  ISSUE_TRANSITION,
  issueParamsRule,
  orderCanceledProducer,
  orderHandlers,
  orderIssuedProducer,
} from './order-state.js';
import { createWorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

/** Simulates untrusted wire bytes: unknown input, marked at the boundary. */
function raw(value: unknown): Untrusted<ClientRequest> {
  return markUntrusted(value as ClientRequest);
}

function staffed(): CommandersData {
  return {
    schemaVersion: 1,
    nextId: 2,
    commanders: [
      { id: 'c0', owner: 'p1', active: true, personality: 'strategist', doctrine: 'turtle' },
      { id: 'c1', owner: 'p2', active: true },
    ],
  };
}

function stateMatch(commanders?: CommandersData): Match {
  return new Match({
    seed: 44,
    ruleset: STANDARD_RULESET,
    players: [P1, P2],
    initialState: createWorldState({
      players: [P1, P2],
      ...(commanders === undefined ? {} : { commanders }),
    }),
  });
}

function issue(match: Match, rid: string, player: PlayerId, payload: unknown) {
  return match.dispatch(
    match.join(player),
    raw({ requestId: rid, playerId: player, type: ISSUE_TRANSITION, payload }),
  );
}

function cancel(match: Match, rid: string, player: PlayerId, payload: unknown) {
  return match.dispatch(
    match.join(player),
    raw({ requestId: rid, playerId: player, type: CANCEL_TRANSITION, payload }),
  );
}

function ordersOf(match: Match, id: string): ReadonlyArray<CommanderOrder> {
  return match.getSnapshot().commanders?.commanders.find((r) => r.id === id)?.orders ?? [];
}

function orderFacts(match: Match): Array<{ type: string; payload: unknown }> {
  return match
    .getEvents()
    .filter((e) => e.type === 'order.issued' || e.type === 'order.canceled')
    .map((e) => ({ type: e.type, payload: e.payload }));
}

describe('order handlers (registration)', () => {
  it('exposes exactly the two order transitions', () => {
    expect([...orderHandlers().keys()].sort()).toEqual([CANCEL_TRANSITION, ISSUE_TRANSITION]);
  });

  it('transition names are stable (wire contract)', () => {
    expect(ISSUE_TRANSITION).toBe('order.issue');
    expect(CANCEL_TRANSITION).toBe('order.cancel');
  });
});

describe('issueParamsRule (unit)', () => {
  it('accepts minimal and full shapes', () => {
    expect(issueParamsRule(P1, { id: 'c0', kind: 'unit.move' })).toBeNull();
    expect(issueParamsRule(P1, { id: 'c0', kind: 'unit.move', params: { id: 'u1' } })).toBeNull();
  });

  it.each([null, [], 'c0', 7])('rejects non-object params %p', (params) => {
    expect(issueParamsRule(P1, params)).toEqual({
      rule: 'issue-params',
      detail: 'issue takes { id, kind, params? }',
    });
  });

  it.each([{}, { id: 7, kind: 'unit.move' }, { id: 'c0', kind: 7 }, { id: 'c0' }])(
    'rejects non-string id/kind %p',
    (params) => {
      expect(issueParamsRule(P1, params)).toEqual({
        rule: 'issue-params',
        detail: 'issue takes { id string, kind string }',
      });
    },
  );

  it.each([[], 'x', 5, null])('rejects non-object params arg %p', (args) => {
    expect(issueParamsRule(P1, { id: 'c0', kind: 'unit.move', params: args })).toEqual({
      rule: 'issue-params',
      detail: 'issue params must be an object',
    });
  });
});

describe('issue (dispatch)', () => {
  it('appends one envelope-valid order with its params', () => {
    const match = stateMatch(staffed());
    expect(
      issue(match, 'r1', P1, { id: 'c0', kind: 'unit.move', params: { id: 'u1', col: 1, row: 2 } }),
    ).toMatchObject({ status: 'applied' });
    expect(match.getSnapshot().commanders?.commanders[0]?.orders).toEqual([
      { kind: 'unit.move', params: { id: 'u1', col: 1, row: 2 } },
    ]);
    expect(orderFacts(match)).toEqual([
      {
        type: 'order.issued',
        payload: { player: 'p1', commander: 'c0', kind: 'unit.move', depth: 1 },
      },
    ]);
  });

  it('is FIFO: three issues keep array order and report depths 1-2-3', () => {
    const match = stateMatch(staffed());
    expect(issue(match, 'r1', P1, { id: 'c0', kind: 'unit.move' })).toMatchObject({
      status: 'applied',
    });
    expect(
      issue(match, 'r2', P1, { id: 'c0', kind: 'city.build', params: { type: 'house' } }),
    ).toMatchObject({
      status: 'applied',
    });
    expect(
      issue(match, 'r3', P1, { id: 'c0', kind: 'economy.gather', params: { col: 0, row: 0 } }),
    ).toMatchObject({
      status: 'applied',
    });
    expect(ordersOf(match, 'c0').map((o) => o.kind)).toEqual([
      'unit.move',
      'city.build',
      'economy.gather',
    ]);
    expect(ordersOf(match, 'c1')).toEqual([]);
    expect(orderFacts(match).map((f) => f.payload)).toEqual([
      { player: 'p1', commander: 'c0', kind: 'unit.move', depth: 1 },
      { player: 'p1', commander: 'c0', kind: 'city.build', depth: 2 },
      { player: 'p1', commander: 'c0', kind: 'economy.gather', depth: 3 },
    ]);
  });

  it('duplicates apply (queue position matters)', () => {
    const match = stateMatch(staffed());
    const payload = { id: 'c0', kind: 'unit.attack', params: { id: 'u1', target: 'u9' } };
    expect(issue(match, 'r1', P1, payload)).toMatchObject({ status: 'applied' });
    expect(issue(match, 'r2', P1, payload)).toMatchObject({ status: 'applied' });
    expect(ordersOf(match, 'c0')).toHaveLength(2);
  });

  it('unknown commander fails closed (absent roster and unknown id)', () => {
    const bare = stateMatch();
    expect(issue(bare, 'r1', P1, { id: 'c0', kind: 'unit.move' })).toEqual({
      status: 'rejected',
      reason: 'issue: unknown commander.',
    });
    expect(bare.getSnapshot().commanders).toBeUndefined();
    const match = stateMatch(staffed());
    expect(issue(match, 'r1', P1, { id: 'c9', kind: 'unit.move' })).toEqual({
      status: 'rejected',
      reason: 'issue: unknown commander.',
    });
  });

  it('cross-holder issue fails closed', () => {
    const match = stateMatch(staffed());
    expect(issue(match, 'r1', P2, { id: 'c0', kind: 'unit.move' })).toEqual({
      status: 'rejected',
      reason: 'issue: not owner.',
    });
    expect(ordersOf(match, 'c0')).toEqual([]);
  });

  it('unknown kind fails closed (cut verbs and garbage)', () => {
    const match = stateMatch(staffed());
    for (const kind of ['city.upgrade', 'commander.commission', 'world.noop', 'unit.dance', '']) {
      expect(issue(match, `r-${kind}`, P1, { id: 'c0', kind })).toEqual({
        status: 'rejected',
        reason: 'issue: unknown kind.',
      });
    }
    expect(ordersOf(match, 'c0')).toEqual([]);
    expect(orderFacts(match)).toEqual([]);
  });

  it('malformed envelope params fail closed', () => {
    const match = stateMatch(staffed());
    const bad = [
      { nested: {} },
      { n: Number.NaN },
      { id: 'u'.repeat(65) },
      { k0: 0, k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6, k7: 7, k8: 8 },
    ];
    for (const [i, params] of bad.entries()) {
      expect(issue(match, `r${i}`, P1, { id: 'c0', kind: 'unit.move', params })).toEqual({
        status: 'rejected',
        reason: 'issue: bad params.',
      });
    }
    expect(ordersOf(match, 'c0')).toEqual([]);
  });

  it('full queue fails closed at eight (ninth rejects)', () => {
    const match = stateMatch(staffed());
    for (let i = 0; i < 8; i += 1) {
      expect(issue(match, `r${i}`, P1, { id: 'c0', kind: 'unit.move' })).toMatchObject({
        status: 'applied',
      });
    }
    expect(issue(match, 'r8', P1, { id: 'c0', kind: 'unit.move' })).toEqual({
      status: 'rejected',
      reason: 'issue: queue full.',
    });
    expect(ordersOf(match, 'c0')).toHaveLength(8);
  });

  it('wire-shape abuse is rejected at the pre-rule (nothing stored)', () => {
    const match = stateMatch(staffed());
    expect(issue(match, 'r1', P1, 7)).toEqual({
      status: 'rejected',
      reason: 'validation: [issue-params] issue takes { id, kind, params? }',
    });
    expect(issue(match, 'r2', P1, { id: 'c0' })).toEqual({
      status: 'rejected',
      reason: 'validation: [issue-params] issue takes { id string, kind string }',
    });
    expect(issue(match, 'r3', P1, { id: 'c0', kind: 'unit.move', params: [] })).toEqual({
      status: 'rejected',
      reason: 'validation: [issue-params] issue params must be an object',
    });
    expect(ordersOf(match, 'c0')).toEqual([]);
  });
});

describe('cancel (dispatch)', () => {
  it('clears the whole queue and reports the cleared count', () => {
    const match = stateMatch(staffed());
    expect(issue(match, 'r1', P1, { id: 'c0', kind: 'unit.move' })).toMatchObject({
      status: 'applied',
    });
    expect(issue(match, 'r2', P1, { id: 'c0', kind: 'city.build' })).toMatchObject({
      status: 'applied',
    });
    expect(cancel(match, 'r3', P1, { id: 'c0' })).toMatchObject({ status: 'applied' });
    expect(match.getSnapshot().commanders?.commanders[0]?.orders).toEqual([]);
    expect(orderFacts(match)).toEqual([
      {
        type: 'order.issued',
        payload: { player: 'p1', commander: 'c0', kind: 'unit.move', depth: 1 },
      },
      {
        type: 'order.issued',
        payload: { player: 'p1', commander: 'c0', kind: 'city.build', depth: 2 },
      },
      {
        type: 'order.canceled',
        payload: { player: 'p1', commander: 'c0', cleared: 2 },
      },
    ]);
  });

  it('cancel on an empty queue fails closed (absent and drained)', () => {
    const match = stateMatch(staffed());
    expect(cancel(match, 'r1', P1, { id: 'c0' })).toEqual({
      status: 'rejected',
      reason: 'cancel: no orders.',
    });
    expect(issue(match, 'r2', P1, { id: 'c0', kind: 'unit.move' })).toMatchObject({
      status: 'applied',
    });
    expect(cancel(match, 'r3', P1, { id: 'c0' })).toMatchObject({ status: 'applied' });
    expect(cancel(match, 'r4', P1, { id: 'c0' })).toEqual({
      status: 'rejected',
      reason: 'cancel: no orders.',
    });
  });

  it('unknown commander and cross-holder cancel fail closed', () => {
    const bare = stateMatch();
    expect(cancel(bare, 'r1', P1, { id: 'c0' })).toEqual({
      status: 'rejected',
      reason: 'cancel: unknown commander.',
    });
    const match = stateMatch(staffed());
    expect(cancel(match, 'r1', P1, { id: 'c9' })).toEqual({
      status: 'rejected',
      reason: 'cancel: unknown commander.',
    });
    expect(issue(match, 'r2', P1, { id: 'c0', kind: 'unit.move' })).toMatchObject({
      status: 'applied',
    });
    expect(cancel(match, 'r3', P2, { id: 'c0' })).toEqual({
      status: 'rejected',
      reason: 'cancel: not owner.',
    });
    expect(ordersOf(match, 'c0')).toHaveLength(1);
  });

  it('queue is reusable after cancel', () => {
    const match = stateMatch(staffed());
    expect(issue(match, 'r1', P1, { id: 'c0', kind: 'unit.move' })).toMatchObject({
      status: 'applied',
    });
    expect(cancel(match, 'r2', P1, { id: 'c0' })).toMatchObject({ status: 'applied' });
    expect(issue(match, 'r3', P1, { id: 'c0', kind: 'unit.train' })).toMatchObject({
      status: 'applied',
    });
    expect(ordersOf(match, 'c0').map((o) => o.kind)).toEqual(['unit.train']);
  });

  it('cancel reuses the shared commander-id rule (wire-shape abuse rejected)', () => {
    const match = stateMatch(staffed());
    expect(cancel(match, 'r1', P1, {})).toEqual({
      status: 'rejected',
      reason: 'validation: [commander-id-params] command takes a string id',
    });
  });
});

describe('producers (unit, structural diffs)', () => {
  function seeded(commanders: CommandersData) {
    return createWorldState({ players: [P1, P2], commanders });
  }

  function roster(
    queues: ReadonlyArray<ReadonlyArray<{ kind: CommanderOrderKind }>>,
  ): CommandersData {
    return {
      schemaVersion: 1,
      nextId: queues.length,
      commanders: queues.map((orders, i) => ({
        id: `c${i}`,
        owner: 'p1',
        active: true,
        ...(orders.length === 0 ? {} : { orders: orders.map((o) => ({ kind: o.kind })) }),
      })),
    };
  }

  it('orderIssuedProducer: appended tails become facts in array order, silence otherwise', () => {
    const before = seeded(roster([[{ kind: 'unit.move' }], []]));
    const after = seeded(
      roster([[{ kind: 'unit.move' }, { kind: 'city.build' }, { kind: 'city.build' }], []]),
    );
    expect(orderIssuedProducer({ type: 'x', caller: P1, params: {}, before, after })).toEqual([
      {
        type: 'order.issued',
        priority: 'normal',
        payload: { player: 'p1', commander: 'c0', kind: 'city.build', depth: 3 },
      },
      {
        type: 'order.issued',
        priority: 'normal',
        payload: { player: 'p1', commander: 'c0', kind: 'city.build', depth: 3 },
      },
    ]);
    expect(
      orderIssuedProducer({ type: 'x', caller: P1, params: {}, before: after, after }),
    ).toEqual([]);
  });

  it('orderCanceledProducer: full clears become facts, shrinks and steady state stay silent', () => {
    const before = seeded(
      roster([[{ kind: 'unit.move' }, { kind: 'city.build' }], [{ kind: 'unit.train' }]]),
    );
    const cleared = seeded(roster([[], [{ kind: 'unit.train' }]]));
    expect(
      orderCanceledProducer({ type: 'x', caller: P1, params: {}, before, after: cleared }),
    ).toEqual([
      {
        type: 'order.canceled',
        priority: 'normal',
        payload: { player: 'p1', commander: 'c0', cleared: 2 },
      },
    ]);
    const shrunk = seeded(roster([[{ kind: 'unit.move' }], [{ kind: 'unit.train' }]]));
    expect(
      orderCanceledProducer({ type: 'x', caller: P1, params: {}, before, after: shrunk }),
    ).toEqual([]);
    expect(
      orderCanceledProducer({ type: 'x', caller: P1, params: {}, before, after: before }),
    ).toEqual([]);
  });
});

describe('producers (absent sections stay silent)', () => {
  const empty = createWorldState({ players: [P1, P2] });
  const seeded = createWorldState({
    players: [P1, P2],
    commanders: {
      schemaVersion: 1,
      nextId: 1,
      commanders: [{ id: 'c0', owner: 'p1', active: true, orders: [{ kind: 'unit.move' }] }],
    },
  });

  it('both producers stay silent without commander sections', () => {
    expect(
      orderIssuedProducer({ type: 'x', caller: P1, params: {}, before: empty, after: empty }),
    ).toEqual([]);
    expect(
      orderCanceledProducer({ type: 'x', caller: P1, params: {}, before: empty, after: empty }),
    ).toEqual([]);
  });

  it('newborn records without a before-entry stay silent (births are not clears)', () => {
    expect(
      orderCanceledProducer({ type: 'x', caller: P1, params: {}, before: empty, after: seeded }),
    ).toEqual([]);
  });

  it('births without queues and vanished sections stay silent', () => {
    expect(
      orderIssuedProducer({ type: 'x', caller: P1, params: {}, before: empty, after: seeded }),
    ).toEqual([
      {
        type: 'order.issued',
        priority: 'normal',
        payload: { player: 'p1', commander: 'c0', kind: 'unit.move', depth: 1 },
      },
    ]);
    expect(
      orderCanceledProducer({ type: 'x', caller: P1, params: {}, before: seeded, after: empty }),
    ).toEqual([]);
  });
});

describe('order lifecycle integration', () => {
  it('issue → issue → cancel journeys with zero producer faults', () => {
    const match = stateMatch(staffed());
    expect(issue(match, 'r1', P1, { id: 'c0', kind: 'unit.move' })).toMatchObject({
      status: 'applied',
    });
    expect(issue(match, 'r2', P2, { id: 'c1', kind: 'unit.train' })).toMatchObject({
      status: 'applied',
    });
    expect(cancel(match, 'r3', P1, { id: 'c0' })).toMatchObject({ status: 'applied' });
    expect(orderFacts(match).map((f) => f.type)).toEqual([
      'order.issued',
      'order.issued',
      'order.canceled',
    ]);
    expect(match.getEvents().filter((e) => e.type === 'system.event-fault')).toEqual([]);
    expect(ordersOf(match, 'c0')).toEqual([]);
    expect(ordersOf(match, 'c1').map((o) => o.kind)).toEqual(['unit.train']);
  });
});
