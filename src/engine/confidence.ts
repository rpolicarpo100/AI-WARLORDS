/**
 * M048 — Confidence engine: reason evaluators + composite score
 * (LAYER L2, read-only).
 *
 * The M046 reasons become executable (D-042, voted reason-eval):
 * confidenceOfOrder tests one queued order against live state and
 * reports which challenge reasons fire plus a composite score
 * (100 − 20 per failure, floored at 0 — flat, documented, tunable
 * later). Evaluation order is the canonical REFUTATION_REASONS order,
 * so `failed` is deterministic. Every evaluator ABSTAINS on malformed
 * input (missing units/cells/params): validity belongs to the engine
 * (fail-closed there); confidence only prices well-formed orders.
 * Suicidal is a documented heuristic (stance M037 precedent): the
 * engine never retaliates, so the evaluator prices the foe's NEXT
 * turn (net zero damage, or attacker hp within one enemy hit).
 * LAYER L2 (imports commanders/map/refutations/units L0 +
 * world-state L1 type-only, all downward; economy/warfare/terrain
 * stay behind injected ConfidenceRules — L2↛L2, warfareHandlers
 * precedent).
 */

import type { CommanderOrder, CommanderRecord } from './commanders.js';
import { cellAt, neighborsOf, type MapData, type ResourceType } from './map.js';
import type { RefutationReason } from './refutations.js';
import type { UnitInstance } from './units.js';
import type { WorldState } from './world-state.js';

/** Structural twin of Cost/UnitCost (economy/warfare L2↛L2: deliberately not imported). */
export type ConfidenceCost = { readonly [type in ResourceType]?: number };

/** Structural twin of UnitTypeConfig (warfare L2↛L2: deliberately not imported). */
export interface ConfidenceUnitStats {
  readonly damage: number;
  readonly maxHp: number;
  readonly cost: ConfidenceCost;
}

/** Live engine truth, injected (Match adapts its validated configs). */
export interface ConfidenceRules {
  readonly unitStatsOf: (type: string) => ConfidenceUnitStats | undefined;
  readonly buildCostOf: (type: string) => ConfidenceCost | undefined;
  readonly passable: (terrain: string) => boolean;
  readonly defenseOf: (terrain: string) => number;
  readonly canAfford: (holder: string, cost: ConfidenceCost) => boolean;
}

/** Verdict on one queued order: which reasons fire, and the score. */
export interface OrderConfidence {
  readonly orderIndex: number;
  readonly kind: string;
  readonly score: number;
  readonly failed: readonly RefutationReason[];
}

const SCORE_START = 100;
const SCORE_STEP = 20;

