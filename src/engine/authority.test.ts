import { describe, expect, it } from 'vitest';
import {
  AuthorityKernel,
  markUntrusted,
  type AppliedEntry,
  type ClientRequest,
  type PlayerId,
  type SessionId,
  type TransitionHandler,
  type Untrusted,
} from './authority.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;
const P3 = 'p3' as PlayerId;

interface CounterState {
  readonly count: number;
  readonly tags: readonly string[];
}

/** Simulates untrusted wire bytes: unknown input, marked at the boundary. */
function raw(value: unknown): Untrusted<ClientRequest> {
  return markUntrusted(value as ClientRequest);
}

function request(
  requestId: string,
  playerId: PlayerId,
  type: string,
  payload: unknown = {},
): Untrusted<ClientRequest> {
  return raw({ requestId, playerId, type, payload });
}

function makeKernel(): AuthorityKernel<CounterState> {
  const entries: Array<[string, TransitionHandler<CounterState>]> = [
    [
      'inc',
      (ctx) => {
        const next = ctx.state.count + 1;
        const tag = typeof ctx.params === 'string' ? ctx.params : 'tick';
        return {
          applied: true,
          state: { count: next, tags: [...ctx.state.tags, tag] },
          summary: `count=${next}`,
        };
      },
    ],
    [
      'boom',
      () => {
        throw new Error('boom');
      },
    ],
    [
      'mutate',
      (ctx) => {
        // Must throw: canonical state is frozen. Compiles (mutable-looking
        // cast), fails at runtime — which is exactly the guarantee under test.
        (ctx.state.tags as string[]).push('evil');
        return { applied: true, state: ctx.state, summary: 'unreachable' };
      },
    ],
    [
      'circular',
      () => {
        const state = { count: 1, tags: [] as string[], self: undefined as unknown };
        state.self = state;
        return { applied: true, state: state as CounterState, summary: 'unreachable' };
      },
    ],
    [
      'mapstate',
      () => ({
        applied: true,
        state: { count: 1, tags: [], extra: new Map<string, number>() } as unknown as CounterState,
        summary: 'unreachable',
      }),
    ],
    [
      'nullproto',
      () => ({
        applied: true,
        state: Object.assign(Object.create(null), { count: 5, tags: ['np'] }) as CounterState,
        summary: 'nullproto',
      }),
    ],
  ];
  return new AuthorityKernel<CounterState>({
    players: [P1, P2],
    initialState: { count: 0, tags: [] },
    handlers: new Map(entries),
  });
}

describe('constructor guards (failure)', () => {
  it('throws for an empty roster', () => {
    expect(
      () =>
        new AuthorityKernel<CounterState>({
          players: [],
          initialState: { count: 0, tags: [] },
          handlers: new Map(),
        }),
    ).toThrow(/at least one player/);
  });

  it('throws for duplicate players', () => {
    expect(
      () =>
        new AuthorityKernel<CounterState>({
          players: [P1, P1],
          initialState: { count: 0, tags: [] },
          handlers: new Map(),
        }),
    ).toThrow(/unique/);
  });

  it('throws for non-cloneable initial state (fail fast, loud)', () => {
    expect(
      () =>
        new AuthorityKernel<CounterState>({
          players: [P1],
          initialState: { count: 0, tags: [], fn: () => 0 } as unknown as CounterState,
          handlers: new Map(),
        }),
    ).toThrow();
  });

  it('throws for non-plain initial state (Map)', () => {
    expect(
      () =>
        new AuthorityKernel<CounterState>({
          players: [P1],
          initialState: { count: 0, tags: [], m: new Map() } as unknown as CounterState,
          handlers: new Map(),
        }),
    ).toThrow(/plain JSON-style data/);
  });

  it('detaches caller-owned input: mutating it later cannot corrupt canonical state', () => {
    const input: { count: number; tags: string[] } = { count: 0, tags: [] };
    const kernel = new AuthorityKernel<CounterState>({
      players: [P1],
      initialState: input,
      handlers: new Map(),
    });

    input.count = 999;
    input.tags.push('corrupt');

    expect(kernel.getSnapshot()).toEqual({ count: 0, tags: [] });
  });

  it('copies the handlers map: later additions are not honored', () => {
    const handlers = new Map<string, TransitionHandler<CounterState>>();
    const kernel = new AuthorityKernel<CounterState>({
      players: [P1],
      initialState: { count: 0, tags: [] },
      handlers,
    });
    handlers.set('evil', (ctx) => ({ applied: true, state: ctx.state, summary: 'evil' }));

    const session = kernel.join(P1);
    expect(kernel.dispatch(session, request('r1', P1, 'evil'))).toEqual({
      status: 'error',
      code: 'UNKNOWN_TRANSITION',
    });
  });

  it('copies the players array: later pushes cannot join', () => {
    const players: PlayerId[] = [P1];
    const kernel = new AuthorityKernel<CounterState>({
      players,
      initialState: { count: 0, tags: [] },
      handlers: new Map(),
    });
    players.push(P2);

    expect(() => kernel.join(P2)).toThrow(/unknown player/);
  });
});

