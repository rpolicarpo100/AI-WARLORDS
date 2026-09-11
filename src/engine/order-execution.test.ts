/**
 * M045 — Order execution tests: pop-then-apply through the live verbs,
 * fail-closed keeps-head, composed facts (riders-behind), fail-loud
 * factory, twin determinism, block-close journey (D-039).
 */
import { describe, expect, it } from 'vitest';
import { markUntrusted, type ClientRequest, type PlayerId, type Untrusted } from './authority.js';
import type { CommandersData } from './commanders.js';
import { isMapData, neighborsOf, type MapCell, type MapData } from './map.js';
import { Match, STANDARD_RULESET } from './match.js';
import {
  createExecuteHandler,
  createOrderExecutedProducer,
  EXECUTE_TRANSITION,
  orderExecutionHandlers,
} from './order-execution.js';
import { ISSUE_TRANSITION } from './order-state.js';
import { moveParamsRule, moveProducer, type UnitsConfig } from './warfare.js';
import { createWorldState, type WorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

/** Simulates untrusted wire bytes: unknown input, marked at the boundary. */
function raw(value: unknown): Untrusted<ClientRequest> {
  return markUntrusted(value as ClientRequest);
}

/** Same battle-proven numbers as warfare.test.ts customUnits. */
function drillUnits(): UnitsConfig {
  return {
    worker: { cost: { food: 10 }, maxHp: 5, damage: 1 },
    warrior: { cost: { food: 20, gold: 5 }, maxHp: 12, damage: 4 },
    archer: { cost: { wood: 15, gold: 10 }, maxHp: 8, damage: 3 },
  };
}

/** 3x3 field grid with a gold node at the worker's feet (gather mold). */
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
    id: 'test-execute' as MapData['id'],
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

function neighborOn(
  map: MapData,
  col: number,
  row: number,
  terrain: string,
): { col: number; row: number } {
  const cells = new Map(map.cells.map((cell) => [`${cell.col},${cell.row}`, cell] as const));
  const spot = neighborsOf(map, col, row).find(
    (cell) => cells.get(`${cell.col},${cell.row}`)?.terrain === terrain,
  );
  if (spot === undefined) {
    throw new Error('TEST BUG: no such neighbor');
  }
  return { col: spot.col, row: spot.row };
}

function garrison(): CommandersData {
  return {
    schemaVersion: 1,
    nextId: 2,
    commanders: [
      { id: 'c0', owner: 'p1', active: true, personality: 'strategist', doctrine: 'turtle' },
      { id: 'c1', owner: 'p2', active: true },
    ],
  };
}

function campaign(): Match {
  const map = battleMap();
  const foe = neighborOn(map, 1, 0, 'field');
  return new Match({
    seed: 45,
    ruleset: STANDARD_RULESET,
    players: [P1, P2],
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
      buildings: {
        schemaVersion: 1,
        buildings: {
          p1: { 'town-center': 1, house: 0, storage: 1, barracks: 0, wall: 0, tower: 0 },
          p2: { 'town-center': 1, house: 0, storage: 0, barracks: 0, wall: 0, tower: 0 },
        },
      },
      cities: {
        schemaVersion: 1,
        cities: {
          p1: { level: 1, queue: [] },
          p2: { level: 1, queue: [] },
        },
      },
      commanders: garrison(),
    }),
    unitsConfig: drillUnits(),
  });
}

function battleState(): WorldState {
  const map = battleMap();
  const foe = neighborOn(map, 1, 0, 'field');
  return createWorldState({
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
    commanders: {
      schemaVersion: 1,
      nextId: 1,
      commanders: [
        {
          id: 'c0',
          owner: 'p1',
          active: true,
          orders: [{ kind: 'unit.move', params: { id: 'u0', col: 1, row: 1 } }],
        },
      ],
    },
  });
}

function dispatch(match: Match, rid: string, player: PlayerId, type: string, payload: unknown) {
  return match.dispatch(
    match.join(player),
    raw({ requestId: rid, playerId: player, type, payload }),
  );
}

