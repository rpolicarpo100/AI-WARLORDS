import { describe, expect, it } from 'vitest';
import {
  AuthorityKernel,
  markUntrusted,
  type ClientRequest,
  type PlayerId,
  type Untrusted,
} from './authority.js';
import { harnessHandlers, initialHarnessState, type HarnessState } from './harness.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

/** Simulates untrusted wire bytes: unknown input, marked at the boundary. */
function raw(value: unknown): Untrusted<ClientRequest> {
  return markUntrusted(value as ClientRequest);
}

function makeHarness(): AuthorityKernel<HarnessState> {
  return new AuthorityKernel<HarnessState>({
    players: [P1, P2],
    initialState: initialHarnessState(),
    handlers: harnessHandlers(),
  });
}

describe('harvest (server-computed outcomes)', () => {
  it('grants the server-side yield and ignores every client outcome field', () => {
    const kernel = makeHarness();
    const session = kernel.join(P1);

    const outcome = kernel.dispatch(
      session,
      raw({
        requestId: 'r1',
        playerId: 'p1',
        type: 'harvest',
        payload: { nodeId: 'node-a', yield: 999999, amount: -5, bonus: 'yes', tick: 100 },
      }),
    );

    expect(outcome).toEqual({
      status: 'applied',
      revision: 1,
      summary: 'harvested node-a for +3',
    });
    expect(kernel.getSnapshot()).toEqual({
      tick: 1,
      yields: { 'node-a': 3, 'node-b': 7 },
      balances: { p1: 3 },
    });
  });

  it('tracks per-player balances independently', () => {
    const kernel = makeHarness();
    kernel.dispatch(
      kernel.join(P1),
      raw({ requestId: 'r1', playerId: 'p1', type: 'harvest', payload: { nodeId: 'node-a' } }),
    );
    kernel.dispatch(
      kernel.join(P2),
      raw({ requestId: 'r2', playerId: 'p2', type: 'harvest', payload: { nodeId: 'node-b' } }),
    );

    expect(kernel.getSnapshot()).toEqual({
      tick: 2,
      yields: { 'node-a': 3, 'node-b': 7 },
      balances: { p1: 3, p2: 7 },
    });
    expect(kernel.getRevision()).toBe(2);
  });

  it('accumulates across harvests with fresh request ids', () => {
    const kernel = makeHarness();
    const session = kernel.join(P1);
    kernel.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'harvest', payload: { nodeId: 'node-a' } }),
    );
    kernel.dispatch(
      session,
      raw({ requestId: 'r2', playerId: 'p1', type: 'harvest', payload: { nodeId: 'node-a' } }),
    );

    expect(kernel.getSnapshot().balances).toEqual({ p1: 6 });
    expect(kernel.getSnapshot().tick).toBe(2);
  });

  it('rejects unknown nodes without touching state, and records the rejection', () => {
    const kernel = makeHarness();
    const session = kernel.join(P1);
    const before = kernel.getSnapshot();

    const outcome = kernel.dispatch(
      session,
      raw({
        requestId: 'r1',
        playerId: 'p1',
        type: 'harvest',
        payload: { nodeId: 'node-zzz' },
      }),
    );

    expect(outcome).toEqual({ status: 'rejected', reason: 'harvest: unknown node "node-zzz"' });
    expect(kernel.getSnapshot()).toBe(before);
    expect(kernel.getRevision()).toBe(0);
    expect(kernel.getLog()).toEqual([
      {
        revision: 0,
        requestId: 'r1',
        playerId: 'p1',
        type: 'harvest',
        applied: false,
        detail: 'harvest: unknown node "node-zzz"',
      },
    ]);
    // Rejections are recorded: the duplicate returns the original rejection.
    expect(
      kernel.dispatch(
        session,
        raw({
          requestId: 'r1',
          playerId: 'p1',
          type: 'harvest',
          payload: { nodeId: 'node-zzz' },
        }),
      ),
    ).toEqual({ status: 'duplicate', original: outcome });
    expect(kernel.getLog()).toHaveLength(1);
  });

  it.each([
    ['string params', 'x', 'harvest: params must be an object'],
    ['null params', null, 'harvest: params must be an object'],
    ['missing nodeId', {}, 'harvest: nodeId must be a non-empty string'],
    ['numeric nodeId', { nodeId: 42 }, 'harvest: nodeId must be a non-empty string'],
    ['empty nodeId', { nodeId: '' }, 'harvest: nodeId must be a non-empty string'],
  ] as Array<[string, unknown, string]>)(
    'rejects invalid harvest params: %s',
    (_title, payload, reason) => {
      const kernel = makeHarness();
      const session = kernel.join(P1);

      expect(
        kernel.dispatch(
          session,
          raw({ requestId: 'r1', playerId: 'p1', type: 'harvest', payload }),
        ),
      ).toEqual({ status: 'rejected', reason });
      expect(kernel.getRevision()).toBe(0);
    },
  );
});

describe('noop (plumbing + audit)', () => {
  it('applies without changing state, bumps revision, and keeps the same reference', () => {
    const kernel = makeHarness();
    const session = kernel.join(P1);
    const before = kernel.getSnapshot();

    expect(
      kernel.dispatch(session, raw({ requestId: 'r1', playerId: 'p1', type: 'noop', payload: {} })),
    ).toEqual({
      status: 'applied',
      revision: 1,
      summary: 'noop',
    });
    expect(kernel.getSnapshot()).toBe(before);
    expect(kernel.getLog()).toHaveLength(1);
  });
});

describe('harness state integrity', () => {
  it('shares the frozen server table across transitions (structural sharing)', () => {
    const kernel = makeHarness();
    const session = kernel.join(P1);
    const before = kernel.getSnapshot();

    kernel.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'harvest', payload: { nodeId: 'node-a' } }),
    );
    const after = kernel.getSnapshot();

    expect(after.yields).toBe(before.yields);
    expect(Object.isFrozen(after.yields)).toBe(true);
    expect(Object.isFrozen(after.balances)).toBe(true);
    expect(() => {
      (after as { tick: number }).tick = 99;
    }).toThrow(TypeError);
  });

  it('is deterministic: identical op sequences yield identical snapshots and logs', () => {
    const run = (): AuthorityKernel<HarnessState> => {
      const kernel = makeHarness();
      const s1 = kernel.join(P1);
      kernel.dispatch(
        s1,
        raw({ requestId: 'r1', playerId: 'p1', type: 'harvest', payload: { nodeId: 'node-a' } }),
      );
      kernel.dispatch(s1, raw({ requestId: 'r2', playerId: 'p1', type: 'noop', payload: {} }));
      kernel.dispatch(
        s1,
        raw({ requestId: 'r3', playerId: 'p1', type: 'harvest', payload: { nodeId: 'node-b' } }),
      );
      return kernel;
    };

    const first = run();
    const second = run();
    expect(second.getSnapshot()).toEqual(first.getSnapshot());
    expect(second.getLog()).toEqual(first.getLog());
  });
});
