/**
 * M036 — Player strategic assessment (LAYER L2).
 *
 * First STRATEGIC ENGINE brick (voted 2026-09-11): pure per-holder
 * assessment over engine facts + effective DNA. Counts, sums, and exact
 * means only — no weights, no scalars, no rounding (D-030: those need a
 * voted convention, FUTURO). Unit stats arrive INJECTED (M022 mold —
 * importing warfare L2 would break strictly-downward); unknown unit
 * types contribute hp but zero damage (fail-soft, M015).
 *
 * L2 over L0 getters (commanders/units/stockpiles/buildings/city) +
 * effective-dna L1 + world-state L1 (type-only). Zero wiring:
 * consumers arrive M037+.
 */
import { commandersOf } from './commanders.js';
import { countsOf, type BuildingCounts } from './buildings.js';
import { cityOf } from './city.js';
import { type DnaTraits } from './dna.js';
import { effectiveDnaOf } from './effective-dna.js';
import { stockpileOf, type StockpileAmounts } from './stockpiles.js';
import { unitsOf } from './units.js';
import type { WorldState } from './world-state.js';

/** Injected unit stats (rules live with the caller, never invented here). */
export interface UnitStats {
  readonly damage: number;
  readonly maxHp: number;
}

export type StatsOf = (type: string) => UnitStats | undefined;

export interface MilitaryAssessment {
  readonly units: number;
  readonly totalHp: number;
  readonly totalDamage: number;
}

export interface EconomyAssessment {
  readonly stockpile: StockpileAmounts;
  readonly buildings: BuildingCounts;
  readonly cityLevel: number;
}

/**
 * Exact per-trait mean of effective DNA (floats — deliberately NOT
 * DnaTraits; conformance is the bounds battery, M033 deltas mold).
 */
export interface AverageDna {
  readonly aggression: number;
  readonly defense: number;
  readonly economy: number;
  readonly exploration: number;
  readonly risk: number;
  readonly expansion: number;
  readonly diplomacy: number;
  readonly patience: number;
  readonly greed: number;
  readonly adaptability: number;
}

export interface CommandAssessment {
  readonly count: number;
  readonly active: number;
  readonly avgEffective: AverageDna | undefined;
}

export interface PlayerAssessment {
  readonly military: MilitaryAssessment;
  readonly economy: EconomyAssessment;
  readonly commanders: CommandAssessment;
}

/** Exact mean (caller guarantees non-empty — division is total here). */
function averageOf(values: ReadonlyArray<DnaTraits>): AverageDna {
  const count = values.length;
  const sum = {
    aggression: 0,
    defense: 0,
    economy: 0,
    exploration: 0,
    risk: 0,
    expansion: 0,
    diplomacy: 0,
    patience: 0,
    greed: 0,
    adaptability: 0,
  };
  for (const value of values) {
    sum.aggression += value.aggression;
    sum.defense += value.defense;
    sum.economy += value.economy;
    sum.exploration += value.exploration;
    sum.risk += value.risk;
    sum.expansion += value.expansion;
    sum.diplomacy += value.diplomacy;
    sum.patience += value.patience;
    sum.greed += value.greed;
    sum.adaptability += value.adaptability;
  }
  return {
    aggression: sum.aggression / count,
    defense: sum.defense / count,
    economy: sum.economy / count,
    exploration: sum.exploration / count,
    risk: sum.risk / count,
    expansion: sum.expansion / count,
    diplomacy: sum.diplomacy / count,
    patience: sum.patience / count,
    greed: sum.greed / count,
    adaptability: sum.adaptability / count,
  };
}

/**
 * Strategic assessment of one holder (D-030, voted). Total: absent
 * slots resolve via the fail-soft L0 getters (zeros, virtual city).
 */
export function assessPlayer(
  state: WorldState,
  holder: string,
  statsOf: StatsOf,
): PlayerAssessment {
  const owned = unitsOf(state.units, holder);
  let totalHp = 0;
  let totalDamage = 0;
  for (const unit of owned) {
    totalHp += unit.hp;
    totalDamage += statsOf(unit.type)?.damage ?? 0;
  }
  const commanders = commandersOf(state.commanders, holder);
  const vectors = commanders.map((record) => effectiveDnaOf(record));
  return {
    military: { units: owned.length, totalHp, totalDamage },
    economy: {
      stockpile: stockpileOf(state.stockpiles, holder),
      buildings: countsOf(state.buildings, holder),
      cityLevel: cityOf(state.cities, holder).level,
    },
    commanders: {
      count: commanders.length,
      active: commanders.filter((record) => record.active).length,
      avgEffective: vectors.length === 0 ? undefined : averageOf(vectors),
    },
  };
}
