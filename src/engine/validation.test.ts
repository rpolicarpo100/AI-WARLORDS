import { describe, expect, it } from 'vitest';
import {
  AuthorityKernel,
  markUntrusted,
  type ClientRequest,
  type PlayerId,
  type TransitionHandler,
  type Untrusted,
} from './authority.js';
import { Match, STANDARD_RULESET } from './match.js';
import { deriveSeed, SeededRng } from './rng.js';
import {
  createWorldValidator,
  MAX_STATE_BYTES,
  noParamsRule,
  wrapWithValidation,
  type PostRule,
  type PreRule,
  type RngHandler,
} from './validation.js';
import { createWorldState, type WorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;
const P3 = 'p3' as PlayerId;

/** Simulates untrusted wire bytes: unknown input, marked at the boundary. */
function raw(value: unknown): Untrusted<ClientRequest> {
  return markUntrusted(value as ClientRequest);
}

function stdState(): WorldState {
  return createWorldState({ players: [P1, P2] });
}

function stdMatch(handlers: ReadonlyMap<string, RngHandler<WorldState>> = new Map()): Match {
  return new Match({
    seed: 999,
    ruleset: STANDARD_RULESET,
    players: [P1, P2],
    initialState: stdState(),
    extraHandlers: handlers,
  });
}

function drawHandlers(): Map<string, RngHandler<WorldState>> {
  const entries: Array<[string, RngHandler<WorldState>]> = [
    [
      'test.draw',
      (ctx) => ({ applied: true, state: ctx.state, summary: `draw=${ctx.rng.nextUint32()}` }),
    ],
  ];
  return new Map(entries);
}

function kernelWithPre(pre: readonly PreRule[]): AuthorityKernel<WorldState> {
  const validator = { ...createWorldValidator(), pre };
  const entries: Array<[string, TransitionHandler<WorldState>]> = [
    [
      'test.echo',
      wrapWithValidation(
        (ctx) => ({ applied: true, state: ctx.state, summary: 'echo' }),
        validator,
        7,
        () => 1,
      ),
    ],
  ];
  return new AuthorityKernel<WorldState>({
    players: [P1],
    initialState: createWorldState({ players: [P1] }),
    handlers: new Map(entries),
  });
}

// Adversarial payload: bypasses the type system the way a buggy runtime value could.
const garbageState = { not: 'a state' } as unknown as WorldState;

function corruptCases(): Array<[string, RngHandler<WorldState>, RegExp, WorldState, boolean]> {
  const tick1 = { ...stdState(), tick: 1 };
  const big = 'x'.repeat(1500000);
  return [
    [
      'shape',
      () => ({ applied: true, state: garbageState, summary: 'evil' }),
      /\[state-shape\]/,
      stdState(),
      false,
    ],
    [
      'roster-add',
      (ctx) => ({
        applied: true,
        state: {
          ...ctx.state,
          players: [...ctx.state.players, { id: P3 }],
        } as unknown as WorldState,
        summary: 'evil',
      }),
      /\[roster-preserved\]/,
      stdState(),
      false,
    ],
    [
      'roster-reorder',
      (ctx) => ({
        applied: true,
        state: { ...ctx.state, players: [...ctx.state.players].reverse() } as unknown as WorldState,
        summary: 'evil',
      }),
      /\[roster-preserved\]/,
      stdState(),
      false,
    ],
    [
      'tick-back',
      (ctx) => ({
        applied: true,
        state: { ...ctx.state, tick: ctx.state.tick - 1 } as unknown as WorldState,
        summary: 'evil',
      }),
      /\[tick-monotonic\]/,
      tick1,
      true,
    ],
    [
      'size',
      (ctx) => ({
        applied: true,
        state: { ...ctx.state, secrets: { [P1]: [big] } } as unknown as WorldState,
        summary: 'evil',
      }),
      new RegExp(`\\[state-size\\] \\d+ bytes \\(max ${MAX_STATE_BYTES}\\)`),
      stdState(),
      false,
    ],
  ];
}

describe('validator composition (unit)', () => {
  it('ships empty domain pre-rules with the shape gate + 3 post-invariants', () => {
    const validator = createWorldValidator();
    expect(validator.pre).toEqual([]);
    expect(validator.post).toHaveLength(3);
    expect(typeof validator.postShape).toBe('function');
  });
});

describe('no-params pre-rule (unit)', () => {
  it('passes empty payloads', () => {
    expect(noParamsRule('t')(P1, {}, stdState())).toBeNull();
  });

  it('fails non-empty payloads with the handler name', () => {
    expect(noParamsRule('t')(P1, { x: 1 }, stdState())).toEqual({
      rule: 'no-params',
      detail: 't takes no parameters',
    });
  });

  it('fails unserializable payloads distinctly', () => {
    expect(noParamsRule('t')(P1, { fn: () => 0 }, stdState())).toEqual({
      rule: 'no-params',
      detail: 't payload is not serializable',
    });
  });
});

describe('pre-validation mechanism (TEST MOCK rules, real kernel)', () => {
  // TEST MOCKs: failing/passing pre-rules (mechanism tests, not game logic).
  const failA: PreRule = () => ({ rule: 'a', detail: 'first' });
  const failB: PreRule = () => ({ rule: 'b', detail: 'second' });
  const passC: PreRule = () => null;
  const passD: PreRule = () => null;

  function dispatchEcho(kernel: AuthorityKernel<WorldState>): unknown {
    const session = kernel.join(P1);
    return kernel.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'test.echo', payload: {} }),
    );
  }

  it('collects ALL violations in rule order (no short-circuit)', () => {
    expect(dispatchEcho(kernelWithPre([passC, failA, failB]))).toEqual({
      status: 'rejected',
      reason: 'validation: [a] first; [b] second',
    });
  });

  it('allows dispatch with empty pre-rules', () => {
    expect(dispatchEcho(kernelWithPre([]))).toEqual({
      status: 'applied',
      revision: 1,
      summary: 'echo',
    });
  });

  it('allows dispatch when all rules pass', () => {
    expect(dispatchEcho(kernelWithPre([passC, passD]))).toEqual({
      status: 'applied',
      revision: 1,
      summary: 'echo',
    });
  });
});

