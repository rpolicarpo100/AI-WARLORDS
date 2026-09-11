/**
 * M040 — AI assessment event producer (LAYER L3).
 *
 * First AI→stream channel (voted 2026-09-11): per-upgrade strategic
 * snapshots for every holder — 'ai.assessment' facts (priority low,
 * unit.moved mold; #33 DECISION BUDGET) carrying the full live
 * assessment plus per-commander stances. Upgrade is the rarest
 * strategic beat (49/1200 playtest, 0 drill) — bounded by construction.
 * Commission stance was cut (FACT: bare mints read always balanced);
 * flips/noop/build/move cut (noise); advance does not exist (D-034).
 *
 * Factory (producers receive no config): match.ts registers
 * createAiAssessmentProducer(this.unitsConfig) on UPGRADE_TRANSITION
 * (its first domain producer; riders behind, mold). The `as UnitType`
 * casts document the validated seam (M029 precedent): producer
 * after-states are re-guarded handler outputs (M006), and the warfare
 * lookups re-guard fail-loud.
 *
 * L3 over assessment/stance/warfare L2 + authority/units L0 +
 * world-state L1 (type-only). Producer types are structural inline
 * mirrors (commander-state mold — events.js sits at L3 too, L3↛L3).
 */
import { assessPlayer, type StatsOf } from './assessment.js';
import type { PlayerId } from './authority.js';
import { commandersOf } from './commanders.js';
import { stanceOf, type CommanderStance } from './stance.js';
import type { UnitType } from './units.js';
import { maxHpOf, unitDamageOf, type UnitsConfig } from './warfare.js';
import type { WorldState } from './world-state.js';

/** Structural mirror of ProducerInput (events.js L3↛L3). */
interface AiProducerInput {
  readonly type: string;
  readonly caller: PlayerId;
  readonly params: unknown;
  readonly before: WorldState;
  readonly after: WorldState;
}

/** Structural mirror of EventInput (priority pinned low). */
interface AiFact {
  readonly type: string;
  readonly priority: 'low';
  readonly payload: unknown;
}

export function createAiAssessmentProducer(
  unitsConfig: UnitsConfig,
): (input: AiProducerInput) => ReadonlyArray<AiFact> {
  const statsOf: StatsOf = (type: string) => ({
    damage: unitDamageOf(unitsConfig, type as UnitType),
    maxHp: maxHpOf(unitsConfig, type as UnitType),
  });
  return (input) => {
    const facts: AiFact[] = [];
    for (const player of input.after.players) {
      const holder = player.id;
      const assessment = assessPlayer(input.after, holder, statsOf);
      // No-commanders honesty WITHOUT undefined: event payloads must be
      // exactly JSON-serializable (freezeState rejects undefined) — the
      // key is omitted rather than nulled (M006 doctrine).
      const avg = assessment.commanders.avgEffective;
      const avgKey = avg === undefined ? {} : { avgEffective: avg };
      const stances: CommanderStance[] = commandersOf(input.after.commanders, holder).map(
        (record) => ({ id: record.id, stance: stanceOf(record) }),
      );
      facts.push({
        type: 'ai.assessment',
        priority: 'low',
        payload: {
          player: holder,
          military: assessment.military,
          economy: assessment.economy,
          commanders: {
            count: assessment.commanders.count,
            active: assessment.commanders.active,
            ...avgKey,
            stances,
          },
        },
      });
    }
    return facts;
  };
}
