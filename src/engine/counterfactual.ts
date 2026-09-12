/**
 * M049 — Counterfactual query: what would confidence say after X
 * (LAYER L3, read-only).
 *
 * The block's first transversal consumer (D-043, voted sim-query):
 * whatIfConfidence forks the state (structuredClone, kernel
 * precedent), applies ONE hypothetical order through the LIVE domain
 * handler behind its wire-shape pre-rule, then scores the TARGET
 * queued order on the outcome state via confidenceOfOrder. No
 * prompts, no events, no timeline, no exposed fork — the real Match
 * never moves. Cities/buildings never advance in the sim (no
 * evaluator reads them — declared cut; M050 multi-order scripts
 * revisit). The caller rides the validated-state seam (M029): verb
 * wire-rules are shape-only (they ignore caller and state), so the
 * holder id passes through. LAYER L3 (imports
 * authority/commanders/map/orders/refutations/units L0 +
 * confidence/validation L2 + world-state L1, all downward; domain
 * handlers/rules/configs stay injected — M045 treasury precedent).
 */

import type { PlayerId, TransitionHandler } from './authority.js';
import type { CommanderRecord } from './commanders.js';
import { confidenceOfOrder, type ConfidenceRules, type OrderConfidence } from './confidence.js';
import { isOrderKind } from './orders.js';
import type { RefutationReason } from './refutations.js';
import type { PreRule } from './validation.js';
import type { WorldState } from './world-state.js';

/** One hypothetical: wire-shaped (validated inside, fail-closed). */
export interface HypotheticalOrder {
  readonly kind: string;
  readonly params?: unknown;
}

/**
 * Live engine truth, injected (Match adapts its validated maps).
 * Confidence rules come from a per-state factory: the sim scores the
 * OUTCOME state, so snapshot-bound closures (treasury) must rebind —
 * a fixed rules object would price the original funds.
 */
export interface CounterfactualDeps {
  readonly handlers: ReadonlyMap<string, TransitionHandler<WorldState>>;
  readonly rules: ReadonlyMap<string, PreRule>;
  readonly confidenceFor: (state: WorldState) => ConfidenceRules;
}

/** Sim verdict: did the hypothetical apply, and the target's outcome score. */
export interface WhatIfConfidence {
  readonly applied: boolean;
  readonly reason?: string;
  readonly outcome?: OrderConfidence;
}

/**
 * "What would confidence say after X" (fail-soft: missing record or
 * target yields undefined — queries never throw). Reasons surface
 * verbatim (rule detail, handler reason) so sim-vs-dispatch parity is
 * auditable per case.
 */
export function whatIfConfidence(
  record: CommanderRecord | undefined,
  orderIndex: number,
  state: WorldState,
  hypothetical: HypotheticalOrder,
  deps: CounterfactualDeps,
): WhatIfConfidence | undefined {
  // M050: the single query delegates to the script core (one step —
  // the M049 tests pin this delegation intact).
  const scripted = whatIfScript(record, orderIndex, state, [hypothetical], deps);
  if (scripted === undefined) {
    return undefined;
  }
  if (!scripted.applied) {
    return { applied: false, reason: scripted.reason };
  }
  return { applied: true, outcome: scripted.outcome };
}

/** Script verdict: first failure (and where), or the final outcome score. */
export type WhatIfScript =
  | { readonly applied: true; readonly outcome: OrderConfidence }
  | { readonly applied: false; readonly reason: string; readonly failedAt: number };

/** One candidate scored: its input index, its sim, its outcome. */
export interface RankedCandidate {
  readonly index: number;
  readonly candidate: HypotheticalOrder;
  readonly applied: boolean;
  readonly reason?: string;
  readonly score?: number;
  readonly failed?: readonly RefutationReason[];
}

/** Best-first ranking plus the recommended input index (if any applied). */
export interface CandidateRanking {
  readonly ranking: readonly RankedCandidate[];
  readonly recommended?: number;
}

/**
 * Unguarded sim core (M050): one fork, steps in sequence, first
 * failure wins with its step index. Callers own the fail-soft
 * guards. Verb wire-rules are shape-only (they ignore caller and
 * state), so the holder id passes through the PreRule seam (M029
 * precedent).
 */
function simulateScript(
  record: CommanderRecord,
  orderIndex: number,
  state: WorldState,
  script: readonly HypotheticalOrder[],
  deps: CounterfactualDeps,
): WhatIfScript {
  const caller = record.owner as PlayerId;
  let fork = structuredClone(state);
  let failedAt = 0;
  for (const hypothetical of script) {
    if (!isOrderKind(hypothetical.kind)) {
      return { applied: false, reason: 'counterfactual: not orderable.', failedAt };
    }
    const rule = deps.rules.get(hypothetical.kind);
    const handler = deps.handlers.get(hypothetical.kind);
    if (rule === undefined || handler === undefined) {
      return { applied: false, reason: 'counterfactual: unknown kind.', failedAt };
    }
    const violation = rule(caller, hypothetical.params, fork);
    if (violation !== null) {
      return { applied: false, reason: violation.detail, failedAt };
    }
    const outcome = handler({ state: fork, caller, params: hypothetical.params });
    if (!outcome.applied) {
      return { applied: false, reason: outcome.reason, failedAt };
    }
    fork = outcome.state;
    failedAt += 1;
  }
  // The target pre-guarded present and sims never move queues
  // (hypotheticals are orderables, scored against the separate
  // record) — the outcome always exists; this cast documents the
  // seam (match.ts `validated` precedent).
  const outcome = confidenceOfOrder(record, orderIndex, fork, deps.confidenceFor(fork));
  return { applied: true, outcome: outcome as OrderConfidence };
}

/**
 * "What would confidence say after this SCRIPT" (fail-soft: missing
 * record or target yields undefined — queries never throw). An empty
 * script scores the target on the untouched state (vacuous sim).
 */
export function whatIfScript(
  record: CommanderRecord | undefined,
  orderIndex: number,
  state: WorldState,
  script: readonly HypotheticalOrder[],
  deps: CounterfactualDeps,
): WhatIfScript | undefined {
  if (record === undefined) {
    return undefined;
  }
  if ((record.orders ?? [])[orderIndex] === undefined) {
    return undefined;
  }
  return simulateScript(record, orderIndex, state, script, deps);
}

/**
 * "Which hypothetical is best" (fail-soft like its siblings). Every
 * candidate simulates alone; best-first by outcome score with stable
 * input-order ties; unapplied (and unscored) candidates sink with
 * score −1. Deterministic end to end.
 */
export function rankCandidates(
  record: CommanderRecord | undefined,
  orderIndex: number,
  state: WorldState,
  candidates: readonly HypotheticalOrder[],
  deps: CounterfactualDeps,
): CandidateRanking | undefined {
  if (record === undefined) {
    return undefined;
  }
  if ((record.orders ?? [])[orderIndex] === undefined) {
    return undefined;
  }
  const ranked: RankedCandidate[] = [];
  let position = 0;
  for (const candidate of candidates) {
    const verdict = simulateScript(record, orderIndex, state, [candidate], deps);
    ranked.push(
      verdict.applied
        ? {
            index: position,
            candidate,
            applied: true,
            score: verdict.outcome.score,
            failed: verdict.outcome.failed,
          }
        : { index: position, candidate, applied: false, reason: verdict.reason },
    );
    position += 1;
  }
  const ranking = [...ranked].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const best = ranking.find((entry) => entry.applied);
  return { ranking, recommended: best?.index };
}
