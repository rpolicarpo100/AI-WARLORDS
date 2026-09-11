/**
 * M014 — Exploration tests: accumulation, queries, tri-state, WorldState
 * extension, explored-monotonic (direct + real-Match E2E), views non-leak.
 */
import { describe, expect, it } from 'vitest';
import { markUntrusted, type ClientRequest, type PlayerId, type Untrusted } from './authority.js';
import { type ExploredData } from './explored.js';
import { exploredCells, explorationStatus, isExplored, markExplored } from './exploration.js';
import { computeVisibility } from './fog.js';
import { type MapData, type MapId, type TerrainId } from './map.js';
import { Match, STANDARD_RULESET, type MatchInit } from './match.js';
import { seedPrompts, spendPrompt } from './prompts.js';
import { createWorldValidator, wrapWithValidation, type RngHandler } from './validation.js';
import { toAiPerception } from './views.js';
import { createWorldState, isWorldState, type WorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

const EMPTY: ExploredData = { schemaVersion: 1, viewers: {} };

function makeMap(rows: readonly (readonly TerrainId[])[]): MapData {
  const first = rows[0];
  if (first === undefined) {
    throw new Error('test setup: empty map');
  }
  return {
    schemaVersion: 1,
    id: 't' as MapId,
    width: first.length,
    height: rows.length,
    stagger: 'odd',
    cells: rows.flatMap((cols, row) => cols.map((terrain, col) => ({ col, row, terrain }))),
    spawns: [],
  };
}

function openMap(size: number): MapData {
  const row = Array<TerrainId>(size).fill('field');
  return makeMap(Array<readonly TerrainId[]>(size).fill(row));
}

function raw(value: unknown): Untrusted<ClientRequest> {
  return markUntrusted(value as ClientRequest);
}

function baseWorld(): WorldState {
  return createWorldState({
    players: [P1, P2],
    prompts: seedPrompts([P1, P2], 10),
    map: openMap(3),
    explored: { schemaVersion: 1, viewers: { p1: [0, 4] } },
  });
}

/**
 * Match post-step minus completions (cityless-identical): direct-wrapper
 * tests mirror Match by spending exactly one prompt per applied outcome.
 */
function spendPostStep(
  _before: WorldState,
  caller: PlayerId,
  applied: WorldState,
): WorldState {
  return { ...applied, prompts: spendPrompt(applied.prompts, caller) };
}

describe('markExplored (integration)', () => {
  it('merges sight into empty memory, canonical sorted unique (golden)', () => {
    expect(markExplored(EMPTY, { p1: [4, 0, 4] })).toEqual({
      schemaVersion: 1,
      viewers: { p1: [0, 4] },
    });
  });

  it('accumulates across calls without mutating inputs (memory grows)', () => {
    const first = markExplored(EMPTY, { p1: [0] });
    const second = markExplored(first, { p1: [4], p2: [8] });
    expect(second).toEqual({ schemaVersion: 1, viewers: { p1: [0, 4], p2: [8] } });
    expect(first).toEqual({ schemaVersion: 1, viewers: { p1: [0] } });
    expect(EMPTY).toEqual({ schemaVersion: 1, viewers: {} });
  });

  it('feeds computeVisibility output (structural-twin compatibility proof)', () => {
    const seen = computeVisibility(openMap(3), [{ viewer: P1, col: 1, row: 1, range: 0 }]);
    expect(markExplored(EMPTY, seen)).toEqual({ schemaVersion: 1, viewers: { p1: [4] } });
  });

  it('rejects malformed current loud', () => {
    expect(() => markExplored({} as ExploredData, {})).toThrow(/invalid current/);
  });

  it('rejects malformed visibility loud', () => {
    expect(() => markExplored(EMPTY, 'x' as never)).toThrow(/invalid visibility/);
    expect(() => markExplored(EMPTY, { p1: 'x' } as never)).toThrow(/invalid visibility/);
    expect(() => markExplored(EMPTY, { p1: [-1] })).toThrow(/invalid visibility/);
  });

  it('output frozen top + nested, version 1', () => {
    const out = markExplored(EMPTY, { p1: [2] });
    expect(out.schemaVersion).toBe(1);
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out.viewers)).toBe(true);
    expect(Object.isFrozen(out.viewers['p1'])).toBe(true);
    expect(() => {
      (out.viewers['p1'] as number[]).push(0);
    }).toThrow(TypeError);
  });

  it('deterministic run×2', () => {
    const run = (): ExploredData => markExplored(EMPTY, { p2: [8], p1: [0, 4] });
    expect(run()).toEqual(run());
  });
});

