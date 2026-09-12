/**
 * M095 — Match mode data (LEAF L0, zero imports).
 *
 * standard: prompt budgets enforced (D-022); exhaustion ends matches.
 * free: endless sandbox — no budget seeded, no spend, no ledger, no
 * exhaustion (D-090; the unlimited design D-022 deferred to M09X).
 * Mode lives on Match, never in canonical state (no seal churn).
 */

export const MATCH_MODES = ['standard', 'free'] as const;

export type MatchMode = (typeof MATCH_MODES)[number];

export const DEFAULT_MATCH_MODE: MatchMode = 'standard';

export function isMatchMode(value: unknown): value is MatchMode {
  return value === 'standard' || value === 'free';
}
