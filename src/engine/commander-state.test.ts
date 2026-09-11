/**
 * M029 — Commander State tests: commission mint + bootstrap, owner-only
 * activate/deactivate, structural producers, marker semantics (D-023).
 */
import { describe, expect, it } from 'vitest';
import { markUntrusted, type ClientRequest, type PlayerId, type Untrusted } from './authority.js';
import {
  ACTIVATE_TRANSITION,
  commissionedProducer,
  COMMISSION_TRANSITION,
  commanderHandlers,
  commanderIdParamsRule,
  createActivateHandler,
  createCommissionHandler,
  createDeactivateHandler,
  DEACTIVATE_TRANSITION,
  stateFlipProducer,
} from './commander-state.js';
import type { CommandersData } from './commanders.js';
import { UPGRADE_TRANSITION } from './economy.js';
import { Match, STANDARD_RULESET } from './match.js';
import { MAX_UINT32 } from './rng.js';
import { createWorldState } from './world-state.js';
import { perceive } from './views.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

/** Simulates untrusted wire bytes: unknown input, marked at the boundary. */
function raw(value: unknown): Untrusted<ClientRequest> {
  return markUntrusted(value as ClientRequest);
}

function stateMatch(commanders?: CommandersData): Match {
  return new Match({
    seed: 29,
    ruleset: STANDARD_RULESET,
    players: [P1, P2],
    initialState: createWorldState({
      players: [P1, P2],
      ...(commanders === undefined ? {} : { commanders }),
    }),
  });
}

function commission(match: Match, rid: string, player: PlayerId, payload: unknown = {}) {
  return match.dispatch(
    match.join(player),
    raw({ requestId: rid, playerId: player, type: COMMISSION_TRANSITION, payload }),
  );
}

function flip(match: Match, rid: string, player: PlayerId, type: string, id: string) {
  return match.dispatch(
    match.join(player),
    raw({ requestId: rid, playerId: player, type, payload: { id } }),
  );
}

function raise(match: Match, rid: string, player: PlayerId) {
  return match.dispatch(
    match.join(player),
    raw({ requestId: rid, playerId: player, type: UPGRADE_TRANSITION, payload: {} }),
  );
}

function noop(match: Match, rid: string, player: PlayerId) {
  return match.dispatch(
    match.join(player),
    raw({ requestId: rid, playerId: player, type: 'world.noop', payload: {} }),
  );
}

describe('commander handlers (registration)', () => {
  it('exposes exactly the three lifecycle transitions', () => {
    expect([...commanderHandlers().keys()].sort()).toEqual([
      ACTIVATE_TRANSITION,
      COMMISSION_TRANSITION,
      DEACTIVATE_TRANSITION,
    ]);
  });

  it('transition names are stable (wire contract)', () => {
    expect(COMMISSION_TRANSITION).toBe('commander.commission');
    expect(ACTIVATE_TRANSITION).toBe('commander.activate');
    expect(DEACTIVATE_TRANSITION).toBe('commander.deactivate');
  });
});

describe('commanderIdParamsRule (unit)', () => {
  it('accepts { id }', () => {
    expect(commanderIdParamsRule(P1, { id: 'c0' })).toBeNull();
  });

  it.each([null, [], 'c0', 7])('rejects non-object params %p', (params) => {
    expect(commanderIdParamsRule(P1, params)).toEqual({
      rule: 'commander-id-params',
      detail: 'command takes { id }',
    });
  });

  it.each([{}, { id: 7 }, { id: null }])('rejects non-string id %p', (params) => {
    expect(commanderIdParamsRule(P1, params)).toEqual({
      rule: 'commander-id-params',
      detail: 'command takes a string id',
    });
  });
});