function queueOf(match: Match, id: string): ReadonlyArray<unknown> {
  return match.getSnapshot().commanders?.commanders.find((r) => r.id === id)?.orders ?? [];
}

function faultsOf(match: Match): number {
  return match.getEvents().filter((e) => e.type === 'system.event-fault').length;
}

describe('order execution (registration)', () => {
  it('exposes exactly the execute transition', () => {
    const deps = { handlers: new Map(), rules: new Map() };
    expect([...orderExecutionHandlers(deps).keys()]).toEqual([EXECUTE_TRANSITION]);
  });

  it('transition name is stable (wire contract)', () => {
    expect(EXECUTE_TRANSITION).toBe('order.execute');
  });
});

describe('execute journeys (one per verb)', () => {
  it('move: head runs through the live handler, queue pops, facts compose', () => {
    const match = campaign();
    const map = match.getSnapshot().map!;
    const target = neighborOn(map, 0, 0, 'field');
    expect(
      dispatch(match, 'r1', P1, ISSUE_TRANSITION, {
        id: 'c0',
        kind: 'unit.move',
        params: { id: 'u0', col: target.col, row: target.row },
      }),
    ).toMatchObject({ status: 'applied' });
    expect(dispatch(match, 'r2', P1, EXECUTE_TRANSITION, { id: 'c0' })).toMatchObject({
      status: 'applied',
    });
    const worker = match.getSnapshot().units?.units.find((u) => u.id === 'u0');
    expect(worker).toMatchObject({ col: target.col, row: target.row });
    expect(queueOf(match, 'c0')).toEqual([]);
    const executedAt = match.getEvents().findIndex((e) => e.type === 'order.executed');
    const fresh = match.getEvents().slice(executedAt, executedAt + 2);
    expect(fresh[0]).toMatchObject({
      type: 'order.executed',
      priority: 'normal',
      payload: { player: 'p1', commander: 'c0', kind: 'unit.move', depth: 0 },
    });
    expect(fresh[1]).toMatchObject({
      type: 'unit.moved',
      payload: { player: 'p1', unit: 'u0', col: target.col, row: target.row },
    });
    expect(faultsOf(match)).toBe(0);
  });

  it('attack: melee head deals live damage, no slain without a kill', () => {
    const match = campaign();
    expect(
      dispatch(match, 'r1', P1, ISSUE_TRANSITION, {
        id: 'c0',
        kind: 'unit.attack',
        params: { id: 'u1', target: 'u2' },
      }),
    ).toMatchObject({ status: 'applied' });
    expect(dispatch(match, 'r2', P1, EXECUTE_TRANSITION, { id: 'c0' })).toMatchObject({
      status: 'applied',
    });
    expect(match.getSnapshot().units?.units.find((u) => u.id === 'u2')?.hp).toBe(4);
    expect(queueOf(match, 'c0')).toEqual([]);
    const executedAt = match.getEvents().findIndex((e) => e.type === 'order.executed');
    const fresh = match.getEvents().slice(executedAt, executedAt + 2);
    expect(fresh[0]).toMatchObject({
      type: 'order.executed',
      payload: { player: 'p1', commander: 'c0', kind: 'unit.attack', depth: 0 },
    });
    expect(fresh[1]).toMatchObject({
      type: 'unit.attacked',
      payload: { player: 'p1', unit: 'u1', target: 'u2', damage: 4 },
    });
    expect(match.getEvents().some((e) => e.type === 'unit.slain')).toBe(false);
    expect(faultsOf(match)).toBe(0);
  });

  it('train: funded head musters a recruit with the next id', () => {
    const match = campaign();
    const beforeIds = new Set((match.getSnapshot().units?.units ?? []).map((u) => u.id));
    expect(
      dispatch(match, 'r1', P1, ISSUE_TRANSITION, {
        id: 'c0',
        kind: 'unit.train',
        params: { type: 'warrior', col: 2, row: 2 },
      }),
    ).toMatchObject({ status: 'applied' });
    expect(dispatch(match, 'r2', P1, EXECUTE_TRANSITION, { id: 'c0' })).toMatchObject({
      status: 'applied',
    });
    const after = match.getSnapshot().units?.units ?? [];
    const recruits = after.filter((u) => !beforeIds.has(u.id));
    expect(recruits).toHaveLength(1);
    expect(recruits[0]).toMatchObject({ owner: 'p1', type: 'warrior', col: 2, row: 2 });
    expect(match.getSnapshot().stockpiles?.stockpiles['p1']).toMatchObject({
      food: 40,
      gold: 20,
    });
    expect(queueOf(match, 'c0')).toEqual([]);
    const executedAt = match.getEvents().findIndex((e) => e.type === 'order.executed');
    const fresh = match.getEvents().slice(executedAt, executedAt + 2);
    expect(fresh[0]).toMatchObject({
      type: 'order.executed',
      payload: { player: 'p1', commander: 'c0', kind: 'unit.train', depth: 0 },
    });
    expect(fresh[1]).toMatchObject({
      type: 'unit.trained',
      payload: { player: 'p1', unit: recruits[0]?.id, type: 'warrior', col: 2, row: 2 },
    });
    expect(faultsOf(match)).toBe(0);
  });

  it('build: free head queues and completes the same dispatch', () => {
    const match = campaign();
    expect(
      dispatch(match, 'r1', P1, ISSUE_TRANSITION, {
        id: 'c0',
        kind: 'city.build',
        params: { type: 'house' },
      }),
    ).toMatchObject({ status: 'applied' });
    expect(dispatch(match, 'r2', P1, EXECUTE_TRANSITION, { id: 'c0' })).toMatchObject({
      status: 'applied',
    });
    expect(match.getSnapshot().buildings?.buildings['p1']?.house).toBe(1);
    expect(queueOf(match, 'c0')).toEqual([]);
    const executedAt = match.getEvents().findIndex((e) => e.type === 'order.executed');
    const fresh = match.getEvents().slice(executedAt, executedAt + 3);
    expect(fresh[0]).toMatchObject({
      type: 'order.executed',
      payload: { player: 'p1', commander: 'c0', kind: 'city.build', depth: 0 },
    });
    expect(fresh[1]).toMatchObject({
      type: 'build.started',
      payload: { player: 'p1', building: 'house' },
    });
    expect(fresh[2]?.type).toBe('build.completed');
    expect(faultsOf(match)).toBe(0);
  });

  it('gather: crewed head takes exactly the node yield', () => {
    const match = campaign();
    expect(
      dispatch(match, 'r1', P1, ISSUE_TRANSITION, {
        id: 'c0',
        kind: 'economy.gather',
        params: { col: 0, row: 0 },
      }),
    ).toMatchObject({ status: 'applied' });
    expect(dispatch(match, 'r2', P1, EXECUTE_TRANSITION, { id: 'c0' })).toMatchObject({
      status: 'applied',
    });
    expect(match.getSnapshot().stockpiles?.stockpiles['p1']?.gold).toBe(26);
    const node = match.getSnapshot().map?.cells.find((c) => c.col === 0 && c.row === 0)?.resource;
    expect(node).toEqual({ type: 'gold', amount: 4 });
    expect(queueOf(match, 'c0')).toEqual([]);
    const executedAt = match.getEvents().findIndex((e) => e.type === 'order.executed');
    const fresh = match.getEvents().slice(executedAt, executedAt + 2);
    expect(fresh[0]).toMatchObject({
      type: 'order.executed',
      payload: { player: 'p1', commander: 'c0', kind: 'economy.gather', depth: 0 },
    });
    expect(fresh[1]).toMatchObject({
      type: 'resource.gathered',
      payload: { player: 'p1', col: 0, row: 0, resource: 'gold', amount: 1 },
    });
    expect(faultsOf(match)).toBe(0);
  });
});

