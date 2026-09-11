/**
 * M016 — Resource economy: server configuration + pure stockpile ops.
 *
 * LAYER L2 (imports authority/map/rng/stockpiles, all downward). Config
 * lives OUTSIDE canonical state (mestre #84, M011 seam): validated here,
 * consumed by M017 (gatherYield) and future score (value, L-17). Ops are
 * exact: overflow and overdraft throw loud (never silent saturation —
 * hidden exploits); affordability checks fail soft (boolean).
 */

import { freezeState, type PlayerId, type TransitionHandler } from './authority.js';
import { cellAt, isResourceType, RESOURCE_TYPES, type ResourceType } from './map.js';
import { MAX_UINT32 } from './rng.js';
import {
  isStockpilesData,
  stockpileOf,
  STOCKPILES_SCHEMA_VERSION,
  type StockpilesData,
  type StockpileType,
} from './stockpiles.js';
import type { WorldState } from './world-state.js';

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

/**
 * M017 — Gathering: the first producer (node → stockpile depletion).
 *
 * Structural types throughout (no validation/events imports — L2→L2
 * edges are forbidden even for types; assignability is proven where
 * match.ts wires these into its RngHandler/EventProducer maps).
 */

/** Transition name (single source — match.ts wires it, tests dispatch it). */
export const GATHER_TRANSITION = 'economy.gather';

/** Validated gather parameters: a map cell in offset coordinates. */
export interface GatherParams {
  readonly col: number;
  readonly row: number;
}

/** Wire-shape pre-rule (game rules live in the handler, not here). */
export function gatherParamsRule(
  _caller: PlayerId,
  params: unknown,
): { readonly rule: string; readonly detail: string } | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return { rule: 'gather-params', detail: 'gather takes { col, row }' };
  }
  const fields = params as Record<string, unknown>;
  if (!isUint32(fields['col']) || !isUint32(fields['row'])) {
    return { rule: 'gather-params', detail: 'gather takes { col, row } uint32' };
  }
  return null;
}

export function createGatherHandler(config: EconomyConfig): TransitionHandler<WorldState> {
  if (!isEconomyConfig(config)) {
    throw new Error('createGatherHandler: invalid economy config.');
  }
  return (ctx) => {
    // The pre-rule validated { col, row } uints on the dispatch path;
    // this cast documents the seam (match.ts `validated` precedent).
    const { col, row } = ctx.params as GatherParams;
    const map = ctx.state.map;
    if (map === undefined) {
      return { applied: false, reason: 'gather: no map.' };
    }
    const target = map.cells.find((cell) => cell.col === col && cell.row === row);
    if (target === undefined) {
      return { applied: false, reason: 'gather: out of bounds.' };
    }
    const node = target.resource;
    if (node === undefined) {
      return { applied: false, reason: 'gather: no node here.' };
    }
    if (node.amount === 0) {
      return { applied: false, reason: 'gather: node depleted.' };
    }
    const taken = Math.min(config[node.type].gatherYield, node.amount);
    if (taken === 0) {
      return { applied: false, reason: 'gather: yield is zero.' };
    }
    const cells = map.cells.map((cell) =>
      cell === target
        ? { ...cell, resource: { type: node.type, amount: node.amount - taken } }
        : cell,
    );
    const base: StockpilesData = ctx.state.stockpiles ?? {
      schemaVersion: STOCKPILES_SCHEMA_VERSION,
      stockpiles: {},
    };
    const stockpiles = credit(base, ctx.caller, node.type, taken);
    return {
      applied: true,
      state: { ...ctx.state, map: { ...map, cells }, stockpiles },
      summary: `gathered ${taken} ${node.type} at ${col},${row}`,
    };
  };
}

export function economyHandlers(config: EconomyConfig): Map<string, TransitionHandler<WorldState>> {
  return new Map([[GATHER_TRANSITION, createGatherHandler(config)]]);
}

/** Structural EventProducer (assignability proven at the match.ts seam). */
export function gatherProducer(input: {
  readonly type: string;
  readonly caller: PlayerId;
  readonly params: unknown;
  readonly before: WorldState;
  readonly after: WorldState;
}): ReadonlyArray<{
  readonly type: string;
  readonly priority: 'normal';
  readonly payload: unknown;
}> {
  if (typeof input.params !== 'object' || input.params === null) {
    throw new Error('gatherProducer: invalid params.');
  }
  const fields = input.params as Record<string, unknown>;
  const col = fields['col'];
  const row = fields['row'];
  if (!isUint32(col) || !isUint32(row)) {
    throw new Error('gatherProducer: invalid params.');
  }
  const beforeMap = input.before.map;
  const afterMap = input.after.map;
  if (beforeMap === undefined || afterMap === undefined) {
    throw new Error('gatherProducer: map missing.');
  }
  const was = cellAt(beforeMap, col, row)?.resource;
  const now = cellAt(afterMap, col, row)?.resource;
  if (was === undefined || now === undefined) {
    throw new Error('gatherProducer: node missing.');
  }
  return [
    {
      type: 'resource.gathered',
      priority: 'normal',
      payload: {
        player: input.caller,
        col,
        row,
        resource: was.type,
        amount: was.amount - now.amount,
      },
    },
  ];
}
