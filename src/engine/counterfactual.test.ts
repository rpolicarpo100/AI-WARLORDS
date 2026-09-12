/**
 * M049 — Counterfactual query tests: whatIfConfidence logic over
 * stubbed deps (D-043, voted sim-query). Stubs pin the query contract
 * (guards, fork isolation, caller, delegation); live-handler parity
 * is pinned in match-counterfactual.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { PlayerId, TransitionHandler } from './authority.js';
import type { CommanderRecord } from './commanders.js';
import type { ConfidenceRules } from './confidence.js';
import { isMapData, type MapCell, type MapData } from './map.js';
import {
  rankCandidates,
  whatIfConfidence,
  whatIfScript,
  type CounterfactualDeps,
  type HypotheticalOrder,
} from './counterfactual.js';
import type { PreRule } from './validation.js';
import { createWorldState, type WorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

const CONFIDENCE: ConfidenceRules = {
  unitStatsOf: (type: string) =>
    type === 'warrior' ? { damage: 4, maxHp: 12, cost: { food: 20, gold: 5 } } : undefined,
  buildCostOf: () => undefined,
  passable: () => true,
  defenseOf: () => 0,
  canAfford: () => true,
};

/** All-field 3x3 grid (M045 mold). */
function fieldMap(): MapData {
  const cells: MapCell[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      cells.push({ col, row, terrain: 'field' });
    }
  }
  const map: MapData = {
    schemaVersion: 1,
    id: 'counterfactual-drill' as MapData['id'],
    width: 3,
    height: 3,
    stagger: 'odd',
    cells,
    spawns: [],
  };
  if (!isMapData(map)) {
    throw new Error('TEST BUG: counterfactual map invalid');
  }
  return map;
}

function scenario(): { state: WorldState; record: CommanderRecord } {
  const state = createWorldState({
    players: [P1, P2],
    map: fieldMap(),
    units: {
      schemaVersion: 1,
      nextId: 1,
      units: [{ id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 }],
    },
  });
  const record: CommanderRecord = {
    id: 'c0',
    owner: 'p1',
    active: true,
    orders: [{ kind: 'unit.move', params: { id: 'u0', col: 0, row: 1 } }],
  };
  return { state, record };
}

function depsWith(overrides: Partial<CounterfactualDeps>): CounterfactualDeps {
  const pass: PreRule = () => null;
  const apply: TransitionHandler<WorldState> = (ctx) => ({
    applied: true,
    state: ctx.state,
    summary: 'stubbed',
  });
  return {
    handlers: new Map([['unit.move', apply]]),
    rules: new Map([['unit.move', pass]]),
    confidenceFor: () => CONFIDENCE,
    ...overrides,
  };
}

function ask(
  record: CommanderRecord | undefined,
  hypothetical: HypotheticalOrder,
  deps: CounterfactualDeps,
  index = 0,
) {
  const { state } = scenario();
  return whatIfConfidence(record, index, state, hypothetical, deps);
}

describe('whatIfConfidence fail-soft (queries never throw)', () => {
  it('yields undefined for missing records', () => {
    expect(ask(undefined, { kind: 'unit.move', params: {} }, depsWith({}))).toBeUndefined();
  });

  it('yields undefined for records without queues', () => {
    const bare: CommanderRecord = { id: 'c0', owner: 'p1', active: true };
    expect(ask(bare, { kind: 'unit.move', params: {} }, depsWith({}))).toBeUndefined();
  });

  it('yields undefined for targets outside the queue', () => {
    const { record } = scenario();
    expect(ask(record, { kind: 'unit.move', params: {} }, depsWith({}), 4)).toBeUndefined();
  });
});

describe('whatIfConfidence gating (fail-closed hypotheticals)', () => {
  it('rejects non-orderable kinds', () => {
    const { record } = scenario();
    expect(ask(record, { kind: 'city.upgrade', params: {} }, depsWith({}))).toEqual({
      applied: false,
      reason: 'counterfactual: not orderable.',
    });
  });

  it('rejects kinds without a wired rule', () => {
    const { record } = scenario();
    const deps = depsWith({ rules: new Map() });
    expect(ask(record, { kind: 'unit.move', params: {} }, deps)).toEqual({
      applied: false,
      reason: 'counterfactual: unknown kind.',
    });
  });

  it('rejects kinds without a wired handler', () => {
    const { record } = scenario();
    const deps = depsWith({ handlers: new Map() });
    expect(ask(record, { kind: 'unit.move', params: {} }, deps)).toEqual({
      applied: false,
      reason: 'counterfactual: unknown kind.',
    });
  });

  it('surfaces rule details verbatim', () => {
    const { record } = scenario();
    const shape: PreRule = () => ({ rule: 'move-params', detail: 'move takes { id, col, row }' });
    const deps = depsWith({ rules: new Map([['unit.move', shape]]) });
    expect(ask(record, { kind: 'unit.move', params: 7 }, deps)).toEqual({
      applied: false,
      reason: 'move takes { id, col, row }',
    });
  });

  it('surfaces handler reasons verbatim', () => {
    const { record } = scenario();
    const reject: TransitionHandler<WorldState> = () => ({
      applied: false,
      reason: 'move: not adjacent.',
    });
    const deps = depsWith({ handlers: new Map([['unit.move', reject]]) });
    expect(ask(record, { kind: 'unit.move', params: { id: 'u0', col: 2, row: 2 } }, deps)).toEqual({
      applied: false,
      reason: 'move: not adjacent.',
    });
  });
});

