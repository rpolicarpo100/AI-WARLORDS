/**
 * M009 — Core Engine Test Suite (Phase-1 gate evidence).
 *
 * Transversal proof over M003–M008 using REAL engine wiring only: twin-match
 * determinism (#80), invalid-input zero-trace (adversarial), finish-boundary
 * interplay, static determinism-hygiene + architecture scans (security/arch
 * review), and scale execution (performance review — measured, never gated).
 * The single TEST handler below exists only to consume RNG streams (there is
 * no domain consumer yet); everything else runs production defaults.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  markUntrusted,
  type ClientRequest,
  type PlayerId,
  type SessionHandle,
  type SessionId,
  type Untrusted,
} from './authority.js';
import { hashState } from './hash.js';
import { Match, STANDARD_RULESET, type MatchInit } from './match.js';
import type { RngHandler } from './validation.js';
import type { Verdict } from './victory.js';
import { createWorldState, type WorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;
const SEED = 9001;

/** Simulates untrusted wire bytes: unknown input, marked at the boundary. */
function raw(value: unknown): Untrusted<ClientRequest> {
  return markUntrusted(value as ClientRequest);
}

function baseInit(patch: Partial<MatchInit> = {}): MatchInit {
  return {
    seed: SEED,
    ruleset: STANDARD_RULESET,
    players: [P1, P2],
    initialState: createWorldState({ players: [P1, P2] }),
    ...patch,
  };
}

function makeMatch(patch: Partial<MatchInit> = {}): Match {
  return new Match(baseInit(patch));
}

function joinBoth(match: Match): { readonly s1: SessionHandle; readonly s2: SessionHandle } {
  return { s1: match.join(P1), s2: match.join(P2) };
}

/** Dispatches one real `match.advance` and asserts exact application. */
function advance(
  match: Match,
  session: SessionHandle,
  requestId: string,
  playerId: PlayerId,
): void {
  const outcome = match.dispatch(
    session,
    raw({ requestId, playerId, type: 'match.advance', payload: {} }),
  );
  expect(outcome).toEqual({
    status: 'applied',
    revision: match.getRevision(),
    summary: `tick=${match.getTick()}`,
  });
}

/** Shared valid script (ticks 1–6): identical call history on every twin. */
const SCRIPT: ReadonlyArray<{ readonly id: string; readonly player: 1 | 2 }> = [
  { id: 'v1', player: 1 },
  { id: 'v2', player: 2 },
  { id: 'v3', player: 1 },
  { id: 'v4', player: 1 },
  { id: 'v5', player: 2 },
  { id: 'v6', player: 2 },
];

function runSteps(
  match: Match,
  s1: SessionHandle,
  s2: SessionHandle,
  from: number,
  to: number,
): void {
  for (let index = from; index < to; index += 1) {
    const step = SCRIPT[index];
    if (step === undefined) {
      throw new Error('test setup: script step out of range');
    }
    advance(match, step.player === 1 ? s1 : s2, step.id, step.player === 1 ? P1 : P2);
  }
}

function runFullScript(match: Match): void {
  const { s1, s2 } = joinBoth(match);
  runSteps(match, s1, s2, 0, SCRIPT.length);
}

interface Fingerprint {
  readonly stateHash: string;
  readonly timelineHash: string;
  readonly eventsHash: string;
  readonly verdict: Verdict;
  readonly tick: number;
  readonly revision: number;
  readonly logLength: number;
  readonly timelineLength: number;
  readonly eventsLength: number;
}

function fingerprint(match: Match): Fingerprint {
  return {
    stateHash: match.getStateHash(),
    timelineHash: hashState(match.getTimeline()),
    eventsHash: hashState(match.getEvents()),
    verdict: match.getVerdict(),
    tick: match.getTick(),
    revision: match.getRevision(),
    logLength: match.getLog().length,
    timelineLength: match.getTimeline().length,
    eventsLength: match.getEvents().length,
  };
}

/**
 * Tier-1 noise battery A: envelope/auth/dedupe/registry faults. The kernel
 * returns all of these BEFORE touching seen/log/revision (authority.ts
 * dispatch), so they must leave zero trace on every observable.
 */
