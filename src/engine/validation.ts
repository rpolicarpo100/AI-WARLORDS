import type {
  PlayerId,
  TransitionContext,
  TransitionHandler,
  TransitionResult,
} from './authority.js';
import { stableStringify } from './hash.js';
import { deriveSeed, SeededRng } from './rng.js';
import { isWorldState, type WorldState } from './world-state.js';

/**
 * ACTION VALIDATOR (M006): the pipeline stage between proposal and engine.
 * Every handler runs wrapped: pre-rules can reject (caller's fault),
 * post-invariants can fault (handler's fault, loud, state untouched), and
 * every dispatch receives an independent RNG stream derived from
 * (match seed, log sequence) — reconstructible from those two alone.
 *
 * Design: pre-rules collect ALL violations in rule order (no short-circuit,
 * so no rule is silently skipped); the shape gate short-circuits the rest
 * of post (a malformed state cannot be meaningfully compared further).
 * Schema-version preservation is subsumed by the shape gate while the
 * engine is single-version (no dead rule kept for decoration).
 * M010 adds map-preserved (fail-closed geography integrity, O(1)).
 * M014 adds explored-monotonic (memory only accumulates; anti-forge
 * stays a documented residual until stateful vision exists, L-28).
 */

/** A single failed check: which rule + deterministic detail. */
export interface Violation {
  readonly rule: string;
  readonly detail: string;
}

/** Pre-execution rule over the caller-visible context. Null = pass. */
export type PreRule = (caller: PlayerId, params: unknown, state: WorldState) => Violation | null;

/** Post-execution rule over the applied state. Null = pass. */
export type PostRule = (before: WorldState, after: WorldState) => Violation | null;

/**
 * Provisional per-write cap (length of canonical JSON in UTF-16 units, not
 * bytes). A safety bound, not a tuned budget: M088 measures real state
 * sizes (L-12).
 */
export const MAX_STATE_BYTES = 1000000;

export interface WorldValidator {
  readonly pre: readonly PreRule[];
  readonly postShape: PostRule;
  readonly post: readonly PostRule[];
}

/** Built-ins take no parameters: any non-empty payload is a caller bug. */
export function noParamsRule(handlerName: string): PreRule {
  return (_caller, params) => {
    let encoded: string;
    try {
      encoded = stableStringify(params);
    } catch {
      return { rule: 'no-params', detail: `${handlerName} payload is not serializable` };
    }
    if (encoded !== '{}') {
      return { rule: 'no-params', detail: `${handlerName} takes no parameters` };
    }
    return null;
  };
}

function shapeRule(_before: WorldState, after: WorldState): Violation | null {
  if (isWorldState(after)) {
    return null;
  }
  return { rule: 'state-shape', detail: 'applied state failed the WorldState guard' };
}

function rosterRule(before: WorldState, after: WorldState): Violation | null {
  const expected = JSON.stringify(before.players.map((p) => p.id));
  const actual = JSON.stringify(after.players.map((p) => p.id));
  if (expected === actual) {
    return null;
  }
  return { rule: 'roster-preserved', detail: `expected ${expected} got ${actual}` };
}

function tickRule(before: WorldState, after: WorldState): Violation | null {
  if (after.tick >= before.tick) {
    return null;
  }
  return { rule: 'tick-monotonic', detail: `tick ${before.tick} -> ${after.tick}` };
}

function sizeRule(_before: WorldState, after: WorldState): Violation | null {
  const bytes = stableStringify(after).length;
  if (bytes <= MAX_STATE_BYTES) {
    return null;
  }
  return { rule: 'state-size', detail: `${bytes} bytes (max ${MAX_STATE_BYTES})` };
}

/**
 * M010 geography integrity: no handler may replace the map object —
 * fail-closed (there are no map transitions yet; forged terrain is the
 * same threat class as R-20). Reference check is O(1): handlers that
 * merely spread state keep the same reference and pass untouched.
 */
function mapRule(before: WorldState, after: WorldState): Violation | null {
  if (before.map === after.map) {
    return null;
  }
  return {
    rule: 'map-preserved',
    detail: 'map replaced without a map transition (none exist yet)',
  };
}

/**
 * M014 exploration memory: no handler may wipe, shrink, or drop a viewer —
 * knowledge only accumulates. Before-undefined/after-defined passes (memory
 * arriving with map context); the reference-fast path keeps handlers that
 * merely spread state untouched.
 */
function exploredRule(before: WorldState, after: WorldState): Violation | null {
  if (before.explored === after.explored) {
    return null;
  }
  if (before.explored === undefined) {
    return null;
  }
  const afterExplored = after.explored;
  if (afterExplored === undefined) {
    return { rule: 'explored-monotonic', detail: 'explored memory wiped' };
  }
  for (const [viewer, indices] of Object.entries(before.explored.viewers)) {
    const grown = afterExplored.viewers[viewer];
    if (grown === undefined || grown.length < indices.length) {
      return { rule: 'explored-monotonic', detail: `viewer ${viewer} lost memory` };
    }
    for (const index of indices) {
      if (!grown.includes(index)) {
        return { rule: 'explored-monotonic', detail: `viewer ${viewer} lost cell ${index}` };
      }
    }
  }
  return null;
}

export function createWorldValidator(): WorldValidator {
  return {
    pre: [],
    postShape: shapeRule,
    post: [rosterRule, tickRule, sizeRule, mapRule, exploredRule],
  };
}

/** Handler context extended with the dispatch's deterministic RNG stream. */
export type RngContext<S> = TransitionContext<S> & { readonly rng: SeededRng };

export type RngHandler<S> = (ctx: RngContext<S>) => TransitionResult<S>;

function formatViolations(prefix: string, violations: readonly Violation[]): string {
  return `${prefix}: ${violations.map((v) => `[${v.rule}] ${v.detail}`).join('; ')}`;
}

/**
 * Adapts a (possibly RNG-aware) handler to the kernel: pre-rules first,
 * then the per-dispatch stream, then post-invariants. `nextSeq` must yield
 * the 1-based ordinal of each wrapper invocation (deterministic per call
 * history; faults consume an ordinal without appending to the log).
 */
export function wrapWithValidation(
  inner: RngHandler<WorldState>,
  validator: WorldValidator,
  seed: number,
  nextSeq: () => number,
): TransitionHandler<WorldState> {
  return (ctx) => {
    const seq = nextSeq();
    const failures: Violation[] = [];
    for (const rule of validator.pre) {
      const violation = rule(ctx.caller, ctx.params, ctx.state);
      if (violation !== null) {
        failures.push(violation);
      }
    }
    if (failures.length > 0) {
      return { applied: false, reason: formatViolations('validation', failures) };
    }
    const rng = new SeededRng(deriveSeed(seed, seq));
    const outcome = inner({ ...ctx, rng });
    if (!outcome.applied) {
      return outcome;
    }
    const shapeViolation = validator.postShape(ctx.state, outcome.state);
    if (shapeViolation !== null) {
      throw new Error(formatViolations('postcondition', [shapeViolation]));
    }
    const postFailures: Violation[] = [];
    for (const rule of validator.post) {
      const violation = rule(ctx.state, outcome.state);
      if (violation !== null) {
        postFailures.push(violation);
      }
    }
    if (postFailures.length > 0) {
      throw new Error(formatViolations('postcondition', postFailures));
    }
    return outcome;
  };
}
