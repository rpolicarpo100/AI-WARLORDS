/**
 * M062 — Replay-verify tests: the dispatch journal redrives through
 * Match.replay bit-identically (outcomes, snapshot, events, timeline,
 * revision); tampered journals diverge (verify bites); kernel errors
 * round-trip; empty journals rebuild fresh. D-056.
 */
import { describe, expect, it } from 'vitest';
import {
  markUntrusted,
  type ClientRequest,
  type PlayerId,
  type SessionHandle,
  type Untrusted,
} from './authority.js';
import { isMapData, neighborsOf, type MapCell, type MapData } from './map.js';
import { Match, STANDARD_RULESET, type JournalEntry, type MatchInit } from './match.js';
import { SET_TRANSITION } from './directive-state.js';
import { EXECUTE_TRANSITION } from './order-execution.js';
import { ISSUE_TRANSITION } from './order-state.js';
import { APPROVE_TRANSITION, DECLINE_TRANSITION, PROPOSE_TRANSITION } from './proposal-state.js';
import { MOVE_TRANSITION, type UnitsConfig } from './warfare.js';
import { createWorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

function drillUnits(): UnitsConfig {
  return {
    worker: { cost: { food: 10 }, maxHp: 5, damage: 1 },
    warrior: { cost: { food: 20, gold: 5 }, maxHp: 12, damage: 4 },
    archer: { cost: { wood: 15, gold: 10 }, maxHp: 8, damage: 3 },
  };
}

function battleMap(): MapData {
  const cells: MapCell[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      cells.push(
        col === 0 && row === 0
          ? { col, row, terrain: 'resource', resource: { type: 'gold', amount: 5 } }
          : { col, row, terrain: 'field' },
      );
    }
  }
  const map: MapData = {
    schemaVersion: 1,
    id: 'test-replay' as MapData['id'],
    width: 3,
    height: 3,
    stagger: 'odd',
    cells,
    spawns: [],
  };
  if (!isMapData(map)) {
    throw new Error('TEST BUG: battleMap invalid');
  }
  return map;
}

