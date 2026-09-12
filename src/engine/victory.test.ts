import { describe, expect, it } from 'vitest';
import {
  markUntrusted,
  type ClientRequest,
  type PlayerId,
  type SessionHandle,
  type Untrusted,
} from './authority.js';
import { Match, STANDARD_RULESET } from './match.js';
import { seedPrompts } from './prompts.js';
import {
  evaluateVictory,
  exemptFree,
  matchConditions,
  promptsExhaustedCondition,
  winnerOf,
  type ConditionDecision,
  type ConditionInput,
  type VictoryCondition,
} from './victory.js';
import { createWorldState, type WorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;
const P3 = 'p3' as PlayerId;

/** Simulates untrusted wire bytes: unknown input, marked at the boundary. */
function raw(value: unknown): Untrusted<ClientRequest> {
  return markUntrusted(value as ClientRequest);
}

function stdState(): WorldState {
  return createWorldState({ players: [P1, P2], prompts: seedPrompts([P1, P2], 10) });
}

function slotless(): WorldState {
  return createWorldState({ players: [P1, P2] });
}

function promptState(p1: number, p2: number): WorldState {
  return createWorldState({
    players: [P1, P2],
    prompts: { schemaVersion: 1, remaining: { p1, p2 } },
  });
}

function stdInput(state: WorldState = stdState(), revision = 0): ConditionInput {
  return { state, revision };
}

function stdMatch(
  options: {
    readonly promptsPerPlayer?: unknown;
    readonly conditions?: readonly VictoryCondition[];
    readonly initialState?: WorldState;
  } = {},
): Match {
  return new Match({
    seed: 999,
    ruleset: STANDARD_RULESET,
    players: [P1, P2],
    initialState: options.initialState ?? slotless(),
    promptsPerPlayer: options.promptsPerPlayer,
    extraConditions: options.conditions,
  });
}

// TEST condition: crowns P1 past revision 0 (mechanism test, not game logic).
const crownP1: VictoryCondition = (input) =>
  input.revision > 0 ? { outcome: { kind: 'win', winner: P1 }, condition: 'test.crown' } : null;

// TEST condition: always undecided.
const neverFires: VictoryCondition = () => null;

// TEST condition: always draws.
const alwaysDraws: VictoryCondition = () => ({
  outcome: { kind: 'draw' },
  condition: 'test.draw',
});

// TEST condition: throws (fail-stop proof).
const throwing: VictoryCondition = () => {
  throw new Error('condition boom');
};

describe('promptsExhaustedCondition (unit)', () => {
  it('stays undecided while anyone holds prompts', () => {
    expect(promptsExhaustedCondition()(stdInput(promptState(0, 5)))).toBeNull();
    expect(promptsExhaustedCondition()(stdInput(promptState(3, 0)))).toBeNull();
  });

  it('draws when every holder is dry', () => {
    expect(promptsExhaustedCondition()(stdInput(promptState(0, 0)))).toEqual({
      outcome: { kind: 'draw' },
      condition: 'prompts-exhausted',
    });
  });

  it('draws on an absent slot (fail-closed dry)', () => {
    const slotless = createWorldState({ players: [P1, P2] });
    expect(promptsExhaustedCondition()(stdInput(slotless))).toEqual({
      outcome: { kind: 'draw' },
      condition: 'prompts-exhausted',
    });
  });
});

describe('winnerOf (unit)', () => {
  it('reads the crown off wins and none off draws', () => {
    expect(winnerOf({ kind: 'win', winner: P1 })).toBe(P1);
    expect(winnerOf({ kind: 'draw' })).toBeNull();
  });
});

describe('matchConditions (unit)', () => {
  it('registers prompt exhaustion unconditionally', () => {
    const conditions = matchConditions();
    expect(conditions).toHaveLength(1);
    const first = conditions[0];
    if (first === undefined) {
      throw new Error('test setup: expected one condition');
    }
    expect(first(stdInput(stdState()))).toBeNull();
    expect(first(stdInput(promptState(0, 0)))).toEqual({
      outcome: { kind: 'draw' },
      condition: 'prompts-exhausted',
    });
  });
});

describe('evaluateVictory (unit)', () => {
  it('stays ongoing without conditions (shared frozen verdict)', () => {
    const verdict = evaluateVictory([], stdInput());
    expect(verdict).toEqual({ status: 'ongoing' });
    expect(Object.isFrozen(verdict)).toBe(true);
    expect(evaluateVictory([], stdInput(promptState(0, 0), 7))).toBe(verdict);
  });

  it('skips nulls and takes the first decisive verdict with the revision locator', () => {
    expect(evaluateVictory([neverFires, crownP1, alwaysDraws], stdInput(stdState(), 7))).toEqual({
      status: 'finished',
      outcome: { kind: 'win', winner: 'p1' },
      condition: 'test.crown',
      revision: 7,
    });
  });
});

describe('decision validation (failure)', () => {
  it('fails stop-loud when a condition throws', () => {
    expect(() => evaluateVictory([throwing], stdInput())).toThrow(
      'invalid victory decision (condition 0): threw',
    );
  });

  it('rejects garbage outcome kinds', () => {
    const bad: VictoryCondition = () =>
      ({ outcome: { kind: 'tie' }, condition: 'x' }) as unknown as ConditionDecision;
    expect(() => evaluateVictory([bad], stdInput())).toThrow(/bad outcome/);
  });

  it('rejects non-id winners', () => {
    const bad: VictoryCondition = () =>
      ({
        outcome: { kind: 'win', winner: 42 },
        condition: 'x',
      }) as unknown as ConditionDecision;
    expect(() => evaluateVictory([bad], stdInput())).toThrow(/bad winner/);
  });

  it('rejects winners outside the roster', () => {
    const bad: VictoryCondition = () => ({
      outcome: { kind: 'win', winner: P3 },
      condition: 'x',
    });
    expect(() => evaluateVictory([bad], stdInput())).toThrow(/bad winner/);
  });

  it.each([[42], [''], ['x'.repeat(65)]] as Array<[unknown]>)(
    'rejects bad condition id %j',
    (condition) => {
      const bad: VictoryCondition = () =>
        ({ outcome: { kind: 'draw' }, condition }) as unknown as ConditionDecision;
      expect(() => evaluateVictory([bad], stdInput())).toThrow(/bad condition/);
    },
  );
});

describe('promptsPerPlayer validation (failure)', () => {
  it.each([[1.5], [-1], [4294967296], ['x'], [NaN], [0]] as Array<[unknown]>)(
    'rejects promptsPerPlayer %j',
    (promptsPerPlayer) => {
      expect(() => stdMatch({ promptsPerPlayer })).toThrow(/invalid promptsPerPlayer/);
    },
  );
});

describe('terminality (Match E2E)', () => {
  function noop(match: Match, rid: string, player: PlayerId, session: SessionHandle): unknown {
    return match.dispatch(
      session,
      raw({ requestId: rid, playerId: player, type: 'world.noop', payload: {} }),
    );
  }

  it('stays ongoing while prompts remain', () => {
    const match = stdMatch();
    const session = match.join(P1);
    for (const id of ['r1', 'r2', 'r3']) {
      noop(match, id, P1, session);
    }
    expect(match.getSnapshot().prompts?.remaining).toEqual({ p1: 7, p2: 10 });
    expect(match.getVerdict()).toEqual({ status: 'ongoing' });
  });

  it('finishes when the last prompt dies (draw + event)', () => {
    const match = stdMatch({ promptsPerPlayer: 1 });
    const s1 = match.join(P1);
    const s2 = match.join(P2);
    noop(match, 'r1', P1, s1);
    expect(match.getVerdict()).toEqual({ status: 'ongoing' });
    noop(match, 'r2', P2, s2);
    expect(match.getVerdict()).toEqual({
      status: 'finished',
      outcome: { kind: 'draw' },
      condition: 'prompts-exhausted',
      revision: 2,
    });
    const events = match.getEvents();
    expect(events.map((e) => e.type)).toEqual(['match.started', 'match.finished']);
    const last = events[events.length - 1];
    if (last === undefined) {
      throw new Error('test setup: expected finished event');
    }
    expect(last).toEqual({
      seq: 2,
      revision: 2,
      type: 'match.finished',
      priority: 'high',
      payload: { outcome: { kind: 'draw' }, condition: 'prompts-exhausted' },
    });
  });

  it('blocks dispatches after the finish (state untouched)', () => {
    const match = stdMatch({ promptsPerPlayer: 1 });
    const s1 = match.join(P1);
    const s2 = match.join(P2);
    noop(match, 'r1', P1, s1);
    noop(match, 'r2', P2, s2);
    expect(match.getVerdict().status).toBe('finished');
    const logLength = match.getLog().length;
    const timelineLength = match.getTimeline().length;
    const eventsLength = match.getEvents().length;
    expect(noop(match, 'r3', P1, s1)).toEqual({ status: 'error', code: 'MATCH_FINISHED' });
    expect(match.getSnapshot().prompts?.remaining).toEqual({ p1: 0, p2: 0 });
    expect(match.getRevision()).toBe(2);
    expect(match.getLog()).toHaveLength(logLength);
    expect(match.getTimeline()).toHaveLength(timelineLength);
    expect(match.getEvents()).toHaveLength(eventsLength);
  });

  it('leaves rejected dispatches undecided (rejected are free)', () => {
    const match = stdMatch({ promptsPerPlayer: 1 });
    const session = match.join(P1);
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'world.noop', payload: { x: 1 } }),
    );
    expect(match.getSnapshot().prompts?.remaining).toEqual({ p1: 1, p2: 1 });
    expect(match.getVerdict()).toEqual({ status: 'ongoing' });
  });

  it('supports born-finished matches (imported states)', () => {
    const match = stdMatch({ initialState: promptState(0, 0) });
    expect(match.getVerdict()).toEqual({
      status: 'finished',
      outcome: { kind: 'draw' },
      condition: 'prompts-exhausted',
      revision: 0,
    });
    const events = match.getEvents();
    expect(events.map((e) => e.type)).toEqual(['match.started', 'match.finished']);
    const session = match.join(P1);
    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'world.noop', payload: {} }),
      ),
    ).toEqual({ status: 'error', code: 'MATCH_FINISHED' });
  });

  it('crowns TEST winners end-to-end (mechanism proof)', () => {
    const match = stdMatch({ conditions: [crownP1] });
    const session = match.join(P1);
    noop(match, 'r1', P1, session);
    expect(match.getVerdict()).toEqual({
      status: 'finished',
      outcome: { kind: 'win', winner: 'p1' },
      condition: 'test.crown',
      revision: 1,
    });
    const events = match.getEvents();
    const last = events[events.length - 1];
    if (last === undefined) {
      throw new Error('test setup: expected finished event');
    }
    expect(last.payload).toEqual({
      outcome: { kind: 'win', winner: 'p1' },
      condition: 'test.crown',
    });
  });

  it('ranks extras before built-ins on exhaustion ties', () => {
    const match = stdMatch({ promptsPerPlayer: 1, conditions: [crownP1] });
    const s1 = match.join(P1);
    const s2 = match.join(P2);
    noop(match, 'r1', P1, s1);
    noop(match, 'r2', P2, s2);
    expect(match.getVerdict()).toEqual({
      status: 'finished',
      outcome: { kind: 'win', winner: 'p1' },
      condition: 'test.crown',
      revision: 1,
    });
  });

  it('keeps log/timeline coherent when a condition throws (fail-stop)', () => {
    // TEST condition: quiet at genesis, throws mid-match (fail-stop proof).
    const lateThrower: VictoryCondition = (input) => {
      if (input.revision === 0) {
        return null;
      }
      throw new Error('condition boom');
    };
    const match = stdMatch({ conditions: [lateThrower] });
    const session = match.join(P1);
    expect(() =>
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'world.noop', payload: {} }),
      ),
    ).toThrow(/invalid victory decision \(condition 0\): threw/);
    expect(match.getRevision()).toBe(1);
    expect(match.getTimeline()).toHaveLength(match.getLog().length);
    expect(match.getEvents().map((e) => e.type)).toEqual(['match.started']);
  });
});