describe('commission (dispatch)', () => {
  it('golden: bootstraps absent data, mints c0 active for the caller', () => {
    const match = stateMatch();
    expect(commission(match, 'r1', P1)).toEqual({
      status: 'applied',
      revision: 1,
      summary: 'commissioned c0',
    });
    expect(match.getSnapshot().commanders).toEqual({
      schemaVersion: 1,
      nextId: 1,
      commanders: [{ id: 'c0', owner: 'p1', active: true }],
    });
  });

  it('spends 1 prompt (dispatch cost, not commander effect)', () => {
    const match = stateMatch();
    commission(match, 'r1', P1);
    expect(match.getSnapshot().prompts?.remaining).toEqual({ p1: 9, p2: 10 });
  });

  it('mints sequential ids from nextId (c1, nextId 2)', () => {
    const match = stateMatch();
    commission(match, 'r1', P1);
    commission(match, 'r2', P1);
    expect(match.getSnapshot().commanders).toEqual({
      schemaVersion: 1,
      nextId: 2,
      commanders: [
        { id: 'c0', owner: 'p1', active: true },
        { id: 'c1', owner: 'p1', active: true },
      ],
    });
  });

  it('roster N per holder: ids are global, owners stick to callers', () => {
    const match = stateMatch();
    commission(match, 'r1', P1);
    commission(match, 'r2', P2);
    commission(match, 'r3', P1);
    expect(match.getSnapshot().commanders?.commanders).toEqual([
      { id: 'c0', owner: 'p1', active: true },
      { id: 'c1', owner: 'p2', active: true },
      { id: 'c2', owner: 'p1', active: true },
    ]);
  });

  it('emits commander.commissioned in sequence', () => {
    const match = stateMatch();
    commission(match, 'r1', P1);
    expect(match.getEvents().map((e) => e.type)).toEqual([
      'match.started',
      'commander.commissioned',
    ]);
    expect(match.getEvents()[1]).toEqual({
      seq: 2,
      revision: 1,
      type: 'commander.commissioned',
      priority: 'normal',
      payload: { player: 'p1', commander: 'c0' },
    });
  });

  it('rejects a non-empty payload (no-params wire, upgrade precedent)', () => {
    const match = stateMatch();
    expect(commission(match, 'r1', P1, { id: 'c0' })).toEqual({
      status: 'rejected',
      reason: 'validation: [no-params] commander.commission takes no parameters',
    });
    expect(match.getSnapshot().commanders).toBeUndefined();
  });

  it('roster exhausted: nextId at the word ceiling stays rejected and free', () => {
    const match = stateMatch({ schemaVersion: 1, nextId: MAX_UINT32, commanders: [] });
    const before = match.getSnapshot();
    expect(commission(match, 'r1', P1)).toEqual({
      status: 'rejected',
      reason: 'commission: roster exhausted.',
    });
    expect(match.getSnapshot()).toEqual(before);
    expect(match.getSnapshot().prompts?.remaining).toEqual({ p1: 10, p2: 10 });
  });

  it('mint collision with hand-crafted data fails loud (HANDLER_FAULT, atomic)', () => {
    const match = stateMatch({
      schemaVersion: 1,
      nextId: 0,
      commanders: [{ id: 'c0', owner: 'p2', active: true }],
    });
    const before = match.getSnapshot();
    expect(commission(match, 'r1', P1)).toEqual({ status: 'error', code: 'HANDLER_FAULT' });
    expect(match.getSnapshot()).toEqual(before);
  });
});

describe('activate (dispatch)', () => {
  function deactivated(): Match {
    const match = stateMatch();
    commission(match, 'r1', P1);
    flip(match, 'r2', P1, DEACTIVATE_TRANSITION, 'c0');
    return match;
  }

  it('golden: flips an inactive own commander, exact summary', () => {
    const match = deactivated();
    expect(flip(match, 'r3', P1, ACTIVATE_TRANSITION, 'c0')).toEqual({
      status: 'applied',
      revision: 3,
      summary: 'activated c0',
    });
    expect(match.getSnapshot().commanders?.commanders).toEqual([
      { id: 'c0', owner: 'p1', active: true },
    ]);
    expect(match.getSnapshot().commanders?.nextId).toBe(1);
  });

  it('spends 1 prompt', () => {
    const match = deactivated();
    flip(match, 'r3', P1, ACTIVATE_TRANSITION, 'c0');
    expect(match.getSnapshot().prompts?.remaining).toEqual({ p1: 7, p2: 10 });
  });

  it('unknown id stays rejected (present and absent data)', () => {
    const match = deactivated();
    expect(flip(match, 'r3', P1, ACTIVATE_TRANSITION, 'c9')).toEqual({
      status: 'rejected',
      reason: 'activate: unknown commander.',
    });
    const fresh = stateMatch();
    expect(flip(fresh, 'r1', P1, ACTIVATE_TRANSITION, 'c0')).toEqual({
      status: 'rejected',
      reason: 'activate: unknown commander.',
    });
  });

  it("other holder's commander stays rejected (owner-only, fail-closed)", () => {
    const match = stateMatch();
    commission(match, 'r1', P2);
    expect(flip(match, 'r2', P1, ACTIVATE_TRANSITION, 'c0')).toEqual({
      status: 'rejected',
      reason: 'activate: not owner.',
    });
    expect(match.getSnapshot().commanders?.commanders).toEqual([
      { id: 'c0', owner: 'p2', active: true },
    ]);
  });

  it('already-active stays rejected (no-op flip, upgrade precedent)', () => {
    const match = stateMatch();
    commission(match, 'r1', P1);
    expect(flip(match, 'r2', P1, ACTIVATE_TRANSITION, 'c0')).toEqual({
      status: 'rejected',
      reason: 'activate: already active.',
    });
  });

  it('malformed params stay rejected at the pre-rule', () => {
    const match = deactivated();
    const bad = match.dispatch(
      match.join(P1),
      raw({ requestId: 'r3', playerId: P1, type: ACTIVATE_TRANSITION, payload: {} }),
    );
    expect(bad).toEqual({
      status: 'rejected',
      reason: 'validation: [commander-id-params] command takes a string id',
    });
  });

  it('emits commander.activated in sequence', () => {
    const match = deactivated();
    flip(match, 'r3', P1, ACTIVATE_TRANSITION, 'c0');
    expect(match.getEvents().map((e) => e.type)).toEqual([
      'match.started',
      'commander.commissioned',
      'commander.deactivated',
      'commander.activated',
    ]);
    expect(match.getEvents()[3]).toEqual({
      seq: 4,
      revision: 3,
      type: 'commander.activated',
      priority: 'normal',
      payload: { player: 'p1', commander: 'c0' },
    });
  });
});