describe('whatIfConfidence simulation (fork honesty)', () => {
  it('scores the target on the OUTCOME state (teleport stub proves it)', () => {
    const { record } = scenario();
    const teleport: TransitionHandler<WorldState> = (ctx) => ({
      applied: true,
      state: {
        ...ctx.state,
        units:
          ctx.state.units === undefined
            ? undefined
            : {
                ...ctx.state.units,
                units: ctx.state.units.units.map((unit) =>
                  unit.id === 'u0' ? { ...unit, col: 2, row: 2 } : unit,
                ),
              },
      },
      summary: 'stubbed teleport',
    });
    const deps = depsWith({ handlers: new Map([['unit.move', teleport]]) });
    // Target marches u0 to (0,1): adjacent on the ORIGINAL state, far
    // from the teleported (2,2) — the verdict must read the outcome.
    expect(ask(record, { kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } }, deps)).toEqual({
      applied: true,
      outcome: {
        orderIndex: 0,
        kind: 'unit.move',
        score: 80,
        failed: ['out-of-range'],
      },
    });
  });

  it('never mutates the input state (even mutating stubs hit the fork)', () => {
    const { state, record } = scenario();
    const before = JSON.parse(JSON.stringify(state)) as unknown;
    const mutate: TransitionHandler<WorldState> = (ctx) => {
      const units = ctx.state.units?.units;
      const first = units?.[0];
      if (first !== undefined) {
        (first as { col: number }).col = 9;
      }
      return { applied: true, state: ctx.state, summary: 'mutating stub' };
    };
    const deps = depsWith({ handlers: new Map([['unit.move', mutate]]) });
    const verdict = whatIfConfidence(
      record,
      0,
      state,
      { kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } },
      deps,
    );
    expect(verdict?.applied).toBe(true);
    expect(JSON.parse(JSON.stringify(state)) as unknown).toEqual(before);
  });

  it('hands the stub a fork (same content, never the reference)', () => {
    const { state, record } = scenario();
    let seen: WorldState | undefined;
    const capture: TransitionHandler<WorldState> = (ctx) => {
      seen = ctx.state;
      return { applied: true, state: ctx.state, summary: 'stubbed' };
    };
    const deps = depsWith({ handlers: new Map([['unit.move', capture]]) });
    whatIfConfidence(
      record,
      0,
      state,
      { kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } },
      deps,
    );
    expect(seen).not.toBe(state);
    expect(seen).toEqual(state);
  });

  it('runs the hypothetical as the holder (caller flows to rule and handler)', () => {
    const { state } = scenario();
    const p2: CommanderRecord = {
      id: 'c1',
      owner: 'p2',
      active: true,
      orders: [{ kind: 'unit.move', params: { id: 'u0', col: 0, row: 1 } }],
    };
    const seen: string[] = [];
    const rule: PreRule = (caller) => {
      seen.push(caller);
      return null;
    };
    const handler: TransitionHandler<WorldState> = (ctx) => {
      seen.push(ctx.caller);
      return { applied: true, state: ctx.state, summary: 'stubbed' };
    };
    const deps = depsWith({
      handlers: new Map([['unit.move', handler]]),
      rules: new Map([['unit.move', rule]]),
    });
    whatIfConfidence(p2, 0, state, { kind: 'unit.move', params: {} }, deps);
    expect(seen).toEqual(['p2', 'p2']);
  });

  it('scores through the injected confidence rules (never a global)', () => {
    const { state } = scenario();
    const priced: CommanderRecord = {
      id: 'c0',
      owner: 'p1',
      active: true,
      orders: [{ kind: 'unit.train', params: { type: 'warrior', col: 1, row: 1 } }],
    };
    const broke: ConfidenceRules = { ...CONFIDENCE, canAfford: () => false };
    const deps = depsWith({ confidenceFor: () => broke });
    const verdict = whatIfConfidence(
      priced,
      0,
      state,
      { kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } },
      deps,
    );
    expect(verdict).toMatchObject({ applied: true, outcome: { failed: ['unaffordable'] } });
  });

  it('rebinds confidence to the outcome state (factory sees the fork result)', () => {
    const { state, record } = scenario();
    const seen: WorldState[] = [];
    const teleport: TransitionHandler<WorldState> = (ctx) => ({
      applied: true,
      state: {
        ...ctx.state,
        units:
          ctx.state.units === undefined
            ? undefined
            : {
                ...ctx.state.units,
                units: ctx.state.units.units.map((unit) =>
                  unit.id === 'u0' ? { ...unit, col: 2, row: 2 } : unit,
                ),
              },
      },
      summary: 'stubbed teleport',
    });
    const deps = depsWith({
      handlers: new Map([['unit.move', teleport]]),
      confidenceFor: (outcome: WorldState) => {
        seen.push(outcome);
        return CONFIDENCE;
      },
    });
    whatIfConfidence(
      record,
      0,
      state,
      { kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } },
      deps,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.units?.units.find((unit) => unit.id === 'u0')?.col).toBe(2);
  });
});