describe('queries (unit)', () => {
  const memory: ExploredData = { schemaVersion: 1, viewers: { p1: [0, 4] } };

  it('exploredCells returns the set, or [] for unknown viewers', () => {
    expect(exploredCells(memory, P1)).toEqual([0, 4]);
    expect(exploredCells(memory, P2)).toEqual([]);
  });

  it('isExplored answers membership, fail-soft false', () => {
    expect(isExplored(memory, P1, 4)).toBe(true);
    expect(isExplored(memory, P1, 3)).toBe(false);
    expect(isExplored(memory, P2, 0)).toBe(false);
  });
});

describe('explorationStatus (unit)', () => {
  const memory: ExploredData = { schemaVersion: 1, viewers: { p1: [0, 4] } };

  it('sight beats memory: visible', () => {
    expect(explorationStatus({ p1: [4] }, memory, P1, 4)).toBe('visible');
  });

  it('memory without sight: explored (visibility present)', () => {
    expect(explorationStatus({ p1: [8] }, memory, P1, 0)).toBe('explored');
  });

  it('memory without sight: explored (visibility absent)', () => {
    expect(explorationStatus(undefined, memory, P1, 4)).toBe('explored');
  });

  it('neither: unexplored (both present)', () => {
    expect(explorationStatus({ p1: [8] }, memory, P1, 7)).toBe('unexplored');
  });

  it('neither: unexplored (memory absent)', () => {
    expect(explorationStatus({ p1: [8] }, undefined, P1, 7)).toBe('unexplored');
  });

  it('neither: unexplored (both absent)', () => {
    expect(explorationStatus(undefined, undefined, P1, 0)).toBe('unexplored');
  });
});

describe('WorldState extension (integration)', () => {
  it('accepts explored with map (bounds-checked)', () => {
    const world = baseWorld();
    expect(world.explored).toEqual({ schemaVersion: 1, viewers: { p1: [0, 4] } });
    expect(isWorldState(world)).toBe(true);
  });

  it('rejects explored without map (coherence, one direction)', () => {
    const mapless = createWorldState({ players: [P1, P2] });
    expect(isWorldState({ ...mapless, explored: { schemaVersion: 1, viewers: { p1: [0] } } })).toBe(
      false,
    );
  });

  it('rejects out-of-bounds indices', () => {
    const world = baseWorld();
    expect(isWorldState({ ...world, explored: { schemaVersion: 1, viewers: { p1: [9] } } })).toBe(
      false,
    );
  });

  it('rejects malformed explored', () => {
    const world = baseWorld();
    expect(
      isWorldState({ ...world, explored: { schemaVersion: 1, viewers: { p1: [4, 0] } } }),
    ).toBe(false);
  });

  it('omits explored when absent (M010 bytes intact)', () => {
    const world = createWorldState({ players: [P1, P2], map: openMap(3) });
    expect('explored' in world).toBe(false);
  });
});

