import { describe, expect, it } from 'vitest';
import {
  markUntrusted,
  type ClientRequest,
  type PlayerId,
  type TransitionHandler,
  type Untrusted,
} from './authority.js';
import {
  createMatchId,
  DEFAULT_PROMPTS_PER_PLAYER,
  isMatchId,
  isSeed,
  Match,
  STANDARD_RULESET,
  type MatchInit,
} from './match.js';
import { createWorldState, type WorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;
const P3 = 'p3' as PlayerId;

/** Simulates untrusted wire bytes: unknown input, marked at the boundary. */
function raw(value: unknown): Untrusted<ClientRequest> {
  return markUntrusted(value as ClientRequest);
}

function baseInit(patch: Partial<MatchInit> = {}): MatchInit {
  return {
    seed: 1234,
    ruleset: STANDARD_RULESET,
    players: [P1, P2],
    initialState: createWorldState({ players: [P1, P2] }),
    ...patch,
  };
}

function makeMatch(patch: Partial<MatchInit> = {}): Match {
  return new Match(baseInit(patch));
}

function testHandlers(): Map<string, TransitionHandler<WorldState>> {
  const entries: Array<[string, TransitionHandler<WorldState>]> = [
    ['test.ping', (ctx) => ({ applied: true, state: ctx.state, summary: 'pong' })],
    ['test.reject', () => ({ applied: false, reason: 'nope' })],
  ];
  return new Map(entries);
}

describe('isMatchId / isSeed (unit)', () => {
  it.each([
    [42, false],
    ['', false],
    ['x'.repeat(65), false],
    ['m1', true],
  ] as Array<[unknown, boolean]>)('isMatchId(%j) === %j', (value, expected) => {
    expect(isMatchId(value)).toBe(expected);
  });

  it.each([
    ['x', false],
    [1.5, false],
    [-1, false],
    [4294967296, false],
    [NaN, false],
    [0, true],
    [42, true],
    [4294967295, true],
  ] as Array<[unknown, boolean]>)('isSeed(%j) === %j', (value, expected) => {
    expect(isSeed(value)).toBe(expected);
  });
});

describe('createMatchId', () => {
  it('issues distinct valid ids', () => {
    const first = createMatchId();
    const second = createMatchId();
    expect(first).not.toBe(second);
    expect(isMatchId(first)).toBe(true);
    expect(isMatchId(second)).toBe(true);
  });
});

describe('constructor validation (failure)', () => {
  it('generates an id when absent, echoes it when present', () => {
    expect(isMatchId(makeMatch().id)).toBe(true);
    expect(makeMatch({ matchId: 'custom-1' }).id).toBe('custom-1');
  });

  it.each([[42], [''], ['x'.repeat(65)]] as Array<[unknown]>)('rejects matchId %j', (matchId) => {
    expect(() => new Match(baseInit({ matchId: matchId as string }))).toThrow(/invalid matchId/);
  });

  it.each([[1.5], [-1], [4294967296], ['x'], [undefined]] as Array<[unknown]>)(
    'rejects seed %j (seed is required, never defaulted)',
    (seed) => {
      expect(() => new Match(baseInit({ seed }))).toThrow(/invalid seed/);
    },
  );

  it.each([
    [42, /not an object/],
    [null, /not an object/],
    [{}, /unknown ruleset id/],
    [{ id: 'x', version: 1 }, /unknown ruleset id/],
    [{ id: 'standard', version: 2 }, /unsupported ruleset version/],
    [{ id: 'standard', version: 0 }, /unsupported ruleset version/],
  ] as Array<[unknown, RegExp]>)('rejects ruleset %j', (ruleset, message) => {
    expect(() => new Match(baseInit({ ruleset }))).toThrow(message);
  });

  it.each([[42], ['x'], [{}], [{ food: { value: 1, gatherYield: 1 } }]] as Array<[unknown]>)(
    'rejects economyConfig %j',
    (economyConfig) => {
      expect(() => new Match(baseInit({ economyConfig }))).toThrow(/invalid economy config/);
    },
  );

  it.each([[42], ['x'], [{}], [{ caps: { base: 1, perStorage: 1 } }]] as Array<[unknown]>)(
    'rejects buildingsConfig %j',
    (buildingsConfig) => {
      expect(() => new Match(baseInit({ buildingsConfig }))).toThrow(/invalid buildings config/);
    },
  );

  it.each([[42], ['x'], [{}], [{ field: { move: 1, defense: 0, stealth: 0, ranged: 0 } }]] as Array<
    [unknown]
  >)('rejects terrainConfig %j', (terrainConfig) => {
    expect(() => new Match(baseInit({ terrainConfig }))).toThrow(/invalid terrain config/);
  });

  it.each([[42], ['x'], [{}], [{ worker: { cost: {}, maxHp: 1, damage: 0 } }]] as Array<[unknown]>)(
    'rejects unitsConfig %j',
    (unitsConfig) => {
      expect(() => new Match(baseInit({ unitsConfig }))).toThrow(/invalid units config/);
    },
  );

  it('rejects garbage roster ids', () => {
    expect(() => makeMatch({ players: ['x'.repeat(65) as PlayerId] })).toThrow(/invalid player id/);
    expect(() => makeMatch({ players: [42 as unknown as PlayerId] })).toThrow(/invalid player id/);
  });

  it('rejects invalid initial states', () => {
    expect(() => makeMatch({ initialState: {} })).toThrow(/invalid initialState/);
    const v2 = { ...createWorldState({ players: [P1] }), schemaVersion: 2 };
    expect(() => makeMatch({ players: [P1], initialState: v2 })).toThrow(/invalid initialState/);
  });

  it('rejects roster/world disagreement (both directions)', () => {
    const state12 = createWorldState({ players: [P1, P2] });
    expect(() => makeMatch({ players: [P1], initialState: state12 })).toThrow(
      /roster does not match/,
    );
    const state1 = createWorldState({ players: [P1] });
    expect(() => makeMatch({ players: [P1, P2], initialState: state1 })).toThrow(
      /roster does not match/,
    );
    const state2 = createWorldState({ players: [P2] });
    expect(() => makeMatch({ players: [P1], initialState: state2 })).toThrow(
      /roster does not match/,
    );
  });

  it('lets kernel validation catch duplicate rosters that pass coherence', () => {
    const state = createWorldState({ players: [P1, P2] });
    expect(() => makeMatch({ players: [P1, P1], initialState: state })).toThrow(/unique/);
  });

  it('rejects extra handlers colliding with built-ins (fail loud, never shadow)', () => {
    const entries: Array<[string, TransitionHandler<WorldState>]> = [
      ['world.noop', (ctx) => ({ applied: true, state: ctx.state, summary: 'evil' })],
    ];
    expect(() => makeMatch({ extraHandlers: new Map(entries) })).toThrow(/duplicate handler/);
  });

  it('rejects extra handlers colliding with the injected order executor (M045)', () => {
    const entries: Array<[string, TransitionHandler<WorldState>]> = [
      ['order.execute', (ctx) => ({ applied: true, state: ctx.state, summary: 'evil' })],
    ];
    expect(() => makeMatch({ extraHandlers: new Map(entries) })).toThrow(/duplicate handler/);
  });
});

describe('prompt budget (PROMPTS E2E)', () => {
  it('defaults to 10 prompts per player', () => {
    expect(DEFAULT_PROMPTS_PER_PLAYER).toBe(10);
  });

  it('seeds the default budget when the slot is absent', () => {
    expect(makeMatch().getSnapshot().prompts).toEqual({
      schemaVersion: 1,
      remaining: { p1: 10, p2: 10 },
    });
  });

  it('respects a present slot (no reseed)', () => {
    const match = makeMatch({
      initialState: createWorldState({
        players: [P1, P2],
        prompts: { schemaVersion: 1, remaining: { p1: 3, p2: 7 } },
      }),
      promptsPerPlayer: 1,
    });
    expect(match.getSnapshot().prompts?.remaining).toEqual({ p1: 3, p2: 7 });
  });

  it('honors a custom promptsPerPlayer on absent slots', () => {
    expect(makeMatch({ promptsPerPlayer: 2 }).getSnapshot().prompts?.remaining).toEqual({
      p1: 2,
      p2: 2,
    });
  });

  it('spends one per applied dispatch (caller only)', () => {
    const match = makeMatch();
    const s1 = match.join(P1);
    const s2 = match.join(P2);
    match.dispatch(s1, raw({ requestId: 'r1', playerId: 'p1', type: 'world.noop', payload: {} }));
    match.dispatch(s1, raw({ requestId: 'r2', playerId: 'p1', type: 'world.noop', payload: {} }));
    match.dispatch(s2, raw({ requestId: 'r3', playerId: 'p2', type: 'world.noop', payload: {} }));
    expect(match.getSnapshot().prompts?.remaining).toEqual({ p1: 8, p2: 9 });
  });

  it('blocks dry callers (pinned reason, state untouched, foe unaffected)', () => {
    const match = makeMatch({ promptsPerPlayer: 1 });
    const s1 = match.join(P1);
    const s2 = match.join(P2);
    match.dispatch(s1, raw({ requestId: 'r1', playerId: 'p1', type: 'world.noop', payload: {} }));
    const before = match.getSnapshot();
    expect(
      match.dispatch(s1, raw({ requestId: 'r2', playerId: 'p1', type: 'world.noop', payload: {} })),
    ).toEqual({
      status: 'rejected',
      reason: 'validation: [prompts-exhausted] no prompts left',
    });
    expect(match.getSnapshot()).toEqual(before);
    expect(match.getRevision()).toBe(1);
    expect(
      match.dispatch(s2, raw({ requestId: 'r3', playerId: 'p2', type: 'world.noop', payload: {} })),
    ).toMatchObject({ status: 'applied' });
  });

  it('rejects the retired match.advance as unknown', () => {
    const match = makeMatch();
    const session = match.join(P1);
    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'match.advance', payload: {} }),
      ),
    ).toEqual({ status: 'error', code: 'UNKNOWN_TRANSITION' });
  });
});