describe('whatIfScript (M050: sequences, first failure wins)', () => {
  /** Honest mini-move stub: u0 lands on (col,row). */
  function miniMove(): TransitionHandler<WorldState> {
    return (ctx) => {
      const params = ctx.params as { col: number; row: number };
      return {
        applied: true,
        state: {
          ...ctx.state,
          units:
            ctx.state.units === undefined
              ? undefined
              : {
                  ...ctx.state.units,
                  units: ctx.state.units.units.map((unit) =>
                    unit.id === 'u0' ? { ...unit, col: params.col, row: params.row } : unit,
                  ),
                },
        },
        summary: 'stubbed mini-move',
      };
    };
  }

  it('applies steps in sequence and scores the final outcome', () => {
    const { state, record } = scenario();
    const deps = depsWith({ handlers: new Map([['unit.move', miniMove()]]) });
    // u0 walks (0,0) -> (1,0) -> (2,0); the target still marches (0,1).
    expect(
      whatIfScript(
        record,
        0,
        state,
        [
          { kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } },
          { kind: 'unit.move', params: { id: 'u0', col: 2, row: 0 } },
        ],
        deps,
      ),
    ).toEqual({
      applied: true,
      outcome: {
        orderIndex: 0,
        kind: 'unit.move',
        score: 80,
        failed: ['out-of-range'],
      },
    });
  });

  it('scores vacuous scripts on the untouched state', () => {
    const { state, record } = scenario();
    expect(whatIfScript(record, 0, state, [], depsWith({}))).toEqual({
      applied: true,
      outcome: { orderIndex: 0, kind: 'unit.move', score: 100, failed: [] },
    });
  });

  it('pins rule violations mid-script with their step index', () => {
    const { state, record } = scenario();
    const shape: PreRule = (_caller, params) =>
      (params as { bad?: boolean }).bad === true
        ? { rule: 'move-params', detail: 'stub: bad leg.' }
        : null;
    const deps = depsWith({
      handlers: new Map([['unit.move', miniMove()]]),
      rules: new Map([['unit.move', shape]]),
    });
    expect(
      whatIfScript(
        record,
        0,
        state,
        [
          { kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } },
          { kind: 'unit.move', params: { id: 'u0', bad: true } },
        ],
        deps,
      ),
    ).toEqual({ applied: false, reason: 'stub: bad leg.', failedAt: 1 });
  });

  it('pins handler rejections mid-script with their step index', () => {
    const { state, record } = scenario();
    const wall: TransitionHandler<WorldState> = (ctx) => {
      const params = ctx.params as { col: number; row: number };
      if (params.col === 2) {
        return { applied: false, reason: 'stub: wall at col 2.' };
      }
      return miniMove()(ctx);
    };
    const deps = depsWith({ handlers: new Map([['unit.move', wall]]) });
    expect(
      whatIfScript(
        record,
        0,
        state,
        [
          { kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } },
          { kind: 'unit.move', params: { id: 'u0', col: 2, row: 0 } },
        ],
        deps,
      ),
    ).toEqual({ applied: false, reason: 'stub: wall at col 2.', failedAt: 1 });
  });

  it('pins non-orderable steps mid-script', () => {
    const { state, record } = scenario();
    const deps = depsWith({ handlers: new Map([['unit.move', miniMove()]]) });
    expect(
      whatIfScript(
        record,
        0,
        state,
        [
          { kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } },
          { kind: 'city.upgrade', params: {} },
        ],
        deps,
      ),
    ).toEqual({ applied: false, reason: 'counterfactual: not orderable.', failedAt: 1 });
  });

  it('fails soft on missing records and targets', () => {
    const { state, record } = scenario();
    const script = [{ kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } }];
    expect(whatIfScript(undefined, 0, state, script, depsWith({}))).toBeUndefined();
    expect(whatIfScript(record, 9, state, script, depsWith({}))).toBeUndefined();
  });

  it('still scores when the sim wipes commanders (record rides separate)', () => {
    const { state, record } = scenario();
    const wipe: TransitionHandler<WorldState> = (ctx) => ({
      applied: true,
      state: { ...ctx.state, commanders: undefined },
      summary: 'stubbed wipe',
    });
    const deps = depsWith({ handlers: new Map([['unit.move', wipe]]) });
    const verdict = whatIfScript(
      record,
      0,
      state,
      [{ kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } }],
      deps,
    );
    expect(verdict).toMatchObject({ applied: true });
    expect(verdict?.applied === true ? verdict.outcome.failed : undefined).toEqual([]);
  });
});

