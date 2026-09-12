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
  if (record === undefined) {
    return undefined;
  }
  if ((record.orders ?? [])[orderIndex] === undefined) {
    return undefined;
  }
  if (!isOrderKind(hypothetical.kind)) {
    return { applied: false, reason: 'counterfactual: not orderable.' };
  }
  const rule = deps.rules.get(hypothetical.kind);
  const handler = deps.handlers.get(hypothetical.kind);
  if (rule === undefined || handler === undefined) {
    return { applied: false, reason: 'counterfactual: unknown kind.' };
  }
  // Verb wire-rules are shape-only (they ignore caller and state), so
  // the holder id passes through the PreRule seam (M029 precedent).
  const caller = record.owner as PlayerId;
  const violation = rule(caller, hypothetical.params, state);
  if (violation !== null) {
    return { applied: false, reason: violation.detail };
  }
  const fork = structuredClone(state);
  const outcome = handler({ state: fork, caller, params: hypothetical.params });
  if (!outcome.applied) {
    return { applied: false, reason: outcome.reason };
  }
  return {
    applied: true,
    outcome: confidenceOfOrder(
      record,
      orderIndex,
      outcome.state,
      deps.confidenceFor(outcome.state),
    ),
  };
}