describe('dispatch + timeline (integration)', () => {
  it('spends the caller prompt, shares immutable subtrees, and logs exactly', () => {
    const match = makeMatch();
    const session = match.join(P1);
    const before = match.getSnapshot();

    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'world.noop', payload: {} }),
      ),
    ).toEqual({ status: 'applied', revision: 1, summary: 'world-noop' });

    const after = match.getSnapshot();
    expect(after).toEqual({
      schemaVersion: 1,
      players: [{ id: 'p1' }, { id: 'p2' }],
      prompts: { schemaVersion: 1, remaining: { p1: 9, p2: 10 } },
    });
    expect(after.players).toBe(before.players);
    expect(match.getRevision()).toBe(1);
  });

  it('records revision-at-outcome per entry (noop ×3 → revisions 1, 2, 3)', () => {
    const match = makeMatch();
    const session = match.join(P1);
    const noop = (id: string): void => {
      match.dispatch(
        session,
        raw({ requestId: id, playerId: 'p1', type: 'world.noop', payload: {} }),
      );
    };
    noop('r1');
    noop('r2');
    noop('r3');

    const timeline = match.getTimeline();
    expect(timeline.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(timeline.map((entry) => entry.revision)).toEqual([1, 2, 3]);
    for (const entry of timeline) {
      expect(entry.stateHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('locks the timeline shape + hash algorithm (generated-then-locked golden)', () => {
    const match = new Match({
      matchId: 'golden-match-1',
      seed: 1234,
      ruleset: STANDARD_RULESET,
      players: [P1, P2],
      initialState: createWorldState({ players: [P1, P2] }),
    });
    const session = match.join(P1);
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'world.noop', payload: {} }),
    );

    expect(match.getTimeline()).toEqual([
      {
        seq: 1,
        revision: 1,
        requestId: 'r1',
        playerId: 'p1',
        type: 'world.noop',
        applied: true,
        detail: 'world-noop',
        // PROMPTS regen: budget replaces clock (tick field removed, prompts seeded).
        stateHash: 'fdf3325cd1cc4b020b0db96551f90aaa04aeee39e6daa8819602eb13b39d2e93',
      },
    ]);
  });

  it('records rejections with revision 0, budget unspent, hash unchanged', () => {
    const match = makeMatch({ extraHandlers: testHandlers() });
    const session = match.join(P1);
    const hashBefore = match.getStateHash();

    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'test.reject', payload: {} }),
      ),
    ).toEqual({ status: 'rejected', reason: 'nope' });

    expect(match.getTimeline()).toHaveLength(1);
    const entry = match.getTimeline()[0];
    if (entry === undefined) {
      throw new Error('test setup: expected one timeline entry');
    }
    expect(entry.applied).toBe(false);
    expect(entry.revision).toBe(0);
    expect(match.getSnapshot().prompts?.remaining).toEqual({ p1: 10, p2: 10 });
    expect(entry.stateHash).toBe(hashBefore);
  });

  it('rides custom domain handlers (extensibility proof for future modules)', () => {
    const match = makeMatch({ extraHandlers: testHandlers() });
    const session = match.join(P2);

    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p2', type: 'test.ping', payload: {} }),
      ),
    ).toEqual({ status: 'applied', revision: 1, summary: 'pong' });
    expect(match.getTimeline()).toHaveLength(1);
  });

  it('leaves the timeline untouched on duplicates and errors', () => {
    const match = makeMatch();
    const session = match.join(P1);
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'world.noop', payload: {} }),
    );
    const before = match.getTimeline();

    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'world.noop', payload: {} }),
    );
    match.dispatch(session, raw({ requestId: 'r2', playerId: 'p1', type: 'nope', payload: {} }));

    expect(match.getTimeline()).toEqual(before);
  });

  it('mirrors the kernel log 1:1 after mixed outcomes (coherence invariant)', () => {
    const match = makeMatch({ extraHandlers: testHandlers() });
    const session = match.join(P1);
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'world.noop', payload: {} }),
    );
    match.dispatch(
      session,
      raw({ requestId: 'r2', playerId: 'p1', type: 'test.reject', payload: {} }),
    );
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'world.noop', payload: {} }),
    );
    match.dispatch(session, raw({ requestId: 'r3', playerId: 'p1', type: 'nope', payload: {} }));

    const log = match.getLog();
    const timeline = match.getTimeline();
    expect(timeline).toHaveLength(log.length);
    for (const [index, logged] of log.entries()) {
      const entry = timeline[index];
      if (entry === undefined) {
        throw new Error('test setup: timeline/log length mismatch');
      }
      expect(entry.seq).toBe(index + 1);
      expect(entry.revision).toBe(logged.revision);
      expect(entry.requestId).toBe(logged.requestId);
      expect(entry.playerId).toBe(logged.playerId);
      expect(entry.type).toBe(logged.type);
      expect(entry.applied).toBe(logged.applied);
      expect(entry.detail).toBe(logged.detail);
    }
  });

  it('is deterministic: identical seeds + ops yield identical snapshots, hashes, timelines', () => {
    const run = (): Match => {
      const match = makeMatch({ seed: 999, extraHandlers: testHandlers() });
      const session = match.join(P1);
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'world.noop', payload: {} }),
      );
      match.dispatch(
        session,
        raw({ requestId: 'r2', playerId: 'p1', type: 'test.reject', payload: {} }),
      );
      match.dispatch(
        session,
        raw({ requestId: 'r3', playerId: 'p1', type: 'world.noop', payload: {} }),
      );
      return match;
    };

    const first = run();
    const second = run();
    expect(second.getSnapshot()).toEqual(first.getSnapshot());
    expect(second.getStateHash()).toBe(first.getStateHash());
    expect(second.getTimeline()).toEqual(first.getTimeline());
  });

  it('changes the state hash on dispatch', () => {
    const match = makeMatch();
    const session = match.join(P1);
    const before = match.getStateHash();
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'world.noop', payload: {} }),
    );
    expect(match.getStateHash()).not.toBe(before);
  });

  it('keeps session ids out of state, log and timeline', () => {
    const match = makeMatch();
    const session = match.join(P1);
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'world.noop', payload: {} }),
    );

    const serialized = JSON.stringify({
      state: match.getSnapshot(),
      log: match.getLog(),
      timeline: match.getTimeline(),
    });
    expect(serialized).not.toContain(session.sessionId);
  });

  it('returns the timeline by copy', () => {
    const match = makeMatch();
    const session = match.join(P1);
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'world.noop', payload: {} }),
    );

    const copy = match.getTimeline();
    const entry = copy[0];
    if (entry === undefined) {
      throw new Error('test setup: expected one timeline entry');
    }
    expect(Object.isFrozen(entry)).toBe(true);
    (copy as unknown as unknown[]).push(entry);
    expect(match.getTimeline()).toHaveLength(1);
  });
});

describe('match integrity (failure/security)', () => {
  it('detaches setup input: later mutations cannot corrupt the match', () => {
    const players: PlayerId[] = [P1, P2];
    const budget = { schemaVersion: 1 as const, remaining: { p1: 5, p2: 5 } };
    const initial = createWorldState({ players: [P1, P2], prompts: budget });
    const match = new Match({ seed: 1, ruleset: STANDARD_RULESET, players, initialState: initial });

    players.push(P3);
    budget.remaining['p1'] = 99;

    expect(match.players).toEqual([P1, P2]);
    expect(match.getSnapshot().prompts?.remaining).toEqual({ p1: 5, p2: 5 });
  });

  it('freezes provenance: id, players and ruleset cannot be reassigned', () => {
    const match = makeMatch();
    expect(() => {
      (match as { id: string }).id = 'x';
    }).toThrow(TypeError);
    expect(() => {
      (match.players as unknown as string[]).push('x');
    }).toThrow(TypeError);
    expect(() => {
      (match.ruleset as { id: string }).id = 'x';
    }).toThrow(TypeError);
  });

  it('rejects joins for unknown players (delegation)', () => {
    expect(() => makeMatch().join(P3)).toThrow(/unknown player/);
  });
});