describe('no-params enforced (Match E2E)', () => {
  it('rejects advance with a payload (recorded, state untouched)', () => {
    const match = stdMatch();
    const session = match.join(P1);
    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'match.advance', payload: { x: 1 } }),
      ),
    ).toEqual({
      status: 'rejected',
      reason: 'validation: [no-params] match.advance takes no parameters',
    });
    expect(match.getTick()).toBe(0);
    const timeline = match.getTimeline();
    expect(timeline).toHaveLength(1);
    const entry = timeline[0];
    if (entry === undefined) {
      throw new Error('test setup: expected one timeline entry');
    }
    expect(entry.applied).toBe(false);
  });

  it('rejects noop with a payload', () => {
    const match = stdMatch();
    const session = match.join(P1);
    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'world.noop', payload: { x: 1 } }),
      ),
    ).toEqual({
      status: 'rejected',
      reason: 'validation: [no-params] world.noop takes no parameters',
    });
  });

  it('rejects unserializable payloads as client errors (not faults)', () => {
    const match = stdMatch();
    const session = match.join(P1);
    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'match.advance', payload: { fn: () => 0 } }),
      ),
    ).toEqual({
      status: 'rejected',
      reason: 'validation: [no-params] match.advance payload is not serializable',
    });
    expect(match.getRevision()).toBe(0);
  });

  it('lets non-built-ins carry payloads (scoping proof)', () => {
    const entries: Array<[string, RngHandler<WorldState>]> = [
      ['test.echo', (ctx) => ({ applied: true, state: ctx.state, summary: 'echo' })],
    ];
    const match = stdMatch(new Map(entries));
    const session = match.join(P1);
    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'test.echo', payload: { x: 1 } }),
      ),
    ).toEqual({ status: 'applied', revision: 1, summary: 'echo' });
  });
});

describe('post shape gate', () => {
  it('skips remaining post-rules after a shape failure (TEST MOCK probe)', () => {
    let called = false;
    // TEST MOCK: probe that must never run (gate short-circuit proof).
    const probe: PostRule = () => {
      called = true;
      throw new Error('must not run');
    };
    const validator = { ...createWorldValidator(), post: [probe] };
    const wrapped = wrapWithValidation(
      () => ({ applied: true, state: garbageState, summary: 'x' }),
      validator,
      7,
      () => 1,
    );
    expect(() => wrapped({ state: stdState(), caller: P1, params: {} })).toThrow(/\[state-shape\]/);
    expect(called).toBe(false);
  });
});

describe('post-invariants, rule-specific (direct wrapper invocation)', () => {
  it.each(corruptCases())('faults with %s', (_name, handler, message, before) => {
    const wrapped = wrapWithValidation(handler, createWorldValidator(), 7, () => 1);
    expect(() => wrapped({ state: before, caller: P1, params: {} })).toThrow(message);
  });
});