describe('explored-monotonic (security)', () => {
  function wrapped(): ReturnType<typeof wrapWithValidation> {
    return wrapWithValidation(
      (ctx) => ({ applied: true, state: ctx.state, summary: 'noop' }),
      createWorldValidator(),
      7,
      () => 1,
      spendPostStep,
    );
  }

  it('growth passes (direct)', () => {
    const before = baseWorld();
    const out = wrapped()({ state: before, caller: P1, params: {} });
    expect(out.applied).toBe(true);
    const grown: ExploredData = { schemaVersion: 1, viewers: { p1: [0, 4, 8], p2: [1] } };
    const grow = wrapWithValidation(
      () => ({ applied: true, state: { ...before, explored: grown }, summary: 'grow' }),
      createWorldValidator(),
      7,
      () => 1,
      spendPostStep,
    );
    expect(grow({ state: before, caller: P1, params: {} }).applied).toBe(true);
    const plain = createWorldState({
      players: [P1, P2],
      prompts: seedPrompts([P1, P2], 10),
      map: openMap(3),
    });
    const arrive = wrapWithValidation(
      () => ({ applied: true, state: { ...plain, explored: grown }, summary: 'arrive' }),
      createWorldValidator(),
      7,
      () => 1,
      spendPostStep,
    );
    expect(arrive({ state: plain, caller: P1, params: {} }).applied).toBe(true);
  });

  it('wipe fails loud (direct)', () => {
    const before = baseWorld();
    const wipe = wrapWithValidation(
      () => {
        const wiped: WorldState = {
          schemaVersion: before.schemaVersion,
          players: before.players,
          ...(before.prompts === undefined ? {} : { prompts: before.prompts }),
          ...(before.map === undefined ? {} : { map: before.map }),
        };
        return { applied: true, state: wiped, summary: 'wipe' };
      },
      createWorldValidator(),
      7,
      () => 1,
      spendPostStep,
    );
    expect(() => wipe({ state: before, caller: P1, params: {} })).toThrow(/explored-monotonic/);
  });

  it('shrink fails loud (direct)', () => {
    const before = baseWorld();
    const shrunk: ExploredData = { schemaVersion: 1, viewers: { p1: [0] } };
    const shrink = wrapWithValidation(
      () => ({ applied: true, state: { ...before, explored: shrunk }, summary: 'shrink' }),
      createWorldValidator(),
      7,
      () => 1,
      spendPostStep,
    );
    expect(() => shrink({ state: before, caller: P1, params: {} })).toThrow(/explored-monotonic/);
    const swapped: ExploredData = { schemaVersion: 1, viewers: { p1: [0, 5] } };
    const swap = wrapWithValidation(
      () => ({ applied: true, state: { ...before, explored: swapped }, summary: 'swap' }),
      createWorldValidator(),
      7,
      () => 1,
      spendPostStep,
    );
    expect(() => swap({ state: before, caller: P1, params: {} })).toThrow(/explored-monotonic/);
  });

  it('viewer removal fails loud (direct)', () => {
    const before = baseWorld();
    const removed: ExploredData = { schemaVersion: 1, viewers: {} };
    const remove = wrapWithValidation(
      () => ({ applied: true, state: { ...before, explored: removed }, summary: 'remove' }),
      createWorldValidator(),
      7,
      () => 1,
      spendPostStep,
    );
    expect(() => remove({ state: before, caller: P1, params: {} })).toThrow(/explored-monotonic/);
  });

  it('applied dispatch preserves explored through a real Match (E2E)', () => {
    const init: MatchInit = {
      seed: 5,
      ruleset: STANDARD_RULESET,
      players: [P1, P2],
      initialState: baseWorld(),
    };
    const match = new Match(init);
    const s1 = match.join(P1);
    const outcome = match.dispatch(
      s1,
      raw({ requestId: 'r1', playerId: P1, type: 'world.noop', payload: {} }),
    );
    expect(outcome.status).toBe('applied');
    expect(match.getSnapshot().explored).toEqual({ schemaVersion: 1, viewers: { p1: [0, 4] } });
    expect(match.getSnapshot().prompts?.remaining).toEqual({ p1: 9, p2: 10 });
  });

  it('shrinking handler faults HANDLER_FAULT with state untouched (E2E)', () => {
    const shrunk: ExploredData = { schemaVersion: 1, viewers: { p1: [0] } };
    const extra = new Map<string, RngHandler<WorldState>>([
      [
        'test.shrink',
        (ctx) => ({ applied: true, state: { ...ctx.state, explored: shrunk }, summary: 'shrink' }),
      ],
    ]);
    const match = new Match({
      seed: 5,
      ruleset: STANDARD_RULESET,
      players: [P1, P2],
      initialState: baseWorld(),
      extraHandlers: extra,
    });
    const s1 = match.join(P1);
    expect(
      match.dispatch(s1, raw({ requestId: 'r1', playerId: P1, type: 'test.shrink', payload: {} })),
    ).toEqual({ status: 'error', code: 'HANDLER_FAULT' });
    expect(match.getSnapshot().explored).toEqual({ schemaVersion: 1, viewers: { p1: [0, 4] } });
    expect(match.getRevision()).toBe(0);
  });
});

describe('views perception (security)', () => {
  it('perception carries knowledge (cells), never raw explored memory', () => {
    const known = toAiPerception(baseWorld(), P1, { p1: [4] }).known;
    expect('explored' in known).toBe(false);
    expect('viewers' in known).toBe(false);
    expect(known.visibleCells).toEqual([4]);
    expect(known.exploredCells).toEqual([0, 4]);
  });
});