describe('deactivate (dispatch)', () => {
  it('golden: flips an active own commander, exact summary', () => {
    const match = stateMatch();
    commission(match, 'r1', P1);
    expect(flip(match, 'r2', P1, DEACTIVATE_TRANSITION, 'c0')).toEqual({
      status: 'applied',
      revision: 2,
      summary: 'deactivated c0',
    });
    expect(match.getSnapshot().commanders?.commanders).toEqual([
      { id: 'c0', owner: 'p1', active: false },
    ]);
  });

  it('spends 1 prompt', () => {
    const match = stateMatch();
    commission(match, 'r1', P1);
    flip(match, 'r2', P1, DEACTIVATE_TRANSITION, 'c0');
    expect(match.getSnapshot().prompts?.remaining).toEqual({ p1: 8, p2: 10 });
  });

  it('unknown id stays rejected (present and absent data)', () => {
    const match = stateMatch();
    commission(match, 'r1', P1);
    expect(flip(match, 'r2', P1, DEACTIVATE_TRANSITION, 'c9')).toEqual({
      status: 'rejected',
      reason: 'deactivate: unknown commander.',
    });
    const fresh = stateMatch();
    expect(flip(fresh, 'r1', P1, DEACTIVATE_TRANSITION, 'c0')).toEqual({
      status: 'rejected',
      reason: 'deactivate: unknown commander.',
    });
  });

  it("other holder's commander stays rejected (owner-only, fail-closed)", () => {
    const match = stateMatch();
    commission(match, 'r1', P1);
    expect(flip(match, 'r2', P2, DEACTIVATE_TRANSITION, 'c0')).toEqual({
      status: 'rejected',
      reason: 'deactivate: not owner.',
    });
  });

  it('already-inactive stays rejected (no-op flip)', () => {
    const match = stateMatch();
    commission(match, 'r1', P1);
    flip(match, 'r2', P1, DEACTIVATE_TRANSITION, 'c0');
    expect(flip(match, 'r3', P1, DEACTIVATE_TRANSITION, 'c0')).toEqual({
      status: 'rejected',
      reason: 'deactivate: already inactive.',
    });
  });

  it('emits commander.deactivated in sequence', () => {
    const match = stateMatch();
    commission(match, 'r1', P1);
    flip(match, 'r2', P1, DEACTIVATE_TRANSITION, 'c0');
    expect(match.getEvents().map((e) => e.type)).toEqual([
      'match.started',
      'commander.commissioned',
      'commander.deactivated',
    ]);
    expect(match.getEvents()[2]).toEqual({
      seq: 3,
      revision: 2,
      type: 'commander.deactivated',
      priority: 'normal',
      payload: { player: 'p1', commander: 'c0' },
    });
  });
});

