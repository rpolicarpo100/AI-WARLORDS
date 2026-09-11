/**
 * M016 — Resource economy: server configuration + pure stockpile ops.
 *
 * LAYER L2 (imports authority/map/rng/stockpiles, all downward). Config
 * lives OUTSIDE canonical state (mestre #84, M011 seam): validated here,
 * consumed by M017 (gatherYield) and future score (value, L-17). Ops are
 * exact: overflow and overdraft throw loud (never silent saturation —
 * hidden exploits); affordability checks fail soft (boolean).
 */

import { freezeState, type PlayerId } from './authority.js';
import { isResourceType, RESOURCE_TYPES, type ResourceType } from './map.js';
import { MAX_UINT32 } from './rng.js';
import {
  isStockpilesData,
  stockpileOf,
  STOCKPILES_SCHEMA_VERSION,
  type StockpilesData,
  type StockpileType,
} from './stockpiles.js';

export interface EconomyRates {
  readonly value: number;
  readonly gatherYield: number;
}

export type EconomyConfig = { readonly [type in ResourceType]: EconomyRates };

/** A price: per-type uint32 amounts (partial — absent means zero). */
export type Cost = { readonly [type in ResourceType]?: number };

function isUint32(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_UINT32;
}

function isRates(value: unknown): value is EconomyRates {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const rates = value as Record<string, unknown>;
  return isUint32(rates['value']) && isUint32(rates['gatherYield']);
}

export function isEconomyConfig(value: unknown): value is EconomyConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  if (entries.length !== RESOURCE_TYPES.length) {
    return false;
  }
  for (const [key, rates] of entries) {
    if (!isResourceType(key) || !isRates(rates)) {
      return false;
    }
  }
  return true;
}

/**
 * Neutral default (M011 analogy: only master-dictated deviations, and the
 * master dictates none — tuning belongs to #92/playtesting). Frozen.
 */
export const DEFAULT_ECONOMY_CONFIG: EconomyConfig = freezeState({
  food: { value: 1, gatherYield: 1 },
  wood: { value: 1, gatherYield: 1 },
  stone: { value: 1, gatherYield: 1 },
  gold: { value: 1, gatherYield: 1 },
});

function readAmount(value: unknown, op: string): number {
  const amount = value ?? 0;
  if (!isUint32(amount)) {
    throw new Error(`${op}: invalid cost.`);
  }
  return amount;
}

function readCost(cost: unknown, op: string): Record<ResourceType, number> {
  if (typeof cost !== 'object' || cost === null || Array.isArray(cost)) {
    throw new Error(`${op}: invalid cost.`);
  }
  const entries = cost as Record<string, unknown>;
  return {
    food: readAmount(entries['food'], op),
    wood: readAmount(entries['wood'], op),
    stone: readAmount(entries['stone'], op),
    gold: readAmount(entries['gold'], op),
  };
}

function withHolder(
  data: StockpilesData,
  holder: PlayerId,
  type: StockpileType,
  next: number,
): StockpilesData {
  const held = stockpileOf(data, holder);
  const updated: { [kind in StockpileType]: number } = { ...held, [type]: next };
  return freezeState({
    schemaVersion: STOCKPILES_SCHEMA_VERSION,
    stockpiles: { ...data.stockpiles, [holder]: updated },
  });
}

export function credit(
  data: StockpilesData,
  holder: PlayerId,
  type: ResourceType,
  amount: number,
): StockpilesData {
  if (!isStockpilesData(data)) {
    throw new Error('credit: invalid stockpiles data.');
  }
  if (!isResourceType(type)) {
    throw new Error('credit: invalid resource type.');
  }
  if (!isUint32(amount)) {
    throw new Error('credit: invalid amount.');
  }
  const next = stockpileOf(data, holder)[type] + amount;
  if (next > MAX_UINT32) {
    throw new Error('credit: overflow.');
  }
  return withHolder(data, holder, type, next);
}

export function debit(
  data: StockpilesData,
  holder: PlayerId,
  type: ResourceType,
  amount: number,
): StockpilesData {
  if (!isStockpilesData(data)) {
    throw new Error('debit: invalid stockpiles data.');
  }
  if (!isResourceType(type)) {
    throw new Error('debit: invalid resource type.');
  }
  if (!isUint32(amount)) {
    throw new Error('debit: invalid amount.');
  }
  const held = stockpileOf(data, holder)[type];
  if (held < amount) {
    throw new Error(`debit: insufficient ${type}.`);
  }
  return withHolder(data, holder, type, held - amount);
}

export function canAfford(data: StockpilesData, holder: PlayerId, cost: Cost): boolean {
  if (!isStockpilesData(data)) {
    throw new Error('canAfford: invalid stockpiles data.');
  }
  const price = readCost(cost, 'canAfford');
  const held = stockpileOf(data, holder);
  return (
    held.food >= price.food &&
    held.wood >= price.wood &&
    held.stone >= price.stone &&
    held.gold >= price.gold
  );
}