function noiseA(match: Match, s1: SessionHandle): void {
  expect(match.dispatch(s1, raw({}))).toEqual({ status: 'error', code: 'MALFORMED_REQUEST' });
  expect(
    match.dispatch(
      s1,
      raw({ requestId: 'a-unknown', playerId: P1, type: 'nope.unknown', payload: {} }),
    ),
  ).toEqual({ status: 'error', code: 'UNKNOWN_TRANSITION' });
  expect(
    match.dispatch(s1, raw({ requestId: 'v1', playerId: P1, type: 'match.advance', payload: {} })),
  ).toEqual({
    status: 'duplicate',
    original: { status: 'applied', revision: 1, summary: 'tick=1' },
  });
  expect(
    match.dispatch(
      s1,
      raw({ requestId: 'a-spoof', playerId: P2, type: 'match.advance', payload: {} }),
    ),
  ).toEqual({ status: 'error', code: 'SPOOFED_SENDER' });
  const forged = { sessionId: 'nope' as SessionId, playerId: P1 };
  expect(
    match.dispatch(
      forged,
      raw({ requestId: 'a-forge', playerId: P1, type: 'match.advance', payload: {} }),
    ),
  ).toEqual({ status: 'error', code: 'INVALID_SESSION' });
}

/** Reads v2's recorded outcome back from the twin's own timeline (script-agnostic). */
function recordedV2(match: Match): { readonly revision: number; readonly summary: string } {
  const entry = match.getTimeline().find((candidate) => candidate.requestId === 'v2');
  if (entry === undefined) {
    throw new Error('test setup: v2 must be recorded before noiseB runs');
  }
  return { revision: entry.revision, summary: entry.detail };
}

/** Tier-1 noise battery B: different shapes, ids and order than noiseA. */
function noiseB(match: Match, s1: SessionHandle, s2: SessionHandle): void {
  const tampered = { ...s2, playerId: P1 };
  expect(
    match.dispatch(
      tampered,
      raw({ requestId: 'b-tamper', playerId: P1, type: 'match.advance', payload: {} }),
    ),
  ).toEqual({ status: 'error', code: 'INVALID_SESSION' });
  const v2 = recordedV2(match);
  expect(
    match.dispatch(s2, raw({ requestId: 'v2', playerId: P2, type: 'match.advance', payload: {} })),
  ).toEqual({
    status: 'duplicate',
    original: { status: 'applied', revision: v2.revision, summary: v2.summary },
  });
  expect(match.dispatch(s2, raw('junk-wire-bytes'))).toEqual({
    status: 'error',
    code: 'MALFORMED_REQUEST',
  });
  expect(
    match.dispatch(
      s2,
      raw({ requestId: 'b-unknown', playerId: P2, type: 'evil.admin', payload: {} }),
    ),
  ).toEqual({ status: 'error', code: 'UNKNOWN_TRANSITION' });
  expect(match.dispatch(s1, raw(null))).toEqual({
    status: 'error',
    code: 'MALFORMED_REQUEST',
  });
}

describe('determinism equation: seed + state + actions = result (#80)', () => {
  it('twins under identical scripts are deep-equal on every observable', () => {
    const a = makeMatch();
    runFullScript(a);
    const b = makeMatch();
    runFullScript(b);

    expect(fingerprint(b)).toEqual(fingerprint(a));
    expect(b.getSnapshot()).toEqual(a.getSnapshot());
    expect(b.getLog()).toEqual(a.getLog());
    expect(b.getTimeline()).toEqual(a.getTimeline());
    expect(b.getEvents()).toEqual(a.getEvents());
  });

  it('equation holds across repeated runs (5x fresh matches)', () => {
    const first = makeMatch();
    runFullScript(first);
    const expected = fingerprint(first);

    for (let run = 0; run < 4; run += 1) {
      const twin = makeMatch();
      runFullScript(twin);
      expect(fingerprint(twin)).toEqual(expected);
    }
  });

  it('phase-1 seal: full-stack golden incl. events + verdict (generated-then-locked)', () => {
    // M015 regen (secrets-field removal): ONLY the two state-derived hashes
    // changed — entry-level proof (4 embedded stateHash atoms) + the
    // superseded seal live in docs/modules/M015.md §6. All other fields
    // below are byte-identical to the M009 lock (any drift fails loud).
    const SEAL: Fingerprint = {
      stateHash: '2e1d8cc4a41fe59597bd9fc140ef044a5977a2c2586a0cde85eb9ef1f6dcda49',
      timelineHash: 'bf3b98d38bf58e667b1b50d89473e263812a58a604dca4e0bb9527c934e530b5',
      eventsHash: '3cc8a91199a87118a8c8f339b3b9fdd028dd8c269a2f42d1e95312eb60fc8631',
      verdict: {
        status: 'finished',
        outcome: { kind: 'draw' },
        condition: 'time-limit',
        tick: 4,
        revision: 4,
      },
      tick: 4,
      revision: 4,
      logLength: 4,
      timelineLength: 4,
      eventsLength: 6,
    };
    const match = makeMatch({ maxTicks: 4 });
    const { s1, s2 } = joinBoth(match);
    advance(match, s1, 's1', P1);
    advance(match, s2, 's2', P2);
    advance(match, s1, 's3', P1);
    advance(match, s2, 's4', P2);

    expect(fingerprint(match)).toEqual(SEAL);
  });
});