describe('producers (unit, structural diffs)', () => {
  const empty = createWorldState({ players: [P1, P2] });

  function seeded(commanders: CommandersData) {
    return createWorldState({ players: [P1, P2], commanders });
  }

  it('commissionedProducer: births become facts in array order, silence otherwise', () => {
    const after = seeded({
      schemaVersion: 1,
      nextId: 2,
      commanders: [
        { id: 'c0', owner: 'p1', active: true },
        { id: 'c1', owner: 'p2', active: true },
      ],
    });
    expect(
      commissionedProducer({ type: 'x', caller: P1, params: {}, before: empty, after }),
    ).toEqual([
      {
        type: 'commander.commissioned',
        priority: 'normal',
        payload: { player: 'p1', commander: 'c0' },
      },
      {
        type: 'commander.commissioned',
        priority: 'normal',
        payload: { player: 'p2', commander: 'c1' },
      },
    ]);
    expect(
      commissionedProducer({ type: 'x', caller: P1, params: {}, before: after, after }),
    ).toEqual([]);
  });

  it('stateFlipProducer: flips become facts, births and steady state stay silent', () => {
    const before = seeded({
      schemaVersion: 1,
      nextId: 3,
      commanders: [
        { id: 'c0', owner: 'p1', active: false },
        { id: 'c1', owner: 'p1', active: true },
        { id: 'c2', owner: 'p2', active: true },
      ],
    });
    const after = seeded({
      schemaVersion: 1,
      nextId: 4,
      commanders: [
        { id: 'c0', owner: 'p1', active: true },
        { id: 'c1', owner: 'p1', active: false },
        { id: 'c2', owner: 'p2', active: true },
        { id: 'c3', owner: 'p2', active: true },
      ],
    });
    expect(stateFlipProducer({ type: 'x', caller: P1, params: {}, before, after })).toEqual([
      {
        type: 'commander.activated',
        priority: 'normal',
        payload: { player: 'p1', commander: 'c0' },
      },
      {
        type: 'commander.deactivated',
        priority: 'normal',
        payload: { player: 'p1', commander: 'c1' },
      },
    ]);
    expect(stateFlipProducer({ type: 'x', caller: P1, params: {}, before: after, after })).toEqual(
      [],
    );
  });
});

describe('lifecycle integration', () => {
  it('owner perceives own roster; enemy perception stays fail-closed', () => {
    const match = stateMatch();
    commission(match, 'r1', P1);
    const snapshot = match.getSnapshot();
    expect(perceive(snapshot, P1).commanders).toEqual([{ id: 'c0', owner: 'p1', active: true }]);
    expect(perceive(snapshot, P2).commanders).toEqual([]);
  });

  it('marker semantics: inactive commanders gate nothing (upgrade works either way)', () => {
    const bare = stateMatch();
    expect(raise(bare, 'r1', P1)).toMatchObject({ status: 'applied' });
    const marked = stateMatch();
    commission(marked, 'r1', P1);
    flip(marked, 'r2', P1, DEACTIVATE_TRANSITION, 'c0');
    expect(raise(marked, 'r3', P1)).toMatchObject({ status: 'applied' });
    expect(marked.getSnapshot().cities?.cities['p1']?.level).toBe(2);
  });

  it('unrelated transitions stay silent: noop emits no commander facts', () => {
    const match = stateMatch();
    commission(match, 'r1', P1);
    noop(match, 'r2', P1);
    expect(match.getEvents().map((e) => e.type)).toEqual([
      'match.started',
      'commander.commissioned',
    ]);
    expect(match.getSnapshot().commanders?.commanders).toEqual([
      { id: 'c0', owner: 'p1', active: true },
    ]);
  });

  it('handler factories stay pure (fresh handlers, no shared state)', () => {
    expect(createCommissionHandler()).not.toBe(createCommissionHandler());
    expect(createActivateHandler()).not.toBe(createActivateHandler());
    expect(createDeactivateHandler()).not.toBe(createDeactivateHandler());
  });

  it('flip touches only the targeted record (roster of two)', () => {
    const match = stateMatch();
    commission(match, 'r1', P1);
    commission(match, 'r2', P1);
    flip(match, 'r3', P1, DEACTIVATE_TRANSITION, 'c0');
    expect(match.getSnapshot().commanders?.commanders).toEqual([
      { id: 'c0', owner: 'p1', active: false },
      { id: 'c1', owner: 'p1', active: true },
    ]);
  });
});

describe('producers (absent sections stay silent)', () => {
  const empty = createWorldState({ players: [P1, P2] });

  it('commissionedProducer: absent after-section yields no facts', () => {
    expect(
      commissionedProducer({ type: 'x', caller: P1, params: {}, before: empty, after: empty }),
    ).toEqual([]);
  });

  it('stateFlipProducer: absent sections yield no facts', () => {
    expect(
      stateFlipProducer({ type: 'x', caller: P1, params: {}, before: empty, after: empty }),
    ).toEqual([]);
    const seeded = createWorldState({
      players: [P1, P2],
      commanders: {
        schemaVersion: 1,
        nextId: 1,
        commanders: [{ id: 'c0', owner: 'p1', active: true }],
      },
    });
    expect(
      stateFlipProducer({ type: 'x', caller: P1, params: {}, before: seeded, after: empty }),
    ).toEqual([]);
  });
});
