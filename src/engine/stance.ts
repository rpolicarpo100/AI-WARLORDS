/**
 * M037 — Commander stance (LAYER L2).
 *
 * First AI DECISION over the personality substrate (#7): pure
 * commander → posture mapping from effective DNA (voted convention
 * 2026-09-11). The dominant trait among aggression/defense/expansion/
 * diplomacy wins when max − runner-up >= STANCE_MARGIN (15, voted);
 * otherwise the commander reads 'balanced' — exact ties resolve to
 * balanced deterministically by construction (diff 0 < 15).
 *
 * L2 over commanders/dna L0 + effective-dna L1 (first M035 consumer;
 * strictly downward). Total and pure. Zero wiring: consumers M038+.
 */
import { type CommanderRecord } from './commanders.js';
import { type DnaTraits } from './dna.js';
import { effectiveDnaOf } from './effective-dna.js';

/** Fixed-5 stance vocabulary (voted order). */
export const STANCE_IDS: readonly string[] = Object.freeze([
  'aggressive',
  'defensive',
  'expansionist',
  'diplomatic',
  'balanced',
]);

export type Stance = 'aggressive' | 'defensive' | 'expansionist' | 'diplomatic' | 'balanced';

/** Dominance margin (voted 2026-09-11): the winner must clear the runner-up by 15. */
export const STANCE_MARGIN = 15;

export function isStanceId(value: unknown): value is Stance {
  return typeof value === 'string' && STANCE_IDS.includes(value);
}

/** Posture of a commander (D-031, voted). Total: every record reads exactly one stance. */
export function stanceOf(record: CommanderRecord): Stance {
  const effective: DnaTraits = effectiveDnaOf(record);
  let best: Stance = 'aggressive';
  let bestValue = effective.aggression;
  let runnerValue = -1;
  const contenders: ReadonlyArray<readonly [Stance, number]> = [
    ['defensive', effective.defense],
    ['expansionist', effective.expansion],
    ['diplomatic', effective.diplomacy],
  ];
  for (const [stance, value] of contenders) {
    if (value > bestValue) {
      runnerValue = bestValue;
      best = stance;
      bestValue = value;
    } else if (value > runnerValue) {
      runnerValue = value;
    }
  }
  return bestValue - runnerValue >= STANCE_MARGIN ? best : 'balanced';
}