describe('execute fail-closed (queue keeps its head)', () => {
  it('rule-invalid head rejects and stays queued', () => {
    const match = campaign();
    expect(
      dispatch(match, 'r1', P1, ISSUE_TRANSITION, {
        id: 'c0',
        kind: 'unit.move',
        params: { id: 'u0' },
      }),
    ).toMatchObject({ status: 'applied' });
    const eventsBefore = match.getEvents().length;
    expect(dispatch(match, 'r2', P1, EXECUTE_TRANSITION, { id: 'c0' })).toEqual({
      status: 'rejected',
      reason: 'execute: bad head.',
    });
    expect(queueOf(match, 'c0')).toEqual([{ kind: 'unit.move', params: { id: 'u0' } }]);
    expect(match.getEvents()).toHaveLength(eventsBefore);
  });

  it('verb rejection propagates verbatim and the board stays put', () => {
    const match = campaign();
    const map = match.getSnapshot().map!;
    const far = { col: 2, row: 2 };
    const adjacent = neighborsOf(map, 0, 0).some((c) => c.col === far.col && c.row === far.row);
    if (adjacent) {
      throw new Error('TEST BUG: far cell is adjacent');
    }
    expect(
      dispatch(match, 'r1', P1, ISSUE_TRANSITION, {
        id: 'c0',
        kind: 'unit.move',
        params: { id: 'u0', ...far },
      }),
    ).toMatchObject({ status: 'applied' });
    expect(dispatch(match, 'r2', P1, EXECUTE_TRANSITION, { id: 'c0' })).toEqual({
      status: 'rejected',
      reason: 'move: not adjacent.',
    });
    expect(match.getSnapshot().units?.units.find((u) => u.id === 'u0')).toMatchObject({
      col: 0,
      row: 0,
    });
    expect(queueOf(match, 'c0')).toHaveLength(1);
  });

  it('empty queue, unknown commander, and cross-holder fail closed', () => {
    const match = campaign();
    expect(dispatch(match, 'r1', P1, EXECUTE_TRANSITION, { id: 'c0' })).toEqual({
      status: 'rejected',
      reason: 'execute: queue empty.',
    });
    expect(dispatch(match, 'r2', P1, EXECUTE_TRANSITION, { id: 'c9' })).toEqual({
      status: 'rejected',
      reason: 'execute: unknown commander.',
    });
    const bare = new Match({
      seed: 45,
      ruleset: STANDARD_RULESET,
      players: [P1, P2],
      initialState: createWorldState({ players: [P1, P2] }),
    });
    expect(dispatch(bare, 'r1', P1, EXECUTE_TRANSITION, { id: 'c0' })).toEqual({
      status: 'rejected',
      reason: 'execute: unknown commander.',
    });
  });

  it('cross-holder execute fails closed with the queue intact', () => {
    const match = campaign();
    expect(
      dispatch(match, 'r1', P1, ISSUE_TRANSITION, {
        id: 'c0',
        kind: 'city.build',
        params: { type: 'house' },
      }),
    ).toMatchObject({ status: 'applied' });
    expect(dispatch(match, 'r2', P2, EXECUTE_TRANSITION, { id: 'c0' })).toEqual({
      status: 'rejected',
      reason: 'execute: not owner.',
    });
    expect(queueOf(match, 'c0')).toHaveLength(1);
  });

  it('wire-shape abuse is rejected at the shared commander-id rule', () => {
    const match = campaign();
    expect(dispatch(match, 'r1', P1, EXECUTE_TRANSITION, {})).toEqual({
      status: 'rejected',
      reason: 'validation: [commander-id-params] command takes a string id',
    });
  });
});

