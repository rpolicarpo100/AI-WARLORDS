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
import { DEACTIVATE_TRANSITION } from './commander-state.js';
import type { EventProducer } from './events.js';
import { isMapData, neighborsOf, type MapCell, type MapData } from './map.js';
import { Match, STANDARD_RULESET } from './match.js';
import { RECORD_TRANSITION } from './memory-record.js';
import { DECLINE_TRANSITION, PROPOSE_TRANSITION } from './proposal-state.js';
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
  readonly c0Dna?: CommanderRecord['dna'];
  readonly c0Directives?: CommanderRecord['directives'];
  readonly c0Proposal?: CommanderRecord['proposal'];
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
        ...(options.c0Dna === undefined ? {} : { dna: options.c0Dna }),
        ...(options.c0Directives === undefined ? {} : { directives: options.c0Directives }),
        ...(options.c0Proposal === undefined ? {} : { proposal: options.c0Proposal }),
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

  it('records executed heads AND their battle facts (M053 ambient fan-out)', () => {
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
    const executed = match.getEvents().find((event) => event.type === 'order.executed');
    const attacked = match.getEvents().find((event) => event.type === 'unit.attacked');
    expect(attacked).toMatchObject({ revision: 2 });
    expect(memoriesOf(match, 'c0')).toEqual([
      { seq: executed?.seq, revision: 2, kind: 'order.executed', subject: 'c0' },
      { seq: attacked?.seq, revision: 2, kind: 'unit.attacked', subject: 'u1' },
    ]);
    // The enemy commander keeps its own counsel (caller-bound).
    expect(memoriesOf(match, 'c1')).toBeUndefined();
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

describe('recall (live validation)', () => {
  function executedCampaign(): Match {
    const match = campaign();
    const session = match.join(P1);
    const issue = dispatch(match, session, 'r1', ISSUE_TRANSITION, {
      id: 'c0',
      kind: 'unit.attack',
      params: { id: 'u1', target: 'u2' },
    });
    if (issue.status !== 'applied') {
      throw new Error('TEST BUG: issue must apply');
    }
    const execute = dispatch(match, session, 'r2', EXECUTE_TRANSITION, { id: 'c0' });
    if (execute.status !== 'applied') {
      throw new Error('TEST BUG: execute must apply');
    }
    return match;
  }

  it('recalls fresh memories validated against the stream', () => {
    const match = executedCampaign();
    const recollection = match.recall('c0');
    expect(recollection?.stale).toEqual([]);
    expect(recollection?.fresh).toEqual([
      {
        seq: match.getEvents().find((event) => event.type === 'order.executed')?.seq,
        revision: 2,
        kind: 'order.executed',
        subject: 'c0',
      },
      {
        seq: match.getEvents().find((event) => event.type === 'unit.attacked')?.seq,
        revision: 2,
        kind: 'unit.attacked',
        subject: 'u1',
      },
    ]);
  });

  it('fails soft on unknown commanders', () => {
    expect(executedCampaign().recall('c9')).toBeUndefined();
  });

  it('narrows recall by subject (about X)', () => {
    const match = executedCampaign();
    expect(match.recall('c0', 'u1')?.fresh).toEqual([
      {
        seq: match.getEvents().find((event) => event.type === 'unit.attacked')?.seq,
        revision: 2,
        kind: 'unit.attacked',
        subject: 'u1',
      },
    ]);
    expect(match.recall('c0', 'nobody')).toEqual({ fresh: [], stale: [] });
  });

  it('flags self-forged memories as stale (M052 forgery meets truth)', () => {
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
    expect(match.recall('c0')).toEqual({
      fresh: [],
      stale: [{ seq: 999, revision: 9, kind: 'order.executed', subject: 'c0' }],
    });
  });
});

describe('stancesOf (M054 live recalled posture)', () => {
  const EDGY_DNA = {
    aggression: 60,
    defense: 50,
    economy: 50,
    exploration: 50,
    risk: 50,
    expansion: 50,
    diplomacy: 50,
    patience: 50,
    greed: 50,
    adaptability: 50,
  };

  it('reads DNA stance exactly when memoryless (M038 behavior intact)', () => {
    const match = campaign({ c0Dna: EDGY_DNA });
    expect(match.stancesOf('p1')).toEqual([{ id: 'c0', stance: 'balanced' }]);
  });

  it('emboldens posture after recalled battle (balanced → aggressive)', () => {
    const match = campaign({ c0Dna: EDGY_DNA });
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
    // One recalled battle: 60 + 5 − 50 = 15 clears the margin.
    expect(match.stancesOf('p1')).toEqual([{ id: 'c0', stance: 'aggressive' }]);
    expect(match.recall('c0')?.fresh.map((memory) => memory.kind)).toEqual([
      'order.executed',
      'unit.attacked',
    ]);
  });
});

describe('autofileProposals (M059 assisted proposer, live bookkeeping)', () => {
  const EDGY_DNA = {
    aggression: 60,
    defense: 50,
    economy: 50,
    exploration: 50,
    risk: 50,
    expansion: 50,
    diplomacy: 50,
    patience: 50,
    greed: 50,
    adaptability: 50,
  };

  function attack(match: Match, session: SessionHandle, tag: string): void {
    expect(
      dispatch(match, session, `${tag}-issue`, ISSUE_TRANSITION, {
        id: 'c0',
        kind: 'unit.attack',
        params: { id: 'u1', target: 'u2' },
      }),
    ).toMatchObject({ status: 'applied' });
    expect(dispatch(match, session, `${tag}-exec`, EXECUTE_TRANSITION, { id: 'c0' })).toMatchObject(
      {
        status: 'applied',
      },
    );
  }

  function proposalOf(match: Match, id: string): unknown {
    return match.getSnapshot().commanders?.commanders.find((record) => record.id === id)?.proposal;
  }

  it('files a stance proposal from the first recalled battle (assisted, budget-free)', () => {
    const match = campaign({ c0Dna: EDGY_DNA, c0Directives: { autonomy: 'assisted' } });
    const session = match.join(P1);
    attack(match, session, 'r1');
    expect(proposalOf(match, 'c0')).toEqual({ kind: 'stance', stance: 'aggressive' });
    expect(match.getEvents().find((event) => event.type === 'proposal.proposed')).toMatchObject({
      priority: 'normal',
      payload: { player: 'p1', commander: 'c0', kind: 'stance' },
    });
    expect(promptsOf(match, 'p1')).toBe(8);
  });

  it('files AND self-approves the same lance for autonomous commanders', () => {
    const match = campaign({ c0Dna: EDGY_DNA, c0Directives: { autonomy: 'autonomous' } });
    const session = match.join(P1);
    attack(match, session, 'r1');
    const record = match.getSnapshot().commanders?.commanders.find((entry) => entry.id === 'c0');
    expect(record?.directives).toEqual({ autonomy: 'autonomous', stance: 'aggressive' });
    expect(record !== undefined && 'proposal' in record).toBe(false);
    expect(match.getEvents().find((event) => event.type === 'proposal.proposed')).toMatchObject({
      payload: { player: 'p1', commander: 'c0', kind: 'stance' },
    });
    expect(match.getEvents().find((event) => event.type === 'proposal.approved')).toMatchObject({
      priority: 'normal',
      payload: { player: 'p1', commander: 'c0', kind: 'stance' },
    });
  });

  it('stays silent for manual and directive-less commanders', () => {
    const manual = campaign({ c0Dna: EDGY_DNA, c0Directives: { autonomy: 'manual' } });
    const manualSession = manual.join(P1);
    attack(manual, manualSession, 'r1');
    expect(proposalOf(manual, 'c0')).toBeUndefined();
    const plain = campaign({ c0Dna: EDGY_DNA });
    const plainSession = plain.join(P1);
    attack(plain, plainSession, 'r1');
    expect(proposalOf(plain, 'c0')).toBeUndefined();
  });

  it('leaves occupied slots and set stances untouched', () => {
    const busy = campaign({
      c0Dna: EDGY_DNA,
      c0Directives: { autonomy: 'assisted' },
      c0Proposal: { kind: 'stance', stance: 'defensive' },
    });
    const busySession = busy.join(P1);
    attack(busy, busySession, 'r1');
    expect(proposalOf(busy, 'c0')).toEqual({ kind: 'stance', stance: 'defensive' });
    const ordered = campaign({
      c0Dna: EDGY_DNA,
      c0Directives: { autonomy: 'assisted', stance: 'defensive' },
    });
    const orderedSession = ordered.join(P1);
    attack(ordered, orderedSession, 'r1');
    expect(proposalOf(ordered, 'c0')).toBeUndefined();
  });

  it('stays silent when the lesson does not diverge from DNA', () => {
    const fifties = {
      aggression: 50,
      defense: 50,
      economy: 50,
      exploration: 50,
      risk: 50,
      expansion: 50,
      diplomacy: 50,
      patience: 50,
      greed: 50,
      adaptability: 50,
    };
    const match = campaign({ c0Dna: fifties, c0Directives: { autonomy: 'assisted' } });
    const session = match.join(P1);
    attack(match, session, 'r1');
    expect(proposalOf(match, 'c0')).toBeUndefined();
  });

  it('keeps declines declined until new evidence refiles', () => {
    const match = campaign({ c0Dna: EDGY_DNA, c0Directives: { autonomy: 'assisted' } });
    const session = match.join(P1);
    attack(match, session, 'r1');
    expect(proposalOf(match, 'c0')).toEqual({ kind: 'stance', stance: 'aggressive' });
    expect(dispatch(match, session, 'r2', DECLINE_TRANSITION, { id: 'c0' })).toMatchObject({
      status: 'applied',
    });
    expect(proposalOf(match, 'c0')).toBeUndefined();
    attack(match, session, 'r3');
    expect(proposalOf(match, 'c0')).toEqual({ kind: 'stance', stance: 'aggressive' });
  });

  it('skips inactive commanders with live divergence', () => {
    const match = campaign({ c0Dna: EDGY_DNA, c0Directives: { autonomy: 'assisted' } });
    const session = match.join(P1);
    attack(match, session, 'r1');
    expect(dispatch(match, session, 'r2', DECLINE_TRANSITION, { id: 'c0' })).toMatchObject({
      status: 'applied',
    });
    expect(dispatch(match, session, 'r3', DEACTIVATE_TRANSITION, { id: 'c0' })).toMatchObject({
      status: 'applied',
    });
    expect(
      dispatch(match, session, 'r4', ISSUE_TRANSITION, {
        id: 'c0',
        kind: 'unit.move',
        params: { id: 'u0', col: 0, row: 1 },
      }),
    ).toMatchObject({ status: 'applied' });
    expect(proposalOf(match, 'c0')).toBeUndefined();
  });

  it('runs clean on commander-less states', () => {
    const bare = new Match({
      seed: 59,
      ruleset: STANDARD_RULESET,
      players: [P1, P2],
      unitsConfig: drillUnits(),
      initialState: createWorldState({
        players: [P1, P2],
        map: battleMap(),
        units: {
          schemaVersion: 1,
          nextId: 1,
          units: [{ id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 }],
        },
      }),
    });
    const session = bare.join(P1);
    expect(
      dispatch(bare, session, 'r1', MOVE_TRANSITION, { id: 'u0', col: 0, row: 1 }),
    ).toMatchObject({ status: 'applied' });
    expect(bare.getEvents().some((event) => event.type === 'proposal.proposed')).toBe(false);
  });
});

describe('autoapproveProposals (M060 self-verdict, live bookkeeping)', () => {
  const EDGY_DNA = {
    aggression: 60,
    defense: 50,
    economy: 50,
    exploration: 50,
    risk: 50,
    expansion: 50,
    diplomacy: 50,
    patience: 50,
    greed: 50,
    adaptability: 50,
  };

  function attack(match: Match, session: SessionHandle, tag: string): void {
    expect(
      dispatch(match, session, `${tag}-issue`, ISSUE_TRANSITION, {
        id: 'c0',
        kind: 'unit.attack',
        params: { id: 'u1', target: 'u2' },
      }),
    ).toMatchObject({ status: 'applied' });
    expect(dispatch(match, session, `${tag}-exec`, EXECUTE_TRANSITION, { id: 'c0' })).toMatchObject(
      {
        status: 'applied',
      },
    );
  }

  function recordOf(match: Match, id: string): CommanderRecord | undefined {
    return match.getSnapshot().commanders?.commanders.find((record) => record.id === id);
  }

  it('leaves assisted verdicts to the holder (THE ladder distinction)', () => {
    const match = campaign({ c0Dna: EDGY_DNA, c0Directives: { autonomy: 'assisted' } });
    const session = match.join(P1);
    attack(match, session, 'r1');
    expect(recordOf(match, 'c0')?.proposal).toEqual({ kind: 'stance', stance: 'aggressive' });
    expect(recordOf(match, 'c0')?.directives).toEqual({ autonomy: 'assisted' });
    expect(match.getEvents().some((event) => event.type === 'proposal.approved')).toBe(false);
  });

  it('stays silent for manual, directive-less and empty autonomous slots', () => {
    for (const c0Directives of [
      { autonomy: 'manual' },
      undefined,
      { autonomy: 'autonomous' },
    ] as const) {
      const match = campaign({ c0Directives });
      const session = match.join(P1);
      attack(match, session, 'r1');
      expect(recordOf(match, 'c0')?.proposal).toBeUndefined();
      expect(match.getEvents().some((event) => event.type === 'proposal.approved')).toBe(false);
    }
  });

  it('skips inactive autonomous commanders with pending proposals', () => {
    const match = campaign({ c0Directives: { autonomy: 'autonomous' } });
    const session = match.join(P1);
    expect(dispatch(match, session, 'r1', DEACTIVATE_TRANSITION, { id: 'c0' })).toMatchObject({
      status: 'applied',
    });
    expect(
      dispatch(match, session, 'r2', PROPOSE_TRANSITION, {
        id: 'c0',
        proposal: { kind: 'stance', stance: 'defensive' },
      }),
    ).toMatchObject({ status: 'applied' });
    expect(
      dispatch(match, session, 'r3', ISSUE_TRANSITION, {
        id: 'c0',
        kind: 'unit.move',
        params: { id: 'u0', col: 0, row: 1 },
      }),
    ).toMatchObject({ status: 'applied' });
    expect(recordOf(match, 'c0')?.proposal).toEqual({ kind: 'stance', stance: 'defensive' });
  });

  it('retries full queues silently until space frees', () => {
    const match = campaign({
      c0Directives: { autonomy: 'autonomous' },
      p1Orders: [
        { kind: 'unit.move' },
        { kind: 'unit.move' },
        { kind: 'unit.move' },
        { kind: 'unit.move' },
        { kind: 'unit.move' },
        { kind: 'unit.move' },
        { kind: 'unit.move' },
        { kind: 'unit.move' },
      ],
    });
    const session = match.join(P1);
    const order = { kind: 'unit.move', params: { id: 'u0', col: 2, row: 2 } };
    expect(
      dispatch(match, session, 'r1', PROPOSE_TRANSITION, {
        id: 'c0',
        proposal: { kind: 'order', order },
      }),
    ).toMatchObject({ status: 'applied' });
    expect(recordOf(match, 'c0')?.proposal).toMatchObject({ kind: 'order' });
    expect(match.getEvents().some((event) => event.type === 'proposal.approved')).toBe(false);
    expect(dispatch(match, session, 'r2', CANCEL_TRANSITION, { id: 'c0' })).toMatchObject({
      status: 'applied',
    });
    const record = recordOf(match, 'c0');
    expect(record?.orders).toHaveLength(1);
    expect(record?.orders?.[0]).toEqual(order);
    expect(record !== undefined && 'proposal' in record).toBe(false);
    expect(match.getEvents().find((event) => event.type === 'proposal.approved')).toMatchObject({
      payload: { player: 'p1', commander: 'c0', kind: 'order' },
    });
  });
});