describe('join (sessions)', () => {
  it('throws for unknown players', () => {
    expect(() => makeKernel().join(P3)).toThrow(/unknown player/);
  });

  it('issues distinct opaque sessions per join', () => {
    const kernel = makeKernel();
    const first = kernel.join(P1);
    const second = kernel.join(P1);

    expect(first.sessionId).not.toBe(second.sessionId);
    expect(kernel.dispatch(first, request('r1', P1, 'inc')).status).toBe('applied');
    expect(kernel.dispatch(second, request('r2', P1, 'inc')).status).toBe('applied');
    expect(kernel.getSnapshot().count).toBe(2);
  });
});

describe('dispatch: sessions + envelope (security/failure)', () => {
  it('rejects unknown sessions (INVALID_SESSION)', () => {
    const kernel = makeKernel();
    const forged = { sessionId: 'nope' as SessionId, playerId: P1 };

    expect(kernel.dispatch(forged, request('r1', P1, 'inc'))).toEqual({
      status: 'error',
      code: 'INVALID_SESSION',
    });
    expect(kernel.getRevision()).toBe(0);
    expect(kernel.getLog()).toEqual([]);
  });

  it('rejects tampered handles: valid sessionId + swapped playerId (INVALID_SESSION)', () => {
    const kernel = makeKernel();
    const handle = kernel.join(P1);
    const tampered = { ...handle, playerId: P2 };

    expect(kernel.dispatch(tampered, request('r1', P2, 'inc'))).toEqual({
      status: 'error',
      code: 'INVALID_SESSION',
    });
    expect(kernel.getSnapshot()).toEqual({ count: 0, tags: [] });
  });

  it('rejects spoofed senders, and the requestId stays reusable (SPOOFED_SENDER)', () => {
    const kernel = makeKernel();
    const sessionP1 = kernel.join(P1);
    const sessionP2 = kernel.join(P2);

    expect(kernel.dispatch(sessionP1, request('r-spoof', P2, 'inc'))).toEqual({
      status: 'error',
      code: 'SPOOFED_SENDER',
    });
    // Validation failures are not recorded: the honest retry succeeds.
    expect(kernel.dispatch(sessionP2, request('r-spoof', P2, 'inc'))).toEqual({
      status: 'applied',
      revision: 1,
      summary: 'count=1',
    });
  });

  it.each([
    ['null', null],
    ['number', 42],
    ['string', 'nope'],
    ['empty object', {}],
    ['numeric requestId', { requestId: 42, playerId: 'p1', type: 'inc', payload: {} }],
    ['empty requestId', { requestId: '', playerId: 'p1', type: 'inc', payload: {} }],
    ['long requestId', { requestId: 'r'.repeat(65), playerId: 'p1', type: 'inc', payload: {} }],
    ['numeric playerId', { requestId: 'r1', playerId: 42, type: 'inc', payload: {} }],
    ['empty playerId', { requestId: 'r1', playerId: '', type: 'inc', payload: {} }],
    ['long playerId', { requestId: 'r1', playerId: 'p'.repeat(65), type: 'inc', payload: {} }],
    ['numeric type', { requestId: 'r1', playerId: 'p1', type: 42, payload: {} }],
    ['empty type', { requestId: 'r1', playerId: 'p1', type: '', payload: {} }],
    ['long type', { requestId: 'r1', playerId: 'p1', type: 't'.repeat(65), payload: {} }],
    ['missing payload', { requestId: 'r1', playerId: 'p1', type: 'inc' }],
    ['function payload', { requestId: 'r1', playerId: 'p1', type: 'inc', payload: () => 0 }],
  ] as Array<[string, unknown]>)('rejects malformed envelope: %s', (_title, envelope) => {
    const kernel = makeKernel();
    const session = kernel.join(P1);

    expect(kernel.dispatch(session, raw(envelope))).toEqual({
      status: 'error',
      code: 'MALFORMED_REQUEST',
    });
    expect(kernel.getRevision()).toBe(0);
  });

  it('rejects circular payloads (MALFORMED_REQUEST)', () => {
    const kernel = makeKernel();
    const session = kernel.join(P1);
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    expect(kernel.dispatch(session, request('r1', P1, 'inc', circular))).toEqual({
      status: 'error',
      code: 'MALFORMED_REQUEST',
    });
  });

  it('rejects oversized payloads, with an inclusive 64 KiB boundary', () => {
    const kernel = makeKernel();
    const session = kernel.join(P1);

    // JSON adds 2 quote chars: 65534 chars -> 65536 bytes -> accepted.
    expect(kernel.dispatch(session, request('r-ok', P1, 'inc', 'y'.repeat(65534))).status).toBe(
      'applied',
    );
    // 65535 chars -> 65537 bytes -> rejected.
    expect(kernel.dispatch(session, request('r-big', P1, 'inc', 'z'.repeat(65535)))).toEqual({
      status: 'error',
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('rejects unknown transitions without recording the requestId', () => {
    const kernel = makeKernel();
    const session = kernel.join(P1);

    expect(kernel.dispatch(session, request('r1', P1, 'fly'))).toEqual({
      status: 'error',
      code: 'UNKNOWN_TRANSITION',
    });
    expect(kernel.dispatch(session, request('r1', P1, 'inc')).status).toBe('applied');
  });
});

describe('dispatch: application, faults, atomicity', () => {
  it('applies transitions, freezes state, and writes exact audit entries', () => {
    const kernel = makeKernel();
    const session = kernel.join(P1);

    expect(kernel.dispatch(session, request('r1', P1, 'inc', 'hello'))).toEqual({
      status: 'applied',
      revision: 1,
      summary: 'count=1',
    });

    const snapshot = kernel.getSnapshot();
    expect(snapshot).toEqual({ count: 1, tags: ['hello'] });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.tags)).toBe(true);
    expect(() => {
      (snapshot as { count: number }).count = 99;
    }).toThrow(TypeError);
    expect(() => {
      (snapshot.tags as string[]).push('x');
    }).toThrow(TypeError);

    expect(kernel.getRevision()).toBe(1);
    expect(kernel.getLog()).toEqual([
      {
        revision: 1,
        requestId: 'r1',
        playerId: 'p1',
        type: 'inc',
        applied: true,
        detail: 'count=1',
      },
    ]);
  });

  it('defaults non-string params per server rule (no client control over defaults)', () => {
    const kernel = makeKernel();
    const session = kernel.join(P1);

    kernel.dispatch(session, request('r1', P1, 'inc', { tag: 'ignored-shape' }));
    expect(kernel.getSnapshot().tags).toEqual(['tick']);
  });

  it('serializes interleaved sessions: revisions follow dispatch order (adversarial: concurrency)', () => {
    const kernel = makeKernel();
    const s1 = kernel.join(P1);
    const s2 = kernel.join(P2);

    expect(kernel.dispatch(s1, request('a1', P1, 'inc'))).toEqual({
      status: 'applied',
      revision: 1,
      summary: 'count=1',
    });
    expect(kernel.dispatch(s2, request('b1', P2, 'inc'))).toEqual({
      status: 'applied',
      revision: 2,
      summary: 'count=2',
    });
    expect(kernel.dispatch(s1, request('a2', P1, 'inc'))).toEqual({
      status: 'applied',
      revision: 3,
      summary: 'count=3',
    });
    expect(kernel.getLog().map((entry) => entry.revision)).toEqual([1, 2, 3]);
  });

  it('returns the recorded outcome for duplicates without re-applying (exactly-once)', () => {
    const kernel = makeKernel();
    const session = kernel.join(P1);

    const first = kernel.dispatch(session, request('r1', P1, 'inc'));
    expect(first).toEqual({ status: 'applied', revision: 1, summary: 'count=1' });
    expect(kernel.dispatch(session, request('r1', P1, 'inc'))).toEqual({
      status: 'duplicate',
      original: first,
    });
    expect(kernel.getSnapshot().count).toBe(1);
    expect(kernel.getLog()).toHaveLength(1);
    expect(kernel.getRevision()).toBe(1);
  });

  it('converts handler exceptions to HANDLER_FAULT without recording (boom)', () => {
    const kernel = makeKernel();
    const session = kernel.join(P1);
    const before = kernel.getSnapshot();

    expect(kernel.dispatch(session, request('r1', P1, 'boom'))).toEqual({
      status: 'error',
      code: 'HANDLER_FAULT',
    });
    expect(kernel.getSnapshot()).toBe(before);
    expect(kernel.getRevision()).toBe(0);
    expect(kernel.getLog()).toEqual([]);
    // Faults are not recorded: the retry re-executes (and faults again).
    expect(kernel.dispatch(session, request('r1', P1, 'boom'))).toEqual({
      status: 'error',
      code: 'HANDLER_FAULT',
    });
  });

  it('survives handlers that try to mutate canonical state (mutate)', () => {
    const kernel = makeKernel();
    const session = kernel.join(P1);

    expect(kernel.dispatch(session, request('r1', P1, 'mutate'))).toEqual({
      status: 'error',
      code: 'HANDLER_FAULT',
    });
    expect(kernel.getSnapshot()).toEqual({ count: 0, tags: [] });
    expect(kernel.getRevision()).toBe(0);
  });

  it('keeps atomicity when the new state is unfreezable: nothing commits (circular)', () => {
    const kernel = makeKernel();
    const session = kernel.join(P1);
    kernel.dispatch(session, request('r0', P1, 'inc'));
    const before = kernel.getSnapshot();

    expect(kernel.dispatch(session, request('r1', P1, 'circular'))).toEqual({
      status: 'error',
      code: 'HANDLER_FAULT',
    });
    expect(kernel.getSnapshot()).toBe(before);
    expect(kernel.getRevision()).toBe(1);
    expect(kernel.getLog()).toHaveLength(1);
    // The kernel stays healthy: later dispatches still work.
    expect(kernel.dispatch(session, request('r2', P1, 'inc')).status).toBe('applied');
  });

  it('rejects non-plain handler output (Map) as HANDLER_FAULT', () => {
    const kernel = makeKernel();
    const session = kernel.join(P1);

    expect(kernel.dispatch(session, request('r1', P1, 'mapstate'))).toEqual({
      status: 'error',
      code: 'HANDLER_FAULT',
    });
    expect(kernel.getSnapshot()).toEqual({ count: 0, tags: [] });
  });

  it('accepts null-prototype plain objects and keeps operating on them', () => {
    const kernel = makeKernel();
    const session = kernel.join(P1);

    expect(kernel.dispatch(session, request('r1', P1, 'nullproto'))).toEqual({
      status: 'applied',
      revision: 1,
      summary: 'nullproto',
    });
    expect(kernel.dispatch(session, request('r2', P1, 'inc')).status).toBe('applied');
    expect(kernel.getSnapshot().count).toBe(6);
  });
});

describe('log + snapshots (audit)', () => {
  it('freezes entries and returns the log by copy', () => {
    const kernel = makeKernel();
    const session = kernel.join(P1);
    kernel.dispatch(session, request('r1', P1, 'inc'));

    const copy = kernel.getLog();
    expect(Object.isFrozen(copy[0])).toBe(true);
    const entry = copy[0];
    if (entry === undefined) {
      throw new Error('test setup: expected one log entry');
    }
    (copy as unknown as AppliedEntry[]).push(entry);
    expect(kernel.getLog()).toHaveLength(1);
  });

  it('keeps session ids out of canonical state and log (transport ≠ deterministic state)', () => {
    const kernel = makeKernel();
    const session = kernel.join(P1);
    kernel.dispatch(session, request('r1', P1, 'inc'));

    const serialized = JSON.stringify({ state: kernel.getSnapshot(), log: kernel.getLog() });
    expect(serialized).not.toContain(session.sessionId);
  });
});

describe('determinism (kernel-level, M005 foreshadow)', () => {
  it('produces identical snapshots and logs for identical op sequences', () => {
    const run = (): AuthorityKernel<CounterState> => {
      const kernel = makeKernel();
      const s1 = kernel.join(P1);
      const s2 = kernel.join(P2);
      kernel.dispatch(s1, request('r1', P1, 'inc', 'a'));
      kernel.dispatch(s2, request('r2', P2, 'inc', 'b'));
      kernel.dispatch(s1, request('r3', P1, 'noop-unknown-check'));
      kernel.dispatch(s1, request('r3b', P1, 'inc'));
      return kernel;
    };

    const first = run();
    const second = run();
    expect(second.getSnapshot()).toEqual(first.getSnapshot());
    expect(second.getLog()).toEqual(first.getLog());
  });
});
