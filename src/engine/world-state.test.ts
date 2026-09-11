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
    players: [{ id: 'p1' }],
    ...patch,
  };
}

describe('isWorldState (unit: single-path schema guard)', () => {
  it('accepts a complete valid world', () => {
    expect(
      isWorldState(
        rawState({
          players: [{ id: 'p1' }, { id: 'p2' }],
          prompts: { schemaVersion: 1, remaining: { p1: 10, p2: 0 } },
        }),
      ),
    ).toBe(true);
  });

  it('accepts absent prompts (Match seeds at construction)', () => {
    expect(isWorldState(rawState({}))).toBe(true);
  });

  it('ignores the legacy secrets key (M015 migration leniency)', () => {
    expect(isWorldState(rawState({ secrets: { p1: ['x'] } }))).toBe(true);
  });

  it.each([
    ['null', null],
    ['number', 42],
    ['string', 'x'],
    ['bad version', rawState({ schemaVersion: 2 })],
    ['non-object prompts', rawState({ prompts: 42 })],
    ['bad prompts version', rawState({ prompts: { schemaVersion: 2, remaining: {} } })],
    ['negative prompts', rawState({ prompts: { schemaVersion: 1, remaining: { p1: -1 } } })],
    ['non-array players', rawState({ players: 'x' })],
    ['empty players', rawState({ players: [] })],
    ['numeric player', rawState({ players: [42] })],
    ['null player', rawState({ players: [null] })],
    ['bad player id', rawState({ players: [{ id: '' }] })],
    ['duplicate players', rawState({ players: [{ id: 'p1' }, { id: 'p1' }] })],
  ] as Array<[string, unknown]>)('rejects %s', (_title, value) => {
    expect(isWorldState(value)).toBe(false);
  });
});

describe('createWorldState (unit: validated constructor)', () => {
  it('builds the minimal world (no prompts slot until Match seeds)', () => {
    expect(createWorldState({ players: [P1] })).toEqual({
      schemaVersion: 1,
      players: [{ id: 'p1' }],
    });
  });

  it('echoes an explicit prompts slot', () => {
    const prompts = { schemaVersion: 1 as const, remaining: { p1: 5 } };
    expect(createWorldState({ players: [P1], prompts })).toEqual({
      schemaVersion: 1,
      players: [{ id: 'p1' }],
      prompts,
    });
  });

  it.each([[[]], [[P1, P1]]] as Array<[PlayerId[]]>)(
    'throws for invalid roster %j (single guard path)',
    (players) => {
      expect(() => createWorldState({ players })).toThrow(/invalid initial world/);
    },
  );

  it.each(
    [
      [{ schemaVersion: 2, remaining: {} }],
      [{ schemaVersion: 1, remaining: { p1: -1 } }],
      [42],
    ] as Array<[unknown]>,
  )('throws for invalid prompts %j (single guard path)', (prompts) => {
    expect(() => createWorldState({ players: [P1], prompts: prompts as never })).toThrow(
      /invalid initial world/,
    );
  });
});

describe('WorldState inside AuthorityKernel (integration)', () => {
  function makeWorldKernel(): AuthorityKernel<WorldState> {
    return new AuthorityKernel<WorldState>({
      players: [P1, P2],
      initialState: createWorldState({
        players: [P1, P2],
      }),
      handlers: worldHandlers(),
    });
  }

  it('plumbs through dispatch: noop applies, Match seeds no prompts (M004 owns no budget)', () => {
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
    expect(kernel.getSnapshot().prompts).toBeUndefined();
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
