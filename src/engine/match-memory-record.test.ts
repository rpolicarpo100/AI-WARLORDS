/**
 * M052 — Match memory-record wiring tests: live auto-record over a
 * real Match (D-046, voted record-verb + attribute-named). Stamped
 * order facts persist as commander memories; the system transition
 * spends no prompts; the final lance records; forgery is
 * owner-bounded; oversized bookkeeping faults loud.
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
import type { EventProducer } from './events.js';
import { isMapData, neighborsOf, type MapCell, type MapData } from './map.js';
import { Match, STANDARD_RULESET } from './match.js';
import { RECORD_TRANSITION } from './memory-record.js';
import { EXECUTE_TRANSITION } from './order-execution.js';
import { CANCEL_TRANSITION, ISSUE_TRANSITION } from './order-state.js';
import type { VictoryCondition } from './victory.js';
import { MOVE_TRANSITION, type UnitsConfig } from './warfare.js';
import { createWorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

/** Same battle-proven numbers as warfare.test.ts customUnits. */
function drillUnits(): UnitsConfig {
  return {
    worker: { cost: { food: 10 }, maxHp: 5, damage: 1 },
    warrior: { cost: { food: 20, gold: 5 }, maxHp: 12, damage: 4 },
    archer: { cost: { wood: 15, gold: 10 }, maxHp: 8, damage: 3 },
  };
}

/** 3x3 field grid with a gold node at the worker's feet (M045 mold). */
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
    id: 'test-record' as MapData['id'],
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

interface CampaignOptions {
  readonly p1Orders?: CommanderRecord['orders'];
  readonly promptsPerPlayer?: number;
  readonly extraProducers?: ReadonlyMap<string, readonly EventProducer[]>;
  readonly extraConditions?: readonly VictoryCondition[];
}