describe('execute handler (unit: direct injection)', () => {
  it('missing rule fails closed without touching state', () => {
    const state = battleState();
    const handler = createExecuteHandler({ handlers: new Map(), rules: new Map() });
    expect(handler({ state, caller: P1, params: { id: 'c0' } })).toEqual({
      applied: false,
      reason: 'execute: no rule.',
    });
  });

  it('missing handler fails closed after the real rule passes', () => {
    const state = battleState();
    const handler = createExecuteHandler({
      handlers: new Map(),
      rules: new Map([['unit.move', moveParamsRule]]),
    });
    expect(handler({ state, caller: P1, params: { id: 'c0' } })).toEqual({
      applied: false,
      reason: 'execute: no handler.',
    });
  });
});

describe('executed producer (unit: composed facts)', () => {
  function queued(commanders: CommandersData): WorldState {
    return createWorldState({ players: [P1, P2], commanders });
  }

  const staffed: CommandersData = {
    schemaVersion: 1,
    nextId: 1,
    commanders: [
      {
        id: 'c0',
        owner: 'p1',
        active: true,
        orders: [{ kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } }],
      },
    ],
  };
  const drained: CommandersData = {
    schemaVersion: 1,
    nextId: 1,
    commanders: [{ id: 'c0', owner: 'p1', active: true, orders: [] }],
  };

  it('replays the verb facts behind the acknowledgment (riders-behind)', () => {
    const produce = createOrderExecutedProducer(new Map([['unit.move', moveProducer]]));
    expect(
      produce({
        type: EXECUTE_TRANSITION,
        caller: P1,
        params: { id: 'c0' },
        before: queued(staffed),
        after: queued(drained),
      }),
    ).toEqual([
      {
        type: 'order.executed',
        priority: 'normal',
        payload: { player: 'p1', commander: 'c0', kind: 'unit.move', depth: 0 },
      },
      {
        type: 'unit.moved',
        priority: 'low',
        payload: { player: 'p1', unit: 'u0', col: 1, row: 0 },
      },
    ]);
  });

  it('acknowledges alone when no sub-producer is wired', () => {
    const produce = createOrderExecutedProducer(new Map());
    expect(
      produce({
        type: EXECUTE_TRANSITION,
        caller: P1,
        params: { id: 'c0' },
        before: queued(staffed),
        after: queued(drained),
      }),
    ).toEqual([
      {
        type: 'order.executed',
        priority: 'normal',
        payload: { player: 'p1', commander: 'c0', kind: 'unit.move', depth: 0 },
      },
    ]);
  });

  it('treats an absent before-queue as empty (fail loud)', () => {
    const bare: CommandersData = {
      schemaVersion: 1,
      nextId: 1,
      commanders: [{ id: 'c0', owner: 'p1', active: true }],
    };
    const produce = createOrderExecutedProducer(new Map());
    expect(() =>
      produce({
        type: EXECUTE_TRANSITION,
        caller: P1,
        params: { id: 'c0' },
        before: queued(bare),
        after: queued(bare),
      }),
    ).toThrow(/empty queue/);
  });

  it('treats an absent after-queue as fully drained (Ack still stands)', () => {
    const bare: CommandersData = {
      schemaVersion: 1,
      nextId: 1,
      commanders: [{ id: 'c0', owner: 'p1', active: true }],
    };
    const produce = createOrderExecutedProducer(new Map());
    expect(
      produce({
        type: EXECUTE_TRANSITION,
        caller: P1,
        params: { id: 'c0' },
        before: queued(staffed),
        after: queued(bare),
      }),
    ).toEqual([
      {
        type: 'order.executed',
        priority: 'normal',
        payload: { player: 'p1', commander: 'c0', kind: 'unit.move', depth: 0 },
      },
    ]);
  });

  it.each([[7], ['x'], [null], [{}], [{ id: 7 }]])('bad execute params fail loud %p', (params) => {
    const produce = createOrderExecutedProducer(new Map());
    expect(() =>
      produce({
        type: EXECUTE_TRANSITION,
        caller: P1,
        params,
        before: queued(staffed),
        after: queued(drained),
      }),
    ).toThrow('orderExecutedProducer: execute takes { id }.');
  });

  it('unknown commander fails loud', () => {
    const produce = createOrderExecutedProducer(new Map());
    expect(() =>
      produce({
        type: EXECUTE_TRANSITION,
        caller: P1,
        params: { id: 'c9' },
        before: queued(staffed),
        after: queued(drained),
      }),
    ).toThrow('orderExecutedProducer: unknown commander.');
  });

  it('empty queue fails loud', () => {
    const produce = createOrderExecutedProducer(new Map());
    expect(() =>
      produce({
        type: EXECUTE_TRANSITION,
        caller: P1,
        params: { id: 'c0' },
        before: queued(drained),
        after: queued(drained),
      }),
    ).toThrow('orderExecutedProducer: executed an empty queue.');
  });

  it('un-popped queue fails loud', () => {
    const produce = createOrderExecutedProducer(new Map());
    expect(() =>
      produce({
        type: EXECUTE_TRANSITION,
        caller: P1,
        params: { id: 'c0' },
        before: queued(staffed),
        after: queued(staffed),
      }),
    ).toThrow('orderExecutedProducer: queue did not pop its head.');
  });
});

