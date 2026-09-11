import { describe, expect, it } from 'vitest';
import { markUntrusted, type ClientRequest, type PlayerId, type Untrusted } from './authority.js';
import { Match, STANDARD_RULESET } from './match.js';
import {
  evaluateVictory,
  matchConditions,
  timeLimitCondition,
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
  return createWorldState({ players: [P1, P2] });
}

function tickState(tick: number): WorldState {
  return { ...stdState(), tick };
}

function stdInput(state: WorldState = stdState(), revision = 0): ConditionInput {
  return { state, revision };
}

function stdMatch(
  options: {
    readonly maxTicks?: unknown;
    readonly conditions?: readonly VictoryCondition[];
    readonly initialState?: WorldState;
  } = {},
): Match {
  return new Match({
    seed: 999,
    ruleset: STANDARD_RULESET,
    players: [P1, P2],
    initialState: options.initialState ?? stdState(),
    maxTicks: options.maxTicks,
    extraConditions: options.conditions,
  });
}

// TEST condition: crowns P1 past tick 0 (mechanism test, not game logic).
const crownP1: VictoryCondition = (input) =>
  input.state.tick > 0 ? { outcome: { kind: 'win', winner: P1 }, condition: 'test.crown' } : null;

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

describe('timeLimitCondition (unit)', () => {
  it('stays undecided before the limit', () => {
    expect(timeLimitCondition(5)(stdInput(tickState(4)))).toBeNull();
  });

  it('draws exactly at the limit', () => {
    expect(timeLimitCondition(5)(stdInput(tickState(5)))).toEqual({
      outcome: { kind: 'draw' },
      condition: 'time-limit',
    });
  });

  it('draws past the limit', () => {
    expect(timeLimitCondition(5)(stdInput(tickState(9)))).toEqual({
      outcome: { kind: 'draw' },
      condition: 'time-limit',
    });
  });
});

describe('matchConditions (unit)', () => {
  it('registers nothing without maxTicks (untimed)', () => {
    expect(matchConditions(undefined)).toEqual([]);
  });

  it('registers the time limit with maxTicks', () => {
    const conditions = matchConditions(5);
    expect(conditions).toHaveLength(1);
    const first = conditions[0];
    if (first === undefined) {
      throw new Error('test setup: expected one condition');
    }
    expect(first(stdInput(tickState(5)))).toEqual({
      outcome: { kind: 'draw' },
      condition: 'time-limit',
    });
  });
});