describe('invalid-input zero-trace (adversarial, cross-module)', () => {
  it('different Tier-1 noise at different points leaves twins identical', () => {
    const a = makeMatch();
    const sa = joinBoth(a);
    runSteps(a, sa.s1, sa.s2, 0, 3);
    noiseA(a, sa.s1);
    runSteps(a, sa.s1, sa.s2, 3, SCRIPT.length);

    const b = makeMatch();
    const sb = joinBoth(b);
    runSteps(b, sb.s1, sb.s2, 0, 2);
    noiseB(b, sb.s1, sb.s2);
    runSteps(b, sb.s1, sb.s2, 2, SCRIPT.length);

    expect(fingerprint(b)).toEqual(fingerprint(a));
    expect(b.getSnapshot()).toEqual(a.getSnapshot());
    expect(b.getTimeline()).toEqual(a.getTimeline());
    expect(b.getEvents()).toEqual(a.getEvents());
  });

  it('seen-state proven equal via duplicate replay; noise ids never recorded', () => {
    const a = makeMatch();
    runFullScript(a);
    const b = makeMatch();
    runFullScript(b);

    const replay = raw({ requestId: 'v4', playerId: P1, type: 'match.advance', payload: {} });
    const outA = a.dispatch(a.join(P1), replay);
    const outB = b.dispatch(b.join(P1), replay);
    expect(outA).toEqual(outB);
    expect(outA).toEqual({
      status: 'duplicate',
      original: { status: 'applied', revision: 4, summary: 'tick=4' },
    });

    const ghost = raw({
      requestId: 'ghost-unknown',
      playerId: P1,
      type: 'nope.unknown',
      payload: {},
    });
    expect(a.dispatch(a.join(P1), ghost)).toEqual({
      status: 'error',
      code: 'UNKNOWN_TRANSITION',
    });
    expect(b.dispatch(b.join(P1), ghost)).toEqual({
      status: 'error',
      code: 'UNKNOWN_TRANSITION',
    });
  });

  it('RNG streams survive noise (twin equality via TEST consumer)', () => {
    // TEST handler: consumes the dispatch RNG stream into the observable
    // summary (timeline detail). No domain consumer exists yet.
    const rngHandlers = new Map<string, RngHandler<WorldState>>([
      [
        'test.rngdraw',
        (ctx) => ({ applied: true, state: ctx.state, summary: `draw=${ctx.rng.nextUint32()}` }),
      ],
    ]);
    const draw = (
      match: Match,
      session: SessionHandle,
      requestId: string,
      playerId: PlayerId,
    ): void => {
      const outcome = match.dispatch(
        session,
        raw({ requestId, playerId, type: 'test.rngdraw', payload: {} }),
      );
      expect(outcome.status).toBe('applied');
    };

    const a = makeMatch({ extraHandlers: rngHandlers });
    const sa = joinBoth(a);
    advance(a, sa.s1, 'v1', P1);
    draw(a, sa.s1, 'd1', P1);
    noiseA(a, sa.s1);
    advance(a, sa.s2, 'v2', P2);
    draw(a, sa.s2, 'd2', P2);

    const b = makeMatch({ extraHandlers: rngHandlers });
    const sb = joinBoth(b);
    advance(b, sb.s1, 'v1', P1);
    draw(b, sb.s1, 'd1', P1);
    advance(b, sb.s2, 'v2', P2);
    noiseB(b, sb.s1, sb.s2);
    draw(b, sb.s2, 'd2', P2);

    expect(fingerprint(b)).toEqual(fingerprint(a));
    expect(b.getTimeline()).toEqual(a.getTimeline());
    expect(b.getSnapshot()).toEqual(a.getSnapshot());
  });
});