describe('verdict integrity', () => {
  it('freezes verdicts and recomputes finished ones per call', () => {
    const match = stdMatch({ promptsPerPlayer: 1 });
    const s1 = match.join(P1);
    const s2 = match.join(P2);
    match.dispatch(s1, raw({ requestId: 'r1', playerId: 'p1', type: 'world.noop', payload: {} }));
    match.dispatch(s2, raw({ requestId: 'r2', playerId: 'p2', type: 'world.noop', payload: {} }));
    const first = match.getVerdict();
    expect(() => {
      (first as { status: string }).status = 'x';
    }).toThrow(TypeError);
    expect(match.getVerdict()).not.toBe(first);
    expect(match.getVerdict()).toEqual(first);
  });
});

describe('exemptFree (M095)', () => {
  const decisive: VictoryCondition = () => ({
    outcome: { kind: 'draw' },
    condition: 'test-draw',
  });
  const input = (state: WorldState): ConditionInput => ({ state, revision: 0 });

  it('abstains in free mode (even over a decisive inner)', () => {
    const state = createWorldState({ players: [P1, P2] });
    expect(exemptFree('free', decisive)(input(state))).toBeNull();
  });

  it('passes standard through (identity)', () => {
    expect(exemptFree('standard', decisive)).toBe(decisive);
  });
});