describe('rankCandidates (M050: best hypothetical wins)', () => {
  function miniMove(): TransitionHandler<WorldState> {
    return (ctx) => {
      const params = ctx.params as { col: number; row: number };
      return {
        applied: true,
        state: {
          ...ctx.state,
          units:
            ctx.state.units === undefined
              ? undefined
              : {
                  ...ctx.state.units,
                  units: ctx.state.units.units.map((unit) =>
                    unit.id === 'u0' ? { ...unit, col: params.col, row: params.row } : unit,
                  ),
                },
        },
        summary: 'stubbed mini-move',
      };
    };
  }

  function rankedDeps(): CounterfactualDeps {
    const hold: TransitionHandler<WorldState> = (ctx) => ({
      applied: true,
      state: ctx.state,
      summary: 'stubbed hold',
    });
    const pass: PreRule = () => null;
    return {
      handlers: new Map([
        ['unit.move', miniMove()],
        ['economy.gather', hold],
      ]),
      rules: new Map([
        ['unit.move', pass],
        ['economy.gather', pass],
      ]),
      confidenceFor: () => CONFIDENCE,
    };
  }

  it('ranks best-first with input indexes and recommends the top', () => {
    const { state, record } = scenario();
    const ranking = rankCandidates(
      record,
      0,
      state,
      [
        { kind: 'unit.move', params: { id: 'u0', col: 2, row: 2 } },
        { kind: 'unit.move', params: { id: 'u0', col: 0, row: 1 } },
        { kind: 'economy.gather', params: { col: 0, row: 0 } },
      ],
      rankedDeps(),
    );
    // Gather holds u0 (target adjacent: 100); far march strands u0
    // (80); the (0,1) march lands ON the target (60).
    expect(ranking?.ranking.map((entry) => [entry.index, entry.score])).toEqual([
      [2, 100],
      [0, 80],
      [1, 60],
    ]);
    expect(ranking?.recommended).toBe(2);
  });

  it('keeps input order on ties (stable, recommends the first)', () => {
    const { state, record } = scenario();
    const leg = { kind: 'unit.move', params: { id: 'u0', col: 2, row: 2 } };
    const ranking = rankCandidates(record, 0, state, [leg, { ...leg }], rankedDeps());
    expect(ranking?.ranking.map((entry) => entry.index)).toEqual([0, 1]);
    expect(ranking?.recommended).toBe(0);
  });

  it('sinks unapplied candidates with their reasons', () => {
    const { state, record } = scenario();
    const ranking = rankCandidates(
      record,
      0,
      state,
      [
        { kind: 'city.upgrade', params: {} },
        { kind: 'unit.move', params: { id: 'u0', col: 2, row: 2 } },
      ],
      rankedDeps(),
    );
    expect(ranking?.ranking.map((entry) => [entry.index, entry.applied])).toEqual([
      [1, true],
      [0, false],
    ]);
    expect(ranking?.ranking[1]).toMatchObject({
      reason: 'counterfactual: not orderable.',
    });
    expect(ranking?.recommended).toBe(1);
  });

  it('recommends nothing when every candidate fails', () => {
    const { state, record } = scenario();
    const ranking = rankCandidates(
      record,
      0,
      state,
      [
        { kind: 'city.upgrade', params: {} },
        { kind: 'commander.commission', params: {} },
      ],
      rankedDeps(),
    );
    expect(ranking?.ranking.map((entry) => entry.index)).toEqual([0, 1]);
    expect(ranking?.recommended).toBeUndefined();
  });

  it('fails soft on missing records, targets, and empty slates', () => {
    const { state, record } = scenario();
    const slate = [{ kind: 'unit.move', params: { id: 'u0', col: 1, row: 0 } }];
    expect(rankCandidates(undefined, 0, state, slate, rankedDeps())).toBeUndefined();
    expect(rankCandidates(record, 9, state, slate, rankedDeps())).toBeUndefined();
    expect(
      rankCandidates({ ...record, orders: undefined }, 0, state, slate, rankedDeps()),
    ).toBeUndefined();
    expect(rankCandidates(record, 0, state, [], rankedDeps())).toEqual({
      ranking: [],
      recommended: undefined,
    });
  });
});