describe('finish boundary (M006 x M007 x M008 interplay)', () => {
  it('invalid storm at the finishing tick keeps exactly-once finish', () => {
    const match = makeMatch({ maxTicks: 3 });
    const { s1, s2 } = joinBoth(match);
    advance(match, s1, 'v1', P1);
    advance(match, s2, 'v2', P2);
    noiseA(match, s1);
    noiseB(match, s1, s2);
    advance(match, s1, 'v3', P1);

    expect(match.dispatch(s1, raw({}))).toEqual({ status: 'error', code: 'MATCH_FINISHED' });
    const finished = match.getEvents().filter((event) => event.type === 'match.finished');
    expect(finished).toHaveLength(1);
    expect(match.getVerdict()).toEqual({
      status: 'finished',
      outcome: { kind: 'draw' },
      condition: 'time-limit',
      tick: 3,
      revision: 3,
    });
    expect(match.getTick()).toBe(3);
  });

  it('post-finish blocks every request shape with frozen traces', () => {
    const match = makeMatch({ maxTicks: 1 });
    const { s1, s2 } = joinBoth(match);
    advance(match, s1, 'v1', P1);
    expect(match.getVerdict().status).toBe('finished');

    const timelineLength = match.getTimeline().length;
    const eventsLength = match.getEvents().length;
    const forged = { sessionId: 'nope' as SessionId, playerId: P1 };
    const outcomes = [
      match.dispatch(
        s1,
        raw({ requestId: 'w1', playerId: P1, type: 'match.advance', payload: {} }),
      ),
      match.dispatch(s1, raw({})),
      match.dispatch(s2, raw({ requestId: 'w2', playerId: P2, type: 'nope.unknown', payload: {} })),
      match.dispatch(
        forged,
        raw({ requestId: 'w3', playerId: P1, type: 'match.advance', payload: {} }),
      ),
    ];
    for (const outcome of outcomes) {
      expect(outcome).toEqual({ status: 'error', code: 'MATCH_FINISHED' });
    }
    expect(match.getTimeline()).toHaveLength(timelineLength);
    expect(match.getEvents()).toHaveLength(eventsLength);
    expect(match.getTick()).toBe(1);
    expect(match.getRevision()).toBe(1);
  });
});

const ENGINE_DIR = dirname(fileURLToPath(import.meta.url));

function engineSources(): string[] {
  return readdirSync(ENGINE_DIR)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .sort();
}

function readSource(file: string): string {
  return readFileSync(join(ENGINE_DIR, file), 'utf8');
}

describe('determinism hygiene (static security review)', () => {
  it('locks the engine module census (no silently skipped files)', () => {
    expect(engineSources()).toEqual([
      'authority.ts',
      'buildings.ts',
      'city.ts',
      'economy.ts',
      'events.ts',
      'exploration.ts',
      'explored.ts',
      'fog.ts',
      'harness.ts',
      'hash.ts',
      'map.ts',
      'match.ts',
      'resources.ts',
      'rng.ts',
      'stockpiles.ts',
      'terrain.ts',
      'units.ts',
      'validation.ts',
      'victory.ts',
      'views.ts',
      'warfare.ts',
      'world-state.ts',
    ]);
  });

  it('engine sources contain no nondeterminism primitives', () => {
    const BANNED = [
      'Math.random',
      'Date.now(',
      'Date(',
      'Date.parse',
      'randomBytes',
      'randomInt',
      'randomFill',
      'getRandomValues',
      'performance.now(',
      'process.hrtime',
      'process.uptime',
      'import(',
      'require(',
    ];
    for (const file of engineSources()) {
      const text = readSource(file);
      for (const token of BANNED) {
        expect(text.includes(token), `${file} must not contain ${token}`).toBe(false);
      }
    }
  });

  it('randomUUID exists only at the two identity call-sites (allowlist)', () => {
    const hits: string[] = [];
    for (const file of engineSources()) {
      for (const line of readSource(file).split('\n')) {
        if (!line.includes('randomUUID')) {
          continue;
        }
        const trimmed = line.trim();
        const allowed =
          trimmed === "import { randomUUID } from 'node:crypto';" ||
          trimmed === 'const sessionId = randomUUID() as SessionId;' ||
          trimmed === 'return randomUUID() as MatchId;';
        expect(allowed, `${file}: unexpected randomUUID use: ${trimmed}`).toBe(true);
        hits.push(`${file}:${trimmed}`);
      }
    }
    // Identity metadata only (session/match ids never enter game traces):
    // 2 imports + 2 call-sites. Any new use fails loud here.
    expect(hits).toHaveLength(4);
  });
});