function readInt(params: { readonly [key: string]: unknown }, key: string): number | undefined {
  const value = params[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function readString(params: { readonly [key: string]: unknown }, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
}

function findUnit(state: WorldState, id: string): UnitInstance | undefined {
  return state.units?.units.find((unit) => unit.id === id);
}

function isBlocked(order: CommanderOrder, state: WorldState, rules: ConfidenceRules): boolean {
  if (order.kind !== 'unit.move') {
    return false;
  }
  const params = order.params;
  if (params === undefined) {
    return false;
  }
  const col = readInt(params, 'col');
  const row = readInt(params, 'row');
  const map = state.map;
  if (col === undefined || row === undefined || map === undefined) {
    return false;
  }
  const cell = cellAt(map, col, row);
  if (cell === undefined) {
    return false;
  }
  return !rules.passable(cell.terrain);
}

interface AttackPair {
  readonly attacker: UnitInstance;
  readonly foe: UnitInstance;
  readonly map: MapData;
}

function attackPair(order: CommanderOrder, state: WorldState): AttackPair | undefined {
  const params = order.params;
  if (params === undefined) {
    return undefined;
  }
  const id = readString(params, 'id');
  const target = readString(params, 'target');
  if (id === undefined || target === undefined) {
    return undefined;
  }
  const attacker = findUnit(state, id);
  const foe = findUnit(state, target);
  const map = state.map;
  if (attacker === undefined || foe === undefined || map === undefined) {
    return undefined;
  }
  return { attacker, foe, map };
}

function isOutOfRange(order: CommanderOrder, state: WorldState): boolean {
  if (order.kind === 'unit.move') {
    const params = order.params;
    if (params === undefined) {
      return false;
    }
    const id = readString(params, 'id');
    if (id === undefined) {
      return false;
    }
    const unit = findUnit(state, id);
    const map = state.map;
    if (unit === undefined || map === undefined) {
      return false;
    }
    const col = readInt(params, 'col');
    const row = readInt(params, 'row');
    if (col === undefined || row === undefined) {
      return false;
    }
    return !neighborsOf(map, unit.col, unit.row).some(
      (cell) => cell.col === col && cell.row === row,
    );
  }
  if (order.kind !== 'unit.attack') {
    return false;
  }
  const pair = attackPair(order, state);
  if (pair === undefined) {
    return false;
  }
  return !neighborsOf(pair.map, pair.attacker.col, pair.attacker.row).some(
    (cell) => cell.col === pair.foe.col && cell.row === pair.foe.row,
  );
}

function isRedundant(order: CommanderOrder, state: WorldState): boolean {
  if (order.kind === 'unit.move') {
    const params = order.params;
    if (params === undefined) {
      return false;
    }
    const id = readString(params, 'id');
    if (id === undefined) {
      return false;
    }
    const unit = findUnit(state, id);
    if (unit === undefined) {
      return false;
    }
    const col = readInt(params, 'col');
    const row = readInt(params, 'row');
    if (col === undefined || row === undefined) {
      return false;
    }
    return unit.col === col && unit.row === row;
  }
  if (order.kind !== 'economy.gather') {
    return false;
  }
  const params = order.params;
  if (params === undefined) {
    return false;
  }
  const col = readInt(params, 'col');
  const row = readInt(params, 'row');
  const map = state.map;
  if (col === undefined || row === undefined || map === undefined) {
    return false;
  }
  const cell = cellAt(map, col, row);
  if (cell === undefined) {
    return false;
  }
  return (cell.resource?.amount ?? 0) === 0;
}

function isSuicidal(order: CommanderOrder, state: WorldState, rules: ConfidenceRules): boolean {
  if (order.kind !== 'unit.attack') {
    return false;
  }
  const pair = attackPair(order, state);
  if (pair === undefined) {
    return false;
  }
  const statsOf = rules.unitStatsOf(pair.attacker.type);
  const statsFoe = rules.unitStatsOf(pair.foe.type);
  if (statsOf === undefined || statsFoe === undefined) {
    return false;
  }
  const cellOf = cellAt(pair.map, pair.attacker.col, pair.attacker.row);
  const cellFoe = cellAt(pair.map, pair.foe.col, pair.foe.row);
  if (cellOf === undefined || cellFoe === undefined) {
    return false;
  }
  const netToFoe = Math.max(0, statsOf.damage - rules.defenseOf(cellFoe.terrain));
  const netToSelf = Math.max(0, statsFoe.damage - rules.defenseOf(cellOf.terrain));
  return netToFoe === 0 || pair.attacker.hp <= netToSelf;
}

function isUnaffordable(order: CommanderOrder, owner: string, rules: ConfidenceRules): boolean {
  if (order.kind !== 'unit.train' && order.kind !== 'city.build') {
    return false;
  }
  const params = order.params;
  if (params === undefined) {
    return false;
  }
  const type = readString(params, 'type');
  if (type === undefined) {
    return false;
  }
  const cost =
    order.kind === 'unit.train' ? rules.unitStatsOf(type)?.cost : rules.buildCostOf(type);
  if (cost === undefined) {
    return false;
  }
  return !rules.canAfford(owner, cost);
}

/**
 * Verdict on one queued order (fail-soft: missing record/queue/order
 * yields undefined — queries never throw). Reasons evaluate in
 * canonical order; score floors at zero.
 */
export function confidenceOfOrder(
  record: CommanderRecord | undefined,
  orderIndex: number,
  state: WorldState,
  rules: ConfidenceRules,
): OrderConfidence | undefined {
  if (record === undefined) {
    return undefined;
  }
  const order = (record.orders ?? [])[orderIndex];
  if (order === undefined) {
    return undefined;
  }
  const failed: RefutationReason[] = [];
  if (isBlocked(order, state, rules)) {
    failed.push('blocked');
  }
  if (isOutOfRange(order, state)) {
    failed.push('out-of-range');
  }
  if (isRedundant(order, state)) {
    failed.push('redundant');
  }
  if (isSuicidal(order, state, rules)) {
    failed.push('suicidal');
  }
  if (isUnaffordable(order, record.owner, rules)) {
    failed.push('unaffordable');
  }
  return {
    orderIndex,
    kind: order.kind,
    score: Math.max(0, SCORE_START - SCORE_STEP * failed.length),
    failed,
  };
}
