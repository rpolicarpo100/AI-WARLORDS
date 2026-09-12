/**
 * M056 — Directive set/clear tests: wire rules (unit), owner-only
 * dispatches (live mapless Match, M047 mold), structural producers
 * (unit), stance precedence (live stancesOf). D-050, voted
 * directive-set-stance.
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
  CLEAR_TRANSITION,
  clearParamsRule,
  directiveClearedProducer,
  directiveSetProducer,
  directiveStateHandlers,
  SET_TRANSITION,
  setParamsRule,
} from './directive-state.js';
import { createWorldState, type WorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

function garrison(): CommandersData {
  return {
    schemaVersion: 1,
    nextId: 2,
    commanders: [
      { id: 'c0', owner: 'p1', active: true },
      { id: 'c1', owner: 'p2', active: true },
    ],
  };
}

function makeMatch(commanders: CommandersData = garrison()): Match {
  return new Match({
    seed: 56,
    ruleset: STANDARD_RULESET,
    players: [P1, P2],
    initialState: createWorldState({ players: [P1, P2], commanders }),
  });
}

function dispatch(
  match: Match,
  session: SessionHandle,
  requestId: string,
  type: string,
  payload: unknown,
): { status: string; reason?: string } {
  const req = markUntrusted({
    requestId,
    playerId: P1,
    type,
    payload,
  } as ClientRequest) as Untrusted<ClientRequest>;
  const outcome = match.dispatch(session, req);
  return outcome.status === 'rejected'
    ? { status: outcome.status, reason: outcome.reason }
    : { status: outcome.status };
}

function directivesOf(match: Match, id: string): unknown {
  return match.getSnapshot().commanders?.commanders.find((record) => record.id === id)?.directives;
}

describe('directive handlers (registration)', () => {
  it('registers set + clear (no collisions)', () => {
    const handlers = directiveStateHandlers();
    expect([...handlers.keys()].sort()).toEqual(['directive.clear', 'directive.set']);
    expect(SET_TRANSITION).toBe('directive.set');
    expect(CLEAR_TRANSITION).toBe('directive.clear');
  });
});

describe('setParamsRule (unit)', () => {
  it('accepts every kind with every valid value', () => {
    for (const value of ['manual', 'assisted', 'autonomous']) {
      expect(setParamsRule(P1, { id: 'c0', kind: 'autonomy', value })).toBeNull();
    }
    for (const value of ['aggressive', 'defensive', 'expansionist', 'diplomatic', 'balanced']) {
      expect(setParamsRule(P1, { id: 'c0', kind: 'stance', value })).toBeNull();
    }
  });

  it('rejects malformed envelopes', () => {
    expect(setParamsRule(P1, 7)).toMatchObject({ rule: 'directive-params' });
    expect(setParamsRule(P1, { id: 7, kind: 'autonomy', value: 'manual' })).toMatchObject({
      rule: 'directive-params',
    });
    expect(setParamsRule(P1, { id: 'c0', kind: 'focus', value: 'manual' })).toMatchObject({
      rule: 'directive-params',
    });
  });

  it('rejects cross-kind values (autonomy value for stance and back)', () => {
    expect(setParamsRule(P1, { id: 'c0', kind: 'stance', value: 'manual' })).toMatchObject({
      rule: 'directive-params',
      detail: 'set takes a valid stance value',
    });
    expect(setParamsRule(P1, { id: 'c0', kind: 'autonomy', value: 'defensive' })).toMatchObject({
      rule: 'directive-params',
      detail: 'set takes a valid autonomy value',
    });
  });
});

describe('clearParamsRule (unit)', () => {
  it('accepts both kinds, rejects malformed envelopes', () => {
    expect(clearParamsRule(P1, { id: 'c0', kind: 'autonomy' })).toBeNull();
    expect(clearParamsRule(P1, { id: 'c0', kind: 'stance' })).toBeNull();
    expect(clearParamsRule(P1, 7)).toMatchObject({ rule: 'directive-params' });
    expect(clearParamsRule(P1, { id: 7, kind: 'stance' })).toMatchObject({
      rule: 'directive-params',
    });
    expect(clearParamsRule(P1, { id: 'c0', kind: 'focus' })).toMatchObject({
      rule: 'directive-params',
    });
  });
});

describe('set (dispatch)', () => {
  it('writes and overwrites one kind (other kinds survive)', () => {
    const match = makeMatch();
    const session = match.join(P1);
    expect(
      dispatch(match, session, 'r1', SET_TRANSITION, {
        id: 'c0',
        kind: 'autonomy',
        value: 'manual',
      }),
    ).toMatchObject({ status: 'applied' });
    expect(
      dispatch(match, session, 'r2', SET_TRANSITION, {
        id: 'c0',
        kind: 'stance',
        value: 'defensive',
      }),
    ).toMatchObject({ status: 'applied' });
    expect(
      dispatch(match, session, 'r3', SET_TRANSITION, {
        id: 'c0',
        kind: 'stance',
        value: 'aggressive',
      }),
    ).toMatchObject({ status: 'applied' });
    expect(directivesOf(match, 'c0')).toEqual({ autonomy: 'manual', stance: 'aggressive' });
  });

  it('fails closed on unknown commanders and enemy records', () => {
    const match = makeMatch();
    const session = match.join(P1);
    expect(
      dispatch(match, session, 'r1', SET_TRANSITION, {
        id: 'c9',
        kind: 'stance',
        value: 'balanced',
      }),
    ).toEqual({ status: 'rejected', reason: 'directive.set: unknown commander.' });
    expect(
      dispatch(match, session, 'r2', SET_TRANSITION, {
        id: 'c1',
        kind: 'stance',
        value: 'balanced',
      }),
    ).toEqual({ status: 'rejected', reason: 'directive.set: not owner.' });
    expect(directivesOf(match, 'c1')).toBeUndefined();
  });

  it('emits set facts with player + commander + kind + value', () => {
    const match = makeMatch();
    const session = match.join(P1);
    expect(
      dispatch(match, session, 'r1', SET_TRANSITION, {
        id: 'c0',
        kind: 'stance',
        value: 'defensive',
      }),
    ).toMatchObject({ status: 'applied' });
    expect(match.getEvents().find((event) => event.type === 'directive.set')).toMatchObject({
      priority: 'normal',
      payload: { player: 'p1', commander: 'c0', kind: 'stance', value: 'defensive' },
    });
  });
});

describe('clear (dispatch)', () => {
  function directed(): Match {
    const match = makeMatch();
    const session = match.join(P1);
    for (const [requestId, kind, value] of [
      ['r1', 'autonomy', 'manual'],
      ['r2', 'stance', 'defensive'],
    ] as const) {
      const outcome = dispatch(match, session, requestId, SET_TRANSITION, {
        id: 'c0',
        kind,
        value,
      });
      if (outcome.status !== 'applied') {
        throw new Error('TEST BUG: setup set must apply');
      }
    }
    return match;
  }

  it('drops one kind (survivors stay) and the key when emptied', () => {
    const match = directed();
    const session = match.join(P1);
    expect(
      dispatch(match, session, 'r3', CLEAR_TRANSITION, { id: 'c0', kind: 'stance' }),
    ).toMatchObject({ status: 'applied' });
    expect(directivesOf(match, 'c0')).toEqual({ autonomy: 'manual' });
    expect(
      dispatch(match, session, 'r4', CLEAR_TRANSITION, { id: 'c0', kind: 'autonomy' }),
    ).toMatchObject({ status: 'applied' });
    const record = match
      .getSnapshot()
      .commanders?.commanders.find((entry) => entry.id === 'c0') as unknown as Record<
      string,
      unknown
    >;
    expect('directives' in record).toBe(false);
  });

  it('fails closed on unset kinds, unknown commanders, enemy records', () => {
    const match = directed();
    const session = match.join(P1);
    expect(
      dispatch(match, session, 'r3', CLEAR_TRANSITION, { id: 'c0', kind: 'autonomy' }),
    ).toMatchObject({ status: 'applied' });
    expect(
      dispatch(match, session, 'r4', CLEAR_TRANSITION, { id: 'c0', kind: 'autonomy' }),
    ).toEqual({ status: 'rejected', reason: 'directive.clear: not set.' });
    expect(dispatch(match, session, 'r5', CLEAR_TRANSITION, { id: 'c9', kind: 'stance' })).toEqual({
      status: 'rejected',
      reason: 'directive.clear: unknown commander.',
    });
    expect(dispatch(match, session, 'r6', CLEAR_TRANSITION, { id: 'c1', kind: 'stance' })).toEqual({
      status: 'rejected',
      reason: 'directive.clear: not owner.',
    });
  });

  it('emits cleared facts without values', () => {
    const match = directed();
    const session = match.join(P1);
    expect(
      dispatch(match, session, 'r3', CLEAR_TRANSITION, { id: 'c0', kind: 'stance' }),
    ).toMatchObject({ status: 'applied' });
    expect(match.getEvents().find((event) => event.type === 'directive.cleared')).toMatchObject({
      priority: 'normal',
      payload: { player: 'p1', commander: 'c0', kind: 'stance' },
    });
  });
});

describe('producers (unit, structural diffs)', () => {
  function states(
    before: CommanderRecord | undefined,
    after: CommanderRecord | undefined,
  ): { before: WorldState; after: WorldState } {
    const data = (record: CommanderRecord | undefined): CommandersData => ({
      schemaVersion: 1,
      nextId: 2,
      commanders: record === undefined ? [] : [record],
    });
    return {
      before: createWorldState({ players: [P1, P2], commanders: data(before) }),
      after: createWorldState({ players: [P1, P2], commanders: data(after) }),
    };
  }

  it('set producer fires on writes + overwrites, silent otherwise', () => {
    const base: CommanderRecord = { id: 'c0', owner: 'p1', active: true };
    expect(
      directiveSetProducer(states(base, { ...base, directives: { autonomy: 'manual' } })),
    ).toHaveLength(1);
    expect(
      directiveSetProducer(
        states(
          { ...base, directives: { stance: 'defensive' } },
          { ...base, directives: { stance: 'aggressive' } },
        ),
      ),
    ).toMatchObject([{ type: 'directive.set', payload: { kind: 'stance', value: 'aggressive' } }]);
    expect(
      directiveSetProducer(
        states(base, { ...base, directives: { autonomy: 'manual' }, active: false }),
      ),
    ).toHaveLength(1);
    expect(directiveSetProducer(states(undefined, undefined))).toEqual([]);
    expect(
      directiveSetProducer(
        states(
          { ...base, directives: { stance: 'defensive' } },
          { ...base, directives: { stance: 'defensive' } },
        ),
      ),
    ).toEqual([]);
    const bare = createWorldState({ players: [P1, P2] });
    expect(bare.commanders).toBeUndefined();
    expect(directiveSetProducer({ before: bare, after: states(base, base).after })).toHaveLength(0);
    expect(directiveSetProducer({ before: states(base, base).before, after: bare })).toEqual([]);
  });

  it('cleared producer fires on drops, silent otherwise', () => {
    const base: CommanderRecord = { id: 'c0', owner: 'p1', active: true };
    expect(
      directiveClearedProducer(states({ ...base, directives: { stance: 'defensive' } }, base)),
    ).toMatchObject([{ type: 'directive.cleared', payload: { kind: 'stance' } }]);
    expect(directiveClearedProducer(states(undefined, undefined))).toEqual([]);
    expect(
      directiveClearedProducer(
        states(
          { ...base, directives: { stance: 'defensive' } },
          { ...base, directives: { stance: 'defensive' } },
        ),
      ),
    ).toEqual([]);
    const bare = createWorldState({ players: [P1, P2] });
    expect(
      directiveClearedProducer({
        before: states({ ...base, directives: { stance: 'defensive' } }, base).before,
        after: bare,
      }),
    ).toMatchObject([{ type: 'directive.cleared' }]);
    expect(directiveClearedProducer({ before: bare, after: states(base, base).after })).toEqual([]);
  });
});

describe('stance precedence (live stancesOf)', () => {
  it('ordered posture beats DNA; clearing restores it', () => {
    const match = makeMatch();
    const session = match.join(P1);
    expect(match.stancesOf('p1')).toEqual([{ id: 'c0', stance: 'balanced' }]);
    expect(
      dispatch(match, session, 'r1', SET_TRANSITION, {
        id: 'c0',
        kind: 'stance',
        value: 'defensive',
      }),
    ).toMatchObject({ status: 'applied' });
    expect(match.stancesOf('p1')).toEqual([{ id: 'c0', stance: 'defensive' }]);
    expect(
      dispatch(match, session, 'r2', CLEAR_TRANSITION, { id: 'c0', kind: 'stance' }),
    ).toMatchObject({ status: 'applied' });
    expect(match.stancesOf('p1')).toEqual([{ id: 'c0', stance: 'balanced' }]);
  });
});
