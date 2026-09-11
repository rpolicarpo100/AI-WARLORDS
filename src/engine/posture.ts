/**
 * M039 — Army posture aggregation (LAYER L3).
 *
 * First M037 consumer (voted 2026-09-11): pure aggregation of
 * per-commander stances into an army posture — distribution counts plus
 * the majority stance (argmax with STANCE_IDS-order tie-break, voted in
 * scope). An empty army reads zeros + 'balanced' (bare-record parallel:
 * no dominance without commanders). Zero constants, fully deterministic.
 *
 * L3 over stance L2 + commanders L0 (strictly downward — L2 cannot hold
 * a stance importer). The `as Stance` casts document the authoritative
 * fixed-5 IDS seam (voted vocabulary; M029 precedent).
 */
import { type CommanderRecord } from './commanders.js';
import { STANCE_IDS, stanceOf, type Stance } from './stance.js';

export interface ArmyPosture {
  readonly distribution: Record<Stance, number>;
  readonly majority: Stance;
}

/** Army posture of a commander set (D-033, voted). Total and pure. */
export function postureOf(records: ReadonlyArray<CommanderRecord>): ArmyPosture {
  const distribution: Record<Stance, number> = {
    aggressive: 0,
    defensive: 0,
    expansionist: 0,
    diplomatic: 0,
    balanced: 0,
  };
  for (const record of records) {
    distribution[stanceOf(record)] += 1;
  }
  let majority: Stance = 'balanced';
  let best = 0;
  for (const id of STANCE_IDS) {
    const count = distribution[id as Stance];
    if (count > best) {
      best = count;
      majority = id as Stance;
    }
  }
  return { distribution, majority };
}