/** Fresh value-identical init per call (replay rebuilds from scratch). */
function makeInit(): MatchInit {
  const map = battleMap();
  const cells = new Map(map.cells.map((cell) => [`${cell.col},${cell.row}`, cell] as const));
  const foe = neighborsOf(map, 1, 0).find(
    (cell) => cells.get(`${cell.col},${cell.row}`)?.terrain === 'field',
  );
  if (foe === undefined) {
    throw new Error('TEST BUG: no foe field');
  }
  return {
    seed: 62,
    ruleset: STANDARD_RULESET,
    players: [P1, P2],
    unitsConfig: drillUnits(),
    initialState: createWorldState({
      players: [P1, P2],
      map,
      units: {
        schemaVersion: 1,
        nextId: 3,
        units: [
          { id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 },
          { id: 'u1', owner: 'p1', type: 'warrior', hp: 12, col: 1, row: 0 },
          { id: 'u2', owner: 'p2', type: 'archer', hp: 8, col: foe.col, row: foe.row },
        ],
      },
      stockpiles: {
        schemaVersion: 1,
        stockpiles: {
          p1: { food: 60, wood: 45, stone: 30, gold: 25 },
          p2: { food: 40, wood: 30, stone: 20, gold: 15 },
        },
      },
      commanders: {
        schemaVersion: 1,
        nextId: 2,
        commanders: [
          { id: 'c0', owner: 'p1', active: true },
          { id: 'c1', owner: 'p2', active: true },
        ],
      },
    }),
  };
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

/** Mixed script: moves, battle, directive, proposal arc, three rejects. */
function runScript(match: Match, session: SessionHandle): void {
  expect(
    dispatch(match, session, 'r1', MOVE_TRANSITION, { id: 'u0', col: 0, row: 1 }),
  ).toMatchObject({ status: 'applied' });
  expect(
    dispatch(match, session, 'r2', ISSUE_TRANSITION, {
      id: 'c0',
      kind: 'unit.attack',
      params: { id: 'u1', target: 'u2' },
    }),
  ).toMatchObject({ status: 'applied' });
  expect(dispatch(match, session, 'r3', EXECUTE_TRANSITION, { id: 'c0' })).toMatchObject({
    status: 'applied',
  });
  expect(
    dispatch(match, session, 'r4', SET_TRANSITION, {
      id: 'c0',
      kind: 'stance',
      value: 'defensive',
    }),
  ).toMatchObject({ status: 'applied' });
  expect(
    dispatch(match, session, 'r5', PROPOSE_TRANSITION, {
      id: 'c0',
      proposal: { kind: 'stance', stance: 'aggressive' },
    }),
  ).toMatchObject({ status: 'applied' });
  expect(dispatch(match, session, 'r6', APPROVE_TRANSITION, { id: 'c0' })).toMatchObject({
    status: 'applied',
  });
  expect(dispatch(match, session, 'r7', DECLINE_TRANSITION, { id: 'c0' })).toEqual({
    status: 'rejected',
    reason: 'proposal.decline: no proposal.',
  });
  expect(dispatch(match, session, 'r8', PROPOSE_TRANSITION, { id: 'c0' })).toEqual({
    status: 'rejected',
    reason: expect.stringContaining('proposal'),
  });
  expect(
    dispatch(match, session, 'r9', ISSUE_TRANSITION, {
      id: 'c1',
      kind: 'unit.move',
      params: { id: 'u2', col: 2, row: 1 },
    }),
  ).toEqual({ status: 'rejected', reason: 'issue: not owner.' });
  expect(
    dispatch(match, session, 'r10', MOVE_TRANSITION, { id: 'u0', col: 0, row: 0 }),
  ).toMatchObject({ status: 'applied' });
}

describe('Match.replay (deterministic redrive)', () => {
  it('replays a mixed script bit-identically (outcomes + state + stream)', () => {
    const match = new Match(makeInit());
    runScript(match, match.join(P1));
    const journal = match.getJournal();
    expect(journal).toHaveLength(10);
    const { match: twin, outcomes } = Match.replay(makeInit(), journal);
    expect(outcomes).toEqual(journal.map((entry) => entry.outcome));
    expect(twin.getSnapshot()).toEqual(match.getSnapshot());
    expect(twin.getEvents()).toEqual(match.getEvents());
    expect(twin.getTimeline()).toEqual(match.getTimeline());
    expect(twin.getRevision()).toBe(match.getRevision());
    expect(twin.getJournal().map((entry) => entry.outcome)).toEqual(outcomes);
  });

  it('replays empty journals to identical fresh matches', () => {
    const match = new Match(makeInit());
    const { match: twin, outcomes } = Match.replay(makeInit(), match.getJournal());
    expect(outcomes).toEqual([]);
    expect(twin.getSnapshot()).toEqual(match.getSnapshot());
    expect(twin.getEvents()).toEqual(match.getEvents());
    expect(twin.getTimeline()).toEqual(match.getTimeline());
    expect(twin.getRevision()).toBe(0);
  });

  it('detects outcome tampering (valid wire, divergent verdict)', () => {
    const match = new Match(makeInit());
    runScript(match, match.join(P1));
    const journal = match.getJournal();
    const tampered: JournalEntry[] = journal.map((entry, index) =>
      index === 0 ? { ...entry, payload: { id: 'u0', col: 9, row: 1 } } : entry,
    );
    const { match: twin, outcomes } = Match.replay(makeInit(), tampered);
    expect(outcomes).not.toEqual(tampered.map((entry) => entry.outcome));
    expect(outcomes[0]).toMatchObject({ status: 'rejected' });
    expect(twin.getEvents()).not.toEqual(match.getEvents());
  });

  it('detects silent state tampering (identical outcomes, divergent state)', () => {
    const match = new Match(makeInit());
    runScript(match, match.join(P1));
    const journal = match.getJournal();
    const tampered: JournalEntry[] = journal.map((entry, index) =>
      index === 3
        ? { ...entry, payload: { id: 'c0', kind: 'stance', value: 'diplomatic' } }
        : index === 4
          ? { ...entry, payload: { id: 'c0', proposal: { kind: 'stance', stance: 'defensive' } } }
          : entry,
    );
    const { match: twin, outcomes } = Match.replay(makeInit(), tampered);
    expect(outcomes).toEqual(tampered.map((entry) => entry.outcome));
    expect(twin.getSnapshot()).not.toEqual(match.getSnapshot());
    expect(twin.getEvents()).not.toEqual(match.getEvents());
  });

  it('round-trips kernel errors (spoofed sender reproduces)', () => {
    const match = new Match(makeInit());
    const session = match.join(P1);
    const forged = markUntrusted({
      requestId: 'r-evil',
      playerId: P2,
      type: MOVE_TRANSITION,
      payload: { id: 'u0', col: 0, row: 1 },
    } as ClientRequest) as Untrusted<ClientRequest>;
    const outcome = match.dispatch(session, forged);
    expect(outcome).toMatchObject({ status: 'error' });
    const journal = match.getJournal();
    expect(journal).toHaveLength(1);
    const { match: twin, outcomes } = Match.replay(makeInit(), journal);
    expect(outcomes).toEqual(journal.map((entry) => entry.outcome));
    expect(twin.getSnapshot()).toEqual(match.getSnapshot());
  });
});