function campaign(options: CampaignOptions = {}): Match {
  const map = battleMap();
  const cells = new Map(map.cells.map((cell) => [`${cell.col},${cell.row}`, cell] as const));
  const foe = neighborsOf(map, 1, 0).find(
    (cell) => cells.get(`${cell.col},${cell.row}`)?.terrain === 'field',
  );
  if (foe === undefined) {
    throw new Error('TEST BUG: no foe field');
  }
  const commanders: CommandersData = {
    schemaVersion: 1,
    nextId: 2,
    commanders: [
      {
        id: 'c0',
        owner: 'p1',
        active: true,
        ...(options.p1Orders === undefined ? {} : { orders: options.p1Orders }),
      },
      { id: 'c1', owner: 'p2', active: true },
    ],
  };
  return new Match({
    seed: 52,
    ruleset: STANDARD_RULESET,
    players: [P1, P2],
    promptsPerPlayer: options.promptsPerPlayer,
    extraProducers: options.extraProducers,
    extraConditions: options.extraConditions,
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
      commanders,
    }),
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

function memoriesOf(match: Match, id: string): unknown {
  return match.getSnapshot().commanders?.commanders.find((record) => record.id === id)?.memories;
}

function promptsOf(match: Match, holder: string): unknown {
  return match.getSnapshot().prompts?.remaining[holder];
}

describe('auto-record (live bookkeeping)', () => {
  it('persists stamped order facts as memories (seq/revision exact)', () => {
    const match = campaign();
    const session = match.join(P1);
    const target = { col: 0, row: 1 };
    expect(
      dispatch(match, session, 'r1', ISSUE_TRANSITION, {
        id: 'c0',
        kind: 'unit.move',
        params: { id: 'u0', col: target.col, row: target.row },
      }),
    ).toMatchObject({ status: 'applied' });
    expect(dispatch(match, session, 'r2', EXECUTE_TRANSITION, { id: 'c0' })).toMatchObject({
      status: 'applied',
    });
    const executed = match.getEvents().find((event) => event.type === 'order.executed');
    expect(executed).toMatchObject({ revision: 2 });
    expect(memoriesOf(match, 'c0')).toEqual([
      { seq: executed?.seq, revision: 2, kind: 'order.executed', subject: 'c0' },
    ]);
    // The record rode its own revision (game 2, bookkeeping 3).
    expect(match.getRevision()).toBe(3);
  });

  it('spends no prompts on the system transition', () => {
    const match = campaign();
    const session = match.join(P1);
    expect(
      dispatch(match, session, 'r1', ISSUE_TRANSITION, {
        id: 'c0',
        kind: 'unit.move',
        params: { id: 'u0', col: 0, row: 1 },
      }),
    ).toMatchObject({ status: 'applied' });
    expect(dispatch(match, session, 'r2', EXECUTE_TRANSITION, { id: 'c0' })).toMatchObject({
      status: 'applied',
    });
    // Two player actions spent two prompts; the record spent zero.
    expect(promptsOf(match, 'p1')).toBe(8);
    expect(memoriesOf(match, 'c0')).toHaveLength(1);
  });

  it('records on the last prompt (exhausted ledger, free bookkeeping)', () => {
    const match = campaign({
      promptsPerPlayer: 1,
      p1Orders: [{ kind: 'unit.move', params: { id: 'u0', col: 0, row: 1 } }],
    });
    const session = match.join(P1);
    expect(dispatch(match, session, 'r1', EXECUTE_TRANSITION, { id: 'c0' })).toMatchObject({
      status: 'applied',
    });
    expect(promptsOf(match, 'p1')).toBe(0);
    expect(memoriesOf(match, 'c0')).toEqual([
      { seq: 2, revision: 1, kind: 'order.executed', subject: 'c0' },
    ]);
  });

  it('skips the dispatch on banal lances (zero revision-bloat)', () => {
    const match = campaign();
    const session = match.join(P1);
    expect(
      dispatch(match, session, 'r1', MOVE_TRANSITION, { id: 'u0', col: 0, row: 1 }),
    ).toMatchObject({ status: 'applied' });
    // unit.moved is unmemorable; sightings skip whole (no commander).
    expect(match.getRevision()).toBe(1);
    expect(memoriesOf(match, 'c0')).toBeUndefined();
  });

  it('records the final lance (finished matches keep no guard)', () => {
    const demobilized: VictoryCondition = (input) => {
      const orders =
        input.state.commanders?.commanders.find((record) => record.id === 'c0')?.orders ?? [];
      return orders.length === 0
        ? { outcome: { kind: 'win', winner: P2 }, condition: 'test.demobilized' }
        : null;
    };
    const match = campaign({
      p1Orders: [{ kind: 'unit.move', params: { id: 'u0', col: 0, row: 1 } }],
      extraConditions: [demobilized],
    });
    const session = match.join(P1);
    expect(dispatch(match, session, 'r1', CANCEL_TRANSITION, { id: 'c0' })).toMatchObject({
      status: 'applied',
    });
    expect(match.getVerdict().status).toBe('finished');
    expect(memoriesOf(match, 'c0')).toEqual([
      { seq: 2, revision: 1, kind: 'order.canceled', subject: 'c0' },
    ]);
  });

  it('records executed heads but never their battle facts (attribute-named)', () => {
    const match = campaign();
    const session = match.join(P1);
    expect(
      dispatch(match, session, 'r1', ISSUE_TRANSITION, {
        id: 'c0',
        kind: 'unit.attack',
        params: { id: 'u1', target: 'u2' },
      }),
    ).toMatchObject({ status: 'applied' });
    expect(dispatch(match, session, 'r2', EXECUTE_TRANSITION, { id: 'c0' })).toMatchObject({
      status: 'applied',
    });
    expect(match.getEvents().some((event) => event.type === 'unit.attacked')).toBe(true);
    expect(memoriesOf(match, 'c0')).toEqual([
      {
        seq: match.getEvents().find((event) => event.type === 'order.executed')?.seq,
        revision: 2,
        kind: 'order.executed',
        subject: 'c0',
      },
    ]);
  });
});

describe('record threat model (live)', () => {
  it('rejects cross-commander forgery (enemy logs untouchable)', () => {
    const match = campaign();
    const session = match.join(P1);
    expect(
      dispatch(match, session, 'r1', RECORD_TRANSITION, {
        events: [
          {
            seq: 1,
            revision: 0,
            type: 'order.executed',
            priority: 'normal',
            payload: { player: 'p2', commander: 'c1' },
          },
        ],
      }),
    ).toEqual({ status: 'rejected', reason: 'record: nothing memorable.' });
    expect(memoriesOf(match, 'c1')).toBeUndefined();
    expect(match.getRevision()).toBe(0);
  });

  it('applies self-forgery (pointless self-harm; recall fails closed in M053)', () => {
    const match = campaign();
    const session = match.join(P1);
    expect(
      dispatch(match, session, 'r1', RECORD_TRANSITION, {
        events: [
          {
            seq: 999,
            revision: 9,
            type: 'order.executed',
            priority: 'normal',
            payload: { player: 'p1', commander: 'c0' },
          },
        ],
      }),
    ).toMatchObject({ status: 'applied' });
    expect(memoriesOf(match, 'c0')).toEqual([
      { seq: 999, revision: 9, kind: 'order.executed', subject: 'c0' },
    ]);
  });

  it('faults loud on oversized bookkeeping (never silent drops)', () => {
    const giant: EventProducer = () => [
      {
        type: 'order.canceled',
        priority: 'normal',
        payload: { player: 'p1', commander: 'c0', cleared: 1, note: 'x'.repeat(70000) },
      },
    ];
    const match = campaign({
      p1Orders: [{ kind: 'unit.move', params: { id: 'u0', col: 0, row: 1 } }],
      extraProducers: new Map([[CANCEL_TRANSITION, [giant]]]),
    });
    const session = match.join(P1);
    const req = markUntrusted({
      requestId: 'r1',
      playerId: P1,
      type: CANCEL_TRANSITION,
      payload: { id: 'c0' },
    } as ClientRequest) as Untrusted<ClientRequest>;
    expect(() => match.dispatch(session, req)).toThrow(
      'recordMemories: bookkeeping fault (PAYLOAD_TOO_LARGE).',
    );
    // Fail-stop lands AFTER the game applied (the queue did clear).
    expect(
      match.getSnapshot().commanders?.commanders.find((record) => record.id === 'c0')?.orders,
    ).toEqual([]);
  });
});
