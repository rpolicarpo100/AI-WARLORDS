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
  whatIfConfidence,
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
