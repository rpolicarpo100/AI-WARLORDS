/**
 * M079 — Elo ratings (LAYER L0, pure math).
 *
 * First ratings of the Competitive arc (D-073): eloPair runs one
 * standard Elo exchange (v1, K supplied by the caller — no tuned
 * constants in the engine) and scoreOf reads a finished outcome as
 * an Elo score (structural outcome seam, never victory.ts — Elo
 * semantics stay in one file, layers stay trivial). Draws split
 * the point; the point conserved up to independent rounding.
 * Server-only today (transport rates finished closes).
 * LAYER L0 (standalone, downward-vacuous — the rng mold).
 */

/** Finished-outcome shape as Elo sees it (kind + optional crown). */
export interface EloOutcome {
  readonly kind: 'win' | 'draw';
  readonly winner?: string;
}

/** Reads a finished outcome as player-side Elo score (1 / 0.5 / 0). */
export function scoreOf(outcome: EloOutcome, player: string): 0 | 0.5 | 1 {
  if (outcome.kind === 'draw') {
    return 0.5;
  }
  return outcome.winner === player ? 1 : 0;
}

/** One standard Elo exchange (rounded integers, K caller-supplied). */
export function eloPair(
  ra: number,
  rb: number,
  scoreA: 0 | 0.5 | 1,
  k: number,
): { readonly a: number; readonly b: number } {
  const expectedA = 1 / (1 + 10 ** ((rb - ra) / 400));
  return {
    a: Math.round(ra + k * (scoreA - expectedA)),
    b: Math.round(rb + k * (1 - scoreA - (1 - expectedA))),
  };
}
