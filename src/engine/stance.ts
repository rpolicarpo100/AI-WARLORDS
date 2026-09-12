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
 * M054 extends in-file (M050 precedent, no new pins): stanceWithRecall
 * nudges traits from validated recollection — recalled battles
 * (ours — sides-caller momentum) embolden aggression, recalled
 * failures (overridden/canceled self-correction) humble toward
 * defense. Memoryless records read stanceOf exactly.
 */
import { type CommanderMemory, type CommanderRecord } from './commanders.js';
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

/** M054: trait points per recalled battle/failure (tuning, pinned). */
export const STANCE_RECALL_NUDGE = 5;

/** M054: recalled memories counted per side (feedback-loop cap). */
export const STANCE_RECALL_CAP = 2;

/** M059: memory kinds that embolden (fresh battles; stance.ts canonical). */
export const STANCE_BATTLE_KINDS: readonly string[] = ['unit.attacked', 'unit.slain'];

/** M059: memory kinds that humble (fresh failures; stance.ts canonical). */
export const STANCE_FAILURE_KINDS: readonly string[] = ['order.overridden', 'order.canceled'];

export function isStanceId(value: unknown): value is Stance {
  return typeof value === 'string' && STANCE_IDS.includes(value);
}

/** Per-commander stance reading (M038 Match wiring shape). */
export interface CommanderStance {
  readonly id: string;
  readonly stance: Stance;
}

/**
 * M054 mirror of Recollection (memory-recall.ts canonical; L2↛L2:
 * deliberately not imported). Only `.fresh` steers stance — stale
 * memories never move posture (recall flags, stance ignores).
 */
export interface StanceRecollection {
  readonly fresh: readonly CommanderMemory[];
  readonly stale: readonly CommanderMemory[];
}

/** Posture of a commander (D-031, voted). Total: every record reads exactly one stance. */
export function stanceOf(record: CommanderRecord): Stance {
  return stanceFromTraits(effectiveDnaOf(record));
}

/** Margin logic over explicit traits (M054 extraction; stanceOf delegates). */
function stanceFromTraits(effective: DnaTraits): Stance {
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

/**
 * M054 — posture with experience: fresh battle memories embolden
 * (aggression +5 each, ours by sides-caller), fresh failures humble
 * (defense +5 each); both capped at two memories. Neutral kinds
 * (executed/spotted) and stale memories never move posture.
 * Memoryless records read stanceOf exactly.
 */
export function stanceWithRecall(
  record: CommanderRecord,
  recollection: StanceRecollection,
): Stance {
  // M056: player-ordered posture beats DNA + memory (precedence voted).
  const ordered = record.directives?.stance;
  if (ordered !== undefined) {
    return ordered;
  }
  let battles = 0;
  let failures = 0;
  for (const memory of recollection.fresh) {
    if (STANCE_BATTLE_KINDS.includes(memory.kind)) {
      battles += 1;
    } else if (STANCE_FAILURE_KINDS.includes(memory.kind)) {
      failures += 1;
    }
  }
  if (battles === 0 && failures === 0) {
    return stanceOf(record);
  }
  const effective = effectiveDnaOf(record);
  return stanceFromTraits({
    ...effective,
    aggression: effective.aggression + Math.min(battles, STANCE_RECALL_CAP) * STANCE_RECALL_NUDGE,
    defense: effective.defense + Math.min(failures, STANCE_RECALL_CAP) * STANCE_RECALL_NUDGE,
  });
}