describe('post-invariants contained end-to-end (Match)', () => {
  it.each(corruptCases())(
    'contains corrupt %s',
    (_name, handler, _message, _before, preAdvance) => {
      const entries: Array<[string, RngHandler<WorldState>]> = [['test.corrupt', handler]];
      const match = stdMatch(new Map(entries));
      const session = match.join(P1);
      if (preAdvance) {
        match.dispatch(
          session,
          raw({ requestId: 'r0', playerId: 'p1', type: 'match.advance', payload: {} }),
        );
      }
      const before = match.getSnapshot();
      const logLength = match.getLog().length;
      const timelineLength = match.getTimeline().length;
      const revision = match.getRevision();
      expect(
        match.dispatch(
          session,
          raw({ requestId: 'r1', playerId: 'p1', type: 'test.corrupt', payload: {} }),
        ),
      ).toEqual({ status: 'error', code: 'HANDLER_FAULT' });
      expect(match.getSnapshot()).toEqual(before);
      expect(match.getRevision()).toBe(revision);
      expect(match.getLog()).toHaveLength(logLength);
      expect(match.getTimeline()).toHaveLength(timelineLength);
    },
  );
});

describe('registration ownership (Match ctor)', () => {
  it('rejects non-function handler values', () => {
    const entries: Array<[string, RngHandler<WorldState>]> = [
      ['evil', 42 as unknown as RngHandler<WorldState>],
    ];
    expect(() => stdMatch(new Map(entries))).toThrow(/invalid handler registration/);
  });

  it('rejects empty handler names', () => {
    const entries: Array<[string, RngHandler<WorldState>]> = [
      ['', (ctx) => ({ applied: true, state: ctx.state, summary: 'x' })],
    ];
    expect(() => stdMatch(new Map(entries))).toThrow(/invalid handler registration/);
  });
});

describe('rng wiring (determinism)', () => {
  function runDraws(): Match {
    const match = stdMatch(drawHandlers());
    const session = match.join(P1);
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'test.draw', payload: {} }),
    );
    match.dispatch(
      session,
      raw({ requestId: 'r2', playerId: 'p1', type: 'world.noop', payload: {} }),
    );
    match.dispatch(
      session,
      raw({ requestId: 'r3', playerId: 'p1', type: 'test.draw', payload: {} }),
    );
    return match;
  }

  it('reproduces identical timelines incl. embedded draws (run x2)', () => {
    const first = runDraws();
    const second = runDraws();
    expect(second.getTimeline()).toEqual(first.getTimeline());
    expect(second.getStateHash()).toBe(first.getStateHash());
  });

  it('derives streams from (seed, seq): exact wiring + duplicates consume nothing', () => {
    const expected1 = new SeededRng(deriveSeed(999, 1)).nextUint32();
    const expected2 = new SeededRng(deriveSeed(999, 2)).nextUint32();
    const match = stdMatch(drawHandlers());
    const session = match.join(P1);
    const first = match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'test.draw', payload: {} }),
    );
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'test.draw', payload: {} }),
    );
    const second = match.dispatch(
      session,
      raw({ requestId: 'r2', playerId: 'p1', type: 'test.draw', payload: {} }),
    );
    expect(first).toEqual({ status: 'applied', revision: 1, summary: `draw=${expected1}` });
    expect(second).toEqual({ status: 'applied', revision: 2, summary: `draw=${expected2}` });
  });
});

describe('rejection short-circuit', () => {
  it('returns rejections untouched without running post-rules (TEST MOCK probe)', () => {
    let called = false;
    // TEST MOCK: probe that must never run (rejections carry no state).
    const probe: PostRule = () => {
      called = true;
      return null;
    };
    const validator = { ...createWorldValidator(), post: [probe] };
    const wrapped = wrapWithValidation(
      () => ({ applied: false, reason: 'nope' }),
      validator,
      7,
      () => 1,
    );
    expect(wrapped({ state: stdState(), caller: P1, params: {} })).toEqual({
      applied: false,
      reason: 'nope',
    });
    expect(called).toBe(false);
  });
});

describe('rule failure loudness', () => {
  it('surfaces throwing rules as HANDLER_FAULT with state untouched (TEST MOCK)', () => {
    // TEST MOCK: broken rule (a rule must never throw; if it does, loud fault).
    const boom: PreRule = () => {
      throw new Error('TEST MOCK boom');
    };
    const kernel = kernelWithPre([boom]);
    const session = kernel.join(P1);
    const before = kernel.getSnapshot();
    expect(
      kernel.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'test.echo', payload: {} }),
      ),
    ).toEqual({ status: 'error', code: 'HANDLER_FAULT' });
    expect(kernel.getSnapshot()).toEqual(before);
  });
});
