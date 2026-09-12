/**
 * M058 — Proposal verb tests: wire rule (unit), owner-only dispatches
 * (live mapless Match, M056 mold), slot attention (pending), approve
 * effects (queue append, directive write), structural producers
 * (unit), key-drop law. D-052; closes the Player ↔ Commander block.
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
  APPROVE_TRANSITION,
  createApproveHandler,
  DECLINE_TRANSITION,
  PROPOSE_TRANSITION,
  proposalApprovedProducer,
  proposalDeclinedProducer,
  proposalProposedProducer,
  proposalStateHandlers,
  proposeParamsRule,
} from './proposal-state.js';
import { createWorldState, type WorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

const ORDER = { kind: 'order', order: { kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } } };
const STANCE = { kind: 'stance', stance: 'defensive' };
const AUTONOMY = { kind: 'autonomy', autonomy: 'assisted' };

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
    seed: 58,
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

function recordOf(match: Match, id: string): CommanderRecord | undefined {
  return match.getSnapshot().commanders?.commanders.find((record) => record.id === id);
}

describe('proposal handlers (registration)', () => {
  it('registers propose + approve + decline (no collisions)', () => {
    const handlers = proposalStateHandlers();
    expect([...handlers.keys()].sort()).toEqual([
      'proposal.approve',
      'proposal.decline',
      'proposal.propose',
    ]);
    expect(PROPOSE_TRANSITION).toBe('proposal.propose');
    expect(APPROVE_TRANSITION).toBe('proposal.approve');
    expect(DECLINE_TRANSITION).toBe('proposal.decline');
  });
});

describe('proposeParamsRule (wire shape)', () => {
  it('accepts { id, valid proposal } for every kind', () => {
    for (const proposal of [ORDER, STANCE, AUTONOMY]) {
      expect(proposeParamsRule(P1, { id: 'c0', proposal })).toBeNull();
    }
  });

  it('rejects malformed wire payloads', () => {
    for (const params of [
      7,
      'c0',
      null,
      [],
      {},
      { id: 7, proposal: ORDER },
      { id: 'c0' },
      { id: 'c0', proposal: 7 },
      { id: 'c0', proposal: { kind: 'support' } },
      { id: 'c0', proposal: { kind: 'stance' } },
    ]) {
      expect(proposeParamsRule(P1, params)).toMatchObject({ rule: 'proposal-params' });
    }
  });
});

describe('proposal.propose (files into the attention slot)', () => {
  it('files each kind onto an owned commander + emits', () => {
    for (const [proposal, kind] of [
      [ORDER, 'order'],
      [STANCE, 'stance'],
      [AUTONOMY, 'autonomy'],
    ] as const) {
      const match = makeMatch();
      const session = match.join(P1);
      expect(
        dispatch(match, session, 'r1', PROPOSE_TRANSITION, { id: 'c0', proposal }),
      ).toMatchObject({ status: 'applied' });
      expect(recordOf(match, 'c0')?.proposal).toMatchObject({ kind });
      expect(recordOf(match, 'c1')?.proposal).toBeUndefined();
      expect(match.getEvents().find((event) => event.type === 'proposal.proposed')).toMatchObject({
        priority: 'normal',
        payload: { player: 'p1', commander: 'c0', kind },
      });
    }
  });

  it('rejects filing over a pending proposal (verdicts are never lost)', () => {
    const match = makeMatch();
    const session = match.join(P1);
    expect(
      dispatch(match, session, 'r1', PROPOSE_TRANSITION, { id: 'c0', proposal: ORDER }),
    ).toMatchObject({ status: 'applied' });
    expect(
      dispatch(match, session, 'r2', PROPOSE_TRANSITION, { id: 'c0', proposal: STANCE }),
    ).toEqual({ status: 'rejected', reason: 'proposal.propose: pending.' });
    expect(recordOf(match, 'c0')?.proposal).toMatchObject({ kind: 'order' });
  });

  it('fails closed on unknown commanders, enemy records and bad wire', () => {
    const match = makeMatch();
    const session = match.join(P1);
    expect(
      dispatch(match, session, 'r1', PROPOSE_TRANSITION, { id: 'cx', proposal: ORDER }),
    ).toEqual({ status: 'rejected', reason: 'proposal.propose: unknown commander.' });
    expect(
      dispatch(match, session, 'r2', PROPOSE_TRANSITION, { id: 'c1', proposal: ORDER }),
    ).toEqual({ status: 'rejected', reason: 'proposal.propose: not owner.' });
    expect(dispatch(match, session, 'r3', PROPOSE_TRANSITION, { id: 'c0' })).toEqual({
      status: 'rejected',
      reason: expect.stringContaining('proposal'),
    });
  });
});

describe('proposal.approve (executes, then clears)', () => {
  it('appends orders to the queue, drops the key, emits', () => {
    const match = makeMatch();
    const session = match.join(P1);
    expect(
      dispatch(match, session, 'r1', PROPOSE_TRANSITION, { id: 'c0', proposal: ORDER }),
    ).toMatchObject({ status: 'applied' });
    expect(dispatch(match, session, 'r2', APPROVE_TRANSITION, { id: 'c0' })).toMatchObject({
      status: 'applied',
    });
    const record = recordOf(match, 'c0');
    expect(record?.orders).toHaveLength(1);
    expect(record?.orders?.[0]).toMatchObject({ kind: 'unit.move' });
    expect(record !== undefined && 'proposal' in record).toBe(false);
    expect(match.getEvents().find((event) => event.type === 'proposal.approved')).toMatchObject({
      priority: 'normal',
      payload: { player: 'p1', commander: 'c0', kind: 'order' },
    });
  });

  it('writes stance and autonomy into directives', () => {
    for (const [proposal, directives] of [
      [STANCE, { stance: 'defensive' }],
      [AUTONOMY, { autonomy: 'assisted' }],
    ] as const) {
      const match = makeMatch();
      const session = match.join(P1);
      expect(
        dispatch(match, session, 'r1', PROPOSE_TRANSITION, { id: 'c0', proposal }),
      ).toMatchObject({ status: 'applied' });
      expect(dispatch(match, session, 'r2', APPROVE_TRANSITION, { id: 'c0' })).toMatchObject({
        status: 'applied',
      });
      const record = recordOf(match, 'c0');
      expect(record?.directives).toEqual(directives);
      expect(record !== undefined && 'proposal' in record).toBe(false);
    }
  });

  it('rejects approving onto a full queue (cap 8, fail-closed)', () => {
    const full: CommandersData = {
      ...garrison(),
      commanders: garrison().commanders.map((record) =>
        record.id === 'c0'
          ? {
              ...record,
              orders: [
                { kind: 'unit.move' },
                { kind: 'unit.move' },
                { kind: 'unit.move' },
                { kind: 'unit.move' },
                { kind: 'unit.move' },
                { kind: 'unit.move' },
                { kind: 'unit.move' },
                { kind: 'unit.move' },
              ],
            }
          : record,
      ),
    };
    const match = makeMatch(full);
    const session = match.join(P1);
    expect(
      dispatch(match, session, 'r1', PROPOSE_TRANSITION, { id: 'c0', proposal: ORDER }),
    ).toMatchObject({ status: 'applied' });
    expect(dispatch(match, session, 'r2', APPROVE_TRANSITION, { id: 'c0' })).toEqual({
      status: 'rejected',
      reason: 'proposal.approve: queue full.',
    });
    expect(recordOf(match, 'c0')?.proposal).toMatchObject({ kind: 'order' });
  });

  it('fails closed on unknown, enemy, empty and corrupt slots', () => {
    const match = makeMatch();
    const session = match.join(P1);
    expect(dispatch(match, session, 'r1', APPROVE_TRANSITION, { id: 'cx' })).toEqual({
      status: 'rejected',
      reason: 'proposal.approve: unknown commander.',
    });
    expect(dispatch(match, session, 'r2', APPROVE_TRANSITION, { id: 'c1' })).toEqual({
      status: 'rejected',
      reason: 'proposal.approve: not owner.',
    });
    expect(dispatch(match, session, 'r3', APPROVE_TRANSITION, { id: 'c0' })).toEqual({
      status: 'rejected',
      reason: 'proposal.approve: no proposal.',
    });
    for (const proposal of [{ kind: 'order' }, { kind: 'stance' }]) {
      const corrupt: CommandersData = {
        ...garrison(),
        commanders: garrison().commanders.map((record) =>
          record.id === 'c0'
            ? { ...record, proposal: proposal as unknown as CommanderRecord['proposal'] }
            : record,
        ),
      };
      const state: WorldState = {
        ...createWorldState({ players: [P1, P2], commanders: garrison() }),
        commanders: corrupt,
      };
      expect(createApproveHandler()({ state, caller: P1, params: { id: 'c0' } })).toEqual({
        applied: false,
        reason: 'proposal.approve: no proposal.',
      });
    }
  });
});

describe('proposal.decline (drops, nothing executes)', () => {
  it('clears the slot without queueing or setting + emits', () => {
    const match = makeMatch();
    const session = match.join(P1);
    expect(
      dispatch(match, session, 'r1', PROPOSE_TRANSITION, { id: 'c0', proposal: ORDER }),
    ).toMatchObject({ status: 'applied' });
    expect(dispatch(match, session, 'r2', DECLINE_TRANSITION, { id: 'c0' })).toMatchObject({
      status: 'applied',
    });
    const record = recordOf(match, 'c0');
    expect(record !== undefined && 'proposal' in record).toBe(false);
    expect(record?.orders).toBeUndefined();
    expect(record?.directives).toBeUndefined();
    expect(match.getEvents().find((event) => event.type === 'proposal.declined')).toMatchObject({
      priority: 'normal',
      payload: { player: 'p1', commander: 'c0', kind: 'order' },
    });
  });

  it('fails closed on unknown, enemy and empty slots', () => {
    const match = makeMatch();
    const session = match.join(P1);
    expect(dispatch(match, session, 'r1', DECLINE_TRANSITION, { id: 'cx' })).toEqual({
      status: 'rejected',
      reason: 'proposal.decline: unknown commander.',
    });
    expect(dispatch(match, session, 'r2', DECLINE_TRANSITION, { id: 'c1' })).toEqual({
      status: 'rejected',
      reason: 'proposal.decline: not owner.',
    });
    expect(dispatch(match, session, 'r3', DECLINE_TRANSITION, { id: 'c0' })).toEqual({
      status: 'rejected',
      reason: 'proposal.decline: no proposal.',
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

  it('proposed producer fires on fills, silent otherwise', () => {
    const base: CommanderRecord = { id: 'c0', owner: 'p1', active: true };
    const filled: CommanderRecord = { ...base, proposal: { kind: 'stance', stance: 'defensive' } };
    expect(proposalProposedProducer(states(base, filled))).toMatchObject([
      { type: 'proposal.proposed', payload: { kind: 'stance' } },
    ]);
    expect(proposalProposedProducer(states(filled, filled))).toEqual([]);
    expect(proposalProposedProducer(states(undefined, undefined))).toEqual([]);
    const bare = createWorldState({ players: [P1, P2] });
    expect(bare.commanders).toBeUndefined();
    expect(
      proposalProposedProducer({ before: bare, after: states(base, filled).after }),
    ).toHaveLength(1);
    expect(proposalProposedProducer({ before: states(base, filled).before, after: bare })).toEqual(
      [],
    );
  });

  it('approved producer fires on empties, silent otherwise', () => {
    const base: CommanderRecord = { id: 'c0', owner: 'p1', active: true };
    const filled: CommanderRecord = {
      ...base,
      proposal: { kind: 'order', order: { kind: 'unit.move' } },
    };
    expect(proposalApprovedProducer(states(filled, base))).toMatchObject([
      { type: 'proposal.approved', payload: { kind: 'order' } },
    ]);
    expect(proposalApprovedProducer(states(filled, filled))).toEqual([]);
    expect(proposalApprovedProducer(states(undefined, undefined))).toEqual([]);
    const bare = createWorldState({ players: [P1, P2] });
    expect(
      proposalApprovedProducer({ before: states(filled, base).before, after: bare }),
    ).toMatchObject([{ type: 'proposal.approved' }]);
    expect(proposalApprovedProducer({ before: bare, after: states(filled, base).after })).toEqual(
      [],
    );
  });

  it('declined producer fires on empties, silent otherwise', () => {
    const base: CommanderRecord = { id: 'c0', owner: 'p1', active: true };
    const filled: CommanderRecord = { ...base, proposal: { kind: 'autonomy', autonomy: 'manual' } };
    expect(proposalDeclinedProducer(states(filled, base))).toMatchObject([
      { type: 'proposal.declined', payload: { kind: 'autonomy' } },
    ]);
    expect(proposalDeclinedProducer(states(filled, filled))).toEqual([]);
    expect(proposalDeclinedProducer(states(undefined, undefined))).toEqual([]);
    const bare = createWorldState({ players: [P1, P2] });
    expect(
      proposalDeclinedProducer({ before: states(filled, base).before, after: bare }),
    ).toMatchObject([{ type: 'proposal.declined' }]);
    expect(proposalDeclinedProducer({ before: bare, after: states(filled, base).after })).toEqual(
      [],
    );
  });
});
