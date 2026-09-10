import { describe, expect, it } from 'vitest';
import {
  AuthorityKernel,
  markUntrusted,
  type ClientRequest,
  type PlayerId,
  type Untrusted,
} from './authority.js';
import { createWorldState, isWorldState, worldHandlers, type WorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

/** Simulates untrusted wire bytes: unknown input, marked at the boundary. */
function raw(value: unknown): Untrusted<ClientRequest> {
  return markUntrusted(value as ClientRequest);
}

function rawState(patch: Record<string, unknown>): unknown {
  return {
    schemaVersion: 1,
    tick: 0,
    players: [{ id: 'p1' }],
    secrets: {},
    ...patch,
  };
}

describe('isWorldState (unit: single-path schema guard)', () => {
  it('accepts a complete valid world', () => {
    expect(
      isWorldState(
        rawState({
          tick: 7,
          players: [{ id: 'p1' }, { id: 'p2' }],
          secrets: { p1: ['a', 'b'], p2: [] },
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ['null', null],
    ['number', 42],
    ['string', 'x'],
    ['bad version', rawState({ schemaVersion: 2 })],
    ['string tick', rawState({ tick: 'x' })],
    ['float tick', rawState({ tick: 1.5 })],
    ['negative tick', rawState({ tick: -1 })],
    ['missing tick', rawState({ tick: undefined })],
    ['non-array players', rawState({ players: 'x' })],
    ['empty players', rawState({ players: [] })],
    ['numeric player', rawState({ players: [42] })],
    ['null player', rawState({ players: [null] })],
    ['bad player id', rawState({ players: [{ id: '' }] })],
    ['duplicate players', rawState({ players: [{ id: 'p1' }, { id: 'p1' }] })],
    ['numeric secrets', rawState({ secrets: 42 })],
    ['null secrets', rawState({ secrets: null })],
    ['array secrets', rawState({ secrets: [] })],
    ['bad secret owner', rawState({ secrets: { ['x'.repeat(65)]: [] } })],
    ['non-array secret list', rawState({ secrets: { p1: 'x' } })],
    ['non-string secret', rawState({ secrets: { p1: [42] } })],
  ] as Array<[string, unknown]>)('rejects %s', (_title, value) => {
    expect(isWorldState(value)).toBe(false);
  });
});

describe('createWorldState (unit: validated constructor)', () => {
  it('applies defaults for tick and secrets', () => {
    expect(createWorldState({ players: [P1] })).toEqual({
      schemaVersion: 1,
      tick: 0,
      players: [{ id: 'p1' }],
      secrets: {},
    });
  });

  it('echoes explicit tick and secrets', () => {
    expect(createWorldState({ players: [P1], tick: 9, secrets: { p1: ['s'] } })).toEqual({
      schemaVersion: 1,
      tick: 9,
      players: [{ id: 'p1' }],
      secrets: { p1: ['s'] },
    });
  });

  it.each([[[]], [[P1, P1]]] as Array<[PlayerId[]]>)(
    'throws for invalid roster %j (single guard path)',
    (players) => {
      expect(() => createWorldState({ players })).toThrow(/invalid initial world/);
    },
  );

  it.each([[-1], [2.5]] as Array<[number]>)(
    'throws for invalid tick %j (single guard path)',
    (tick) => {
      expect(() => createWorldState({ players: [P1], tick })).toThrow(/invalid initial world/);
    },
  );
});

describe('WorldState inside AuthorityKernel (integration)', () => {
  function makeWorldKernel(): AuthorityKernel<WorldState> {
    return new AuthorityKernel<WorldState>({
      players: [P1, P2],
      initialState: createWorldState({
        players: [P1, P2],
        secrets: { p1: ['p1-plan-alpha'], p2: ['p2-plan-omega'] },
      }),
      handlers: worldHandlers(),
    });
  }

  it('plumbs through dispatch: noop applies, tick untouched (M004 advances no time)', () => {
    const kernel = makeWorldKernel();
    const session = kernel.join(P1);
    const before = kernel.getSnapshot();

    expect(
      kernel.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'world.noop', payload: {} }),
      ),
    ).toEqual({ status: 'applied', revision: 1, summary: 'world-noop' });

    expect(kernel.getSnapshot()).toBe(before);
    expect(kernel.getSnapshot().tick).toBe(0);
    expect(kernel.getLog()).toEqual([
      {
        revision: 1,
        requestId: 'r1',
        playerId: 'p1',
        type: 'world.noop',
        applied: true,
        detail: 'world-noop',
      },
    ]);
  });

  it('is deterministic: identical op sequences yield identical snapshots and logs', () => {
    const run = (): AuthorityKernel<WorldState> => {
      const kernel = makeWorldKernel();
      const session = kernel.join(P1);
      kernel.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'world.noop', payload: {} }),
      );
      return kernel;
    };

    const first = run();
    const second = run();
    expect(second.getSnapshot()).toEqual(first.getSnapshot());
    expect(second.getLog()).toEqual(first.getLog());
  });

  it('keeps session ids out of canonical state and log', () => {
    const kernel = makeWorldKernel();
    const session = kernel.join(P1);
    kernel.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'world.noop', payload: {} }),
    );

    const serialized = JSON.stringify({ state: kernel.getSnapshot(), log: kernel.getLog() });
    expect(serialized).not.toContain(session.sessionId);
  });
});