describe('architecture boundary (static review)', () => {
  const LAYERS: Record<string, number> = {
    authority: 0,
    hash: 0,
    map: 0,
    rng: 0,
    explored: 0,
    stockpiles: 0,
    buildings: 0,
    city: 0,
    units: 0,
    'world-state': 1,
    economy: 2,
    exploration: 2,
    fog: 2,
    harness: 2,
    resources: 2,
    terrain: 2,
    validation: 2,
    victory: 2,
    views: 2,
    warfare: 2,
    events: 3,
    match: 4,
  };

  function importGraph(): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    for (const file of engineSources()) {
      const text = readSource(file);
      const deps: string[] = [];
      const pattern = /from '\.\/([a-z-]+)\.js'/g;
      let found: RegExpExecArray | null;
      while ((found = pattern.exec(text)) !== null) {
        const dep = found[1];
        if (dep !== undefined && !deps.includes(dep)) {
          deps.push(dep);
        }
      }
      graph.set(file.replace(/\.ts$/, ''), deps.sort());
    }
    return graph;
  }

  it('every edge points strictly downward; unknown files fail loud', () => {
    const graph = importGraph();
    expect([...graph.keys()].sort()).toEqual(Object.keys(LAYERS).sort());
    for (const [name, deps] of graph) {
      const layer: number | undefined = LAYERS[name];
      if (layer === undefined) {
        throw new Error(`phase-1-gate: ${name} missing from LAYERS (deliberate tripwire)`);
      }
      for (const dep of deps) {
        const depLayer: number | undefined = LAYERS[dep];
        if (depLayer === undefined) {
          throw new Error(`phase-1-gate: ${dep} missing from LAYERS (deliberate tripwire)`);
        }
        expect(depLayer, `${name} -> ${dep} must point downward`).toBeLessThan(layer);
      }
    }
  });

  it('import graph is acyclic', () => {
    const graph = importGraph();
    const state = new Map<string, 'open' | 'closed'>();
    const visit = (node: string, stack: string[]): void => {
      const mark = state.get(node);
      if (mark === 'closed') {
        return;
      }
      if (mark === 'open') {
        throw new Error(`phase-1-gate: import cycle: ${[...stack, node].join(' -> ')}`);
      }
      state.set(node, 'open');
      for (const dep of graph.get(node) ?? []) {
        visit(dep, [...stack, node]);
      }
      state.set(node, 'closed');
    };
    for (const node of graph.keys()) {
      visit(node, []);
    }
  });
});

describe('scale execution (performance review: measured, never gated)', () => {
  it('500 dispatches stay correct and deterministic (#93: no invented thresholds)', () => {
    const K = 500;
    const run = (): Match => {
      const match = makeMatch();
      const { s1, s2 } = joinBoth(match);
      for (let i = 1; i <= K; i += 1) {
        const even = i % 2 === 0;
        advance(match, even ? s2 : s1, `k${i}`, even ? P2 : P1);
      }
      return match;
    };

    const match = run();
    expect(match.getTick()).toBe(K);
    expect(match.getRevision()).toBe(K);
    expect(match.getLog()).toHaveLength(K);
    expect(match.getTimeline()).toHaveLength(K);
    expect(match.getEvents()).toHaveLength(K + 1);
    expect(match.getVerdict()).toEqual({ status: 'ongoing' });

    const twin = run();
    expect(fingerprint(twin)).toEqual(fingerprint(match));
  });
});