describe('evaluateVictory (unit)', () => {
  it('stays ongoing without conditions (shared frozen verdict)', () => {
    const verdict = evaluateVictory([], stdInput());
    expect(verdict).toEqual({ status: 'ongoing' });
    expect(Object.isFrozen(verdict)).toBe(true);
    expect(evaluateVictory([], stdInput(tickState(3), 7))).toBe(verdict);
  });

  it('skips nulls and takes the first decisive verdict with locators', () => {
    expect(evaluateVictory([neverFires, crownP1, alwaysDraws], stdInput(tickState(3), 7))).toEqual({
      status: 'finished',
      outcome: { kind: 'win', winner: 'p1' },
      condition: 'test.crown',
      tick: 3,
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

describe('maxTicks validation (failure)', () => {
  it.each([[1.5], [-1], [4294967296], ['x'], [NaN], [0]] as Array<[unknown]>)(
    'rejects maxTicks %j',
    (maxTicks) => {
      expect(() => stdMatch({ maxTicks })).toThrow(/invalid maxTicks/);
    },
  );
});

describe('terminality (Match E2E)', () => {
  it('never finishes untimed matches', () => {
    const match = stdMatch();
    const session = match.join(P1);
    for (const id of ['r1', 'r2', 'r3']) {
      match.dispatch(
        session,
        raw({ requestId: id, playerId: 'p1', type: 'match.advance', payload: {} }),
      );
    }
    expect(match.getTick()).toBe(3);
    expect(match.getVerdict()).toEqual({ status: 'ongoing' });
  });

  it('finishes exactly at the limit with verdict + event', () => {
    const match = stdMatch({ maxTicks: 2 });
    const session = match.join(P1);
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'match.advance', payload: {} }),
    );
    expect(match.getVerdict()).toEqual({ status: 'ongoing' });
    match.dispatch(
      session,
      raw({ requestId: 'r2', playerId: 'p1', type: 'match.advance', payload: {} }),
    );
    expect(match.getVerdict()).toEqual({
      status: 'finished',
      outcome: { kind: 'draw' },
      condition: 'time-limit',
      tick: 2,
      revision: 2,
    });
    const events = match.getEvents();
    expect(events.map((e) => e.type)).toEqual([
      'match.started',
      'match.advanced',
      'match.advanced',
      'match.finished',
    ]);
    const last = events[events.length - 1];
    if (last === undefined) {
      throw new Error('test setup: expected finished event');
    }
    expect(last).toEqual({
      seq: 4,
      tick: 2,
      revision: 2,
      type: 'match.finished',
      priority: 'high',
      payload: { outcome: { kind: 'draw' }, condition: 'time-limit' },
    });
  });

  it('blocks dispatches after the finish (state untouched)', () => {
    const match = stdMatch({ maxTicks: 1 });
    const session = match.join(P1);
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'match.advance', payload: {} }),
    );
    expect(match.getVerdict().status).toBe('finished');
    const logLength = match.getLog().length;
    const timelineLength = match.getTimeline().length;
    const eventsLength = match.getEvents().length;
    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r2', playerId: 'p1', type: 'match.advance', payload: {} }),
      ),
    ).toEqual({ status: 'error', code: 'MATCH_FINISHED' });
    expect(match.getTick()).toBe(1);
    expect(match.getRevision()).toBe(1);
    expect(match.getLog()).toHaveLength(logLength);
    expect(match.getTimeline()).toHaveLength(timelineLength);
    expect(match.getEvents()).toHaveLength(eventsLength);
  });

  it('leaves rejected dispatches undecided', () => {
    const match = stdMatch({ maxTicks: 1 });
    const session = match.join(P1);
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'match.advance', payload: { x: 1 } }),
    );
    expect(match.getVerdict()).toEqual({ status: 'ongoing' });
  });

  it('supports born-finished matches (imported states)', () => {
    const match = stdMatch({ maxTicks: 50, initialState: tickState(100) });
    expect(match.getVerdict()).toEqual({
      status: 'finished',
      outcome: { kind: 'draw' },
      condition: 'time-limit',
      tick: 100,
      revision: 0,
    });
    const events = match.getEvents();
    expect(events.map((e) => e.type)).toEqual(['match.started', 'match.finished']);
    const session = match.join(P1);
    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'match.advance', payload: {} }),
      ),
    ).toEqual({ status: 'error', code: 'MATCH_FINISHED' });
  });

  it('crowns TEST winners end-to-end (mechanism proof)', () => {
    const match = stdMatch({ conditions: [crownP1] });
    const session = match.join(P1);
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'match.advance', payload: {} }),
    );
    expect(match.getVerdict()).toEqual({
      status: 'finished',
      outcome: { kind: 'win', winner: 'p1' },
      condition: 'test.crown',
      tick: 1,
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

  it('ranks extras before built-ins on same-tick ties', () => {
    const match = stdMatch({ maxTicks: 1, conditions: [crownP1] });
    const session = match.join(P1);
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'match.advance', payload: {} }),
    );
    expect(match.getVerdict()).toEqual({
      status: 'finished',
      outcome: { kind: 'win', winner: 'p1' },
      condition: 'test.crown',
      tick: 1,
      revision: 1,
    });
  });

  it('keeps log/timeline coherent when a condition throws (fail-stop)', () => {
    // TEST condition: quiet at genesis, throws mid-match (fail-stop proof).
    const lateThrower: VictoryCondition = (input) => {
      if (input.state.tick === 0) {
        return null;
      }
      throw new Error('condition boom');
    };
    const match = stdMatch({ conditions: [lateThrower] });
    const session = match.join(P1);
    expect(() =>
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'match.advance', payload: {} }),
      ),
    ).toThrow(/invalid victory decision \(condition 0\): threw/);
    expect(match.getRevision()).toBe(1);
    expect(match.getTimeline()).toHaveLength(match.getLog().length);
    expect(match.getEvents().map((e) => e.type)).toEqual(['match.started', 'match.advanced']);
  });
});

describe('verdict integrity', () => {
  it('freezes verdicts and recomputes finished ones per call', () => {
    const match = stdMatch({ maxTicks: 1 });
    const session = match.join(P1);
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'match.advance', payload: {} }),
    );
    const first = match.getVerdict();
    expect(() => {
      (first as { status: string }).status = 'x';
    }).toThrow(TypeError);
    expect(match.getVerdict()).not.toBe(first);
    expect(match.getVerdict()).toEqual(first);
  });
});