describe('order block close (integration)', () => {
  it('issue → issue → execute → execute journeys the full arc with zero faults', () => {
    const match = campaign();
    const map = match.getSnapshot().map!;
    const target = neighborOn(map, 0, 0, 'field');
    const script: ReadonlyArray<readonly [string, string, unknown]> = [
      [
        'r1',
        ISSUE_TRANSITION,
        { id: 'c0', kind: 'unit.move', params: { id: 'u0', col: target.col, row: target.row } },
      ],
      ['r2', ISSUE_TRANSITION, { id: 'c0', kind: 'city.build', params: { type: 'house' } }],
      ['r3', EXECUTE_TRANSITION, { id: 'c0' }],
      ['r4', EXECUTE_TRANSITION, { id: 'c0' }],
    ];
    for (const [rid, type, payload] of script) {
      expect(dispatch(match, rid, P1, type, payload)).toMatchObject({ status: 'applied' });
    }
    const arc = new Set([
      'order.issued',
      'order.executed',
      'unit.moved',
      'build.started',
      'build.completed',
    ]);
    expect(
      match
        .getEvents()
        .filter((e) => arc.has(e.type))
        .map((e) => e.type),
    ).toEqual([
      'order.issued',
      'order.issued',
      'order.executed',
      'unit.moved',
      'order.executed',
      'build.started',
      'build.completed',
    ]);
    expect(faultsOf(match)).toBe(0);
    expect(queueOf(match, 'c0')).toEqual([]);
    expect(match.getSnapshot().units?.units.find((u) => u.id === 'u0')).toMatchObject({
      col: target.col,
      row: target.row,
    });
    expect(match.getSnapshot().buildings?.buildings['p1']?.house).toBe(1);
  });

  it('twin Matches replay the arc bit-identically', () => {
    const run = (): Match => {
      const match = campaign();
      const map = match.getSnapshot().map!;
      const target = neighborOn(map, 0, 0, 'field');
      const script: ReadonlyArray<readonly [string, string, unknown]> = [
        ['r1', ISSUE_TRANSITION, { id: 'c0', kind: 'economy.gather', params: { col: 0, row: 0 } }],
        [
          'r2',
          ISSUE_TRANSITION,
          { id: 'c0', kind: 'unit.move', params: { id: 'u0', col: target.col, row: target.row } },
        ],
        ['r3', EXECUTE_TRANSITION, { id: 'c0' }],
        ['r4', EXECUTE_TRANSITION, { id: 'c0' }],
      ];
      for (const [rid, type, payload] of script) {
        expect(dispatch(match, rid, P1, type, payload)).toMatchObject({ status: 'applied' });
      }
      return match;
    };
    const a = run();
    const b = run();
    expect(a.getSnapshot()).toEqual(b.getSnapshot());
    expect(a.getEvents()).toEqual(b.getEvents());
  });
});
