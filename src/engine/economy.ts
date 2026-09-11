/**
 * M016 — Resource economy: server configuration + pure stockpile ops.
 *
 * LAYER L2 (imports authority/buildings/city/map/rng/stockpiles, all downward). Config
 * lives OUTSIDE canonical state (mestre #84, M011 seam): validated here,
 * consumed by M017 (gatherYield) and future score (value, L-17). Ops are
 * exact: overflow and overdraft throw loud (never silent saturation —
 * hidden exploits); affordability checks fail soft (boolean).
 */

import { freezeState, type PlayerId, type TransitionHandler } from './authority.js';
import {
  BUILDING_IDS,
  BUILDINGS_SCHEMA_VERSION,
  countsOf,
  isBuildingId,
  isBuildingsData,
  type BuildingId,
  type BuildingsData,
} from './buildings.js';
import {
  CITIES_SCHEMA_VERSION,
  cityOf,
  type CitiesData,
  type CityState,
  type QueueItem,
} from './city.js';
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
import { unitsOf } from './units.js';

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

export function createGatherHandler(
  config: EconomyConfig,
  buildings?: BuildingsConfig,
): TransitionHandler<WorldState> {
  if (!isEconomyConfig(config)) {
    throw new Error('createGatherHandler: invalid economy config.');
  }
  const stores = buildings ?? DEFAULT_BUILDINGS_CONFIG;
  if (!isBuildingsConfig(stores)) {
    throw new Error('createGatherHandler: invalid buildings config.');
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
    // M022: L-32 CLOSED — only a worker standing on the node gathers.
    const crewed = unitsOf(ctx.state.units, ctx.caller).some(
      (unit) => unit.type === 'worker' && unit.col === col && unit.row === row,
    );
    if (!crewed) {
      return { applied: false, reason: 'gather: no worker here.' };
    }
    const taken = Math.min(config[node.type].gatherYield, node.amount);
    if (taken === 0) {
      return { applied: false, reason: 'gather: yield is zero.' };
    }
    // M020: storage caps close the D-011 gap (all-or-nothing; over-cap
    // piles refuse every take — the post-rule backstops the rest).
    const room =
      capOf(ctx.state.buildings, ctx.caller, stores) -
      stockpileOf(ctx.state.stockpiles, ctx.caller)[node.type];
    if (taken > room) {
      return { applied: false, reason: 'gather: storage full.' };
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

export function economyHandlers(
  config: EconomyConfig,
  buildings?: BuildingsConfig,
): Map<string, TransitionHandler<WorldState>> {
  return new Map([[GATHER_TRANSITION, createGatherHandler(config, buildings)]]);
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

/**
 * M018 — Buildings: configuration + cost/cap mechanics (building data
 * lives in buildings.js L0; config lives OUTSIDE canonical state like
 * EconomyConfig). Costs are partial (absent = zero); caps are derived
 * (base + storages x per — L-31); payments are atomic (payCost debits
 * all-or-nothing loud). No consumers yet (D-006 pattern): M019 build
 * transitions consume costOf/buildTimeOf/payCost/addBuilding; M020
 * enforces capOf.
 */

export interface BuildingTypeConfig {
  readonly cost: Cost;
  readonly buildTime: number;
}

export interface CapsConfig {
  readonly base: number;
  readonly perStorage: number;
}

export type BuildingsConfig = { readonly [type in BuildingId]: BuildingTypeConfig } & {
  readonly caps: CapsConfig;
};

function isCost(value: unknown): value is Cost {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  for (const [key, amount] of Object.entries(value)) {
    if (!isResourceType(key) || !isUint32(amount)) {
      return false;
    }
  }
  return true;
}

function isBuildingTypeConfig(value: unknown): value is BuildingTypeConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  return isCost(fields['cost']) && isUint32(fields['buildTime']);
}

function isCapsConfig(value: unknown): value is CapsConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  return isUint32(fields['base']) && isUint32(fields['perStorage']);
}

export function isBuildingsConfig(value: unknown): value is BuildingsConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  if (entries.length !== BUILDING_IDS.length + 1) {
    return false;
  }
  for (const [key, entry] of entries) {
    if (key === 'caps') {
      if (!isCapsConfig(entry)) {
        return false;
      }
    } else if (!isBuildingId(key) || !isBuildingTypeConfig(entry)) {
      return false;
    }
  }
  return true;
}

/**
 * Neutral default (M011/M016 analogy: mechanics exist, values untuned —
 * tuning belongs to playtesting). Costs empty (free), buildTime 0
 * (instant), caps uncapped (status quo preserved). Frozen.
 */
export const DEFAULT_BUILDINGS_CONFIG: BuildingsConfig = freezeState({
  'town-center': { cost: {}, buildTime: 0 },
  house: { cost: {}, buildTime: 0 },
  storage: { cost: {}, buildTime: 0 },
  barracks: { cost: {}, buildTime: 0 },
  wall: { cost: {}, buildTime: 0 },
  tower: { cost: {}, buildTime: 0 },
  caps: { base: MAX_UINT32, perStorage: 0 },
});

export function costOf(config: BuildingsConfig, type: BuildingId): Cost {
  if (!isBuildingsConfig(config)) {
    throw new Error('costOf: invalid buildings config.');
  }
  if (!isBuildingId(type)) {
    throw new Error('costOf: invalid building type.');
  }
  return readCost(config[type].cost, 'costOf');
}

export function buildTimeOf(config: BuildingsConfig, type: BuildingId): number {
  if (!isBuildingsConfig(config)) {
    throw new Error('buildTimeOf: invalid buildings config.');
  }
  if (!isBuildingId(type)) {
    throw new Error('buildTimeOf: invalid building type.');
  }
  return config[type].buildTime;
}

/** Resource kinds in debit order (first-short type names the failure). */
const COST_KINDS: readonly ResourceType[] = ['food', 'wood', 'stone', 'gold'];

export function payCost(data: StockpilesData, holder: PlayerId, cost: Cost): StockpilesData {
  if (!isStockpilesData(data)) {
    throw new Error('payCost: invalid stockpiles data.');
  }
  const price = readCost(cost, 'payCost');
  const held = stockpileOf(data, holder);
  for (const kind of COST_KINDS) {
    if (held[kind] < price[kind]) {
      throw new Error(`payCost: insufficient ${kind}.`);
    }
  }
  return freezeState({
    schemaVersion: STOCKPILES_SCHEMA_VERSION,
    stockpiles: {
      ...data.stockpiles,
      [holder]: {
        food: held.food - price.food,
        wood: held.wood - price.wood,
        stone: held.stone - price.stone,
        gold: held.gold - price.gold,
      },
    },
  });
}

function withCount(
  data: BuildingsData,
  holder: PlayerId,
  type: BuildingId,
  next: number,
): BuildingsData {
  const held = countsOf(data, holder);
  const updated: { [kind in BuildingId]: number } = { ...held, [type]: next };
  return freezeState({
    schemaVersion: BUILDINGS_SCHEMA_VERSION,
    buildings: { ...data.buildings, [holder]: updated },
  });
}

export function addBuilding(
  data: BuildingsData,
  holder: PlayerId,
  type: BuildingId,
): BuildingsData {
  if (!isBuildingsData(data)) {
    throw new Error('addBuilding: invalid buildings data.');
  }
  if (!isBuildingId(type)) {
    throw new Error('addBuilding: invalid building type.');
  }
  const next = countsOf(data, holder)[type] + 1;
  if (next > MAX_UINT32) {
    throw new Error('addBuilding: overflow.');
  }
  return withCount(data, holder, type, next);
}

export function capOf(
  data: BuildingsData | undefined,
  holder: PlayerId,
  config: BuildingsConfig,
): number {
  if (data !== undefined && !isBuildingsData(data)) {
    throw new Error('capOf: invalid buildings data.');
  }
  if (!isBuildingsConfig(config)) {
    throw new Error('capOf: invalid buildings config.');
  }
  const storages = countsOf(data, holder).storage;
  const cap = config.caps.base + storages * config.caps.perStorage;
  if (!isUint32(cap)) {
    throw new Error('capOf: overflow.');
  }
  return cap;
}

/**
 * M019 — City System: construction + progression (city data lives in
 * city.js L0; build costs/times come from BuildingsConfig). Builds are
 * prepaid at enqueue and complete on time (completeConstructions runs
 * inside match.advance — time owns progress). Upgrades are free
 * (costs/effects ungrounded — neutral). Wired by match.ts (seam).
 */

/** Transition names (single source — match.ts wires them, tests dispatch them). */
export const BUILD_TRANSITION = 'city.build';
export const UPGRADE_TRANSITION = 'city.upgrade';

/** Validated build parameters: which building to construct. */
export interface BuildParams {
  readonly type: string;
}

/** Wire-shape pre-rule (game rules live in the handler, not here). */
export function buildParamsRule(
  _caller: PlayerId,
  params: unknown,
): { readonly rule: string; readonly detail: string } | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return { rule: 'build-params', detail: 'build takes { type }' };
  }
  const fields = params as Record<string, unknown>;
  if (typeof fields['type'] !== 'string') {
    return { rule: 'build-params', detail: 'build takes a string type' };
  }
  return null;
}

export function createBuildHandler(config: BuildingsConfig): TransitionHandler<WorldState> {
  if (!isBuildingsConfig(config)) {
    throw new Error('createBuildHandler: invalid buildings config.');
  }
  return (ctx) => {
    // The pre-rule validated a { type } string on the dispatch path;
    // this cast documents the seam (match.ts `validated` precedent).
    const { type } = ctx.params as BuildParams;
    if (!isBuildingId(type)) {
      return { applied: false, reason: 'build: unknown building.' };
    }
    const cost = costOf(config, type);
    const funds: StockpilesData = ctx.state.stockpiles ?? {
      schemaVersion: STOCKPILES_SCHEMA_VERSION,
      stockpiles: {},
    };
    if (!canAfford(funds, ctx.caller, cost)) {
      return { applied: false, reason: 'build: cannot afford.' };
    }
    const paid = payCost(funds, ctx.caller, cost);
    const time = buildTimeOf(config, type);
    const city = cityOf(ctx.state.cities, ctx.caller);
    const known = ctx.state.cities?.cities ?? {};
    const cities: CitiesData = {
      schemaVersion: CITIES_SCHEMA_VERSION,
      cities: {
        ...known,
        [ctx.caller]: { level: city.level, queue: [...city.queue, { type, remaining: time }] },
      },
    };
    return {
      applied: true,
      state: { ...ctx.state, cities, stockpiles: paid },
      summary: `started ${type} (${time} ticks)`,
    };
  };
}

export function createUpgradeHandler(): TransitionHandler<WorldState> {
  return (ctx) => {
    const city = cityOf(ctx.state.cities, ctx.caller);
    if (city.level >= 3) {
      return { applied: false, reason: 'upgrade: already max level.' };
    }
    const level = city.level === 1 ? 2 : 3;
    const known = ctx.state.cities?.cities ?? {};
    const cities: CitiesData = {
      schemaVersion: CITIES_SCHEMA_VERSION,
      cities: { ...known, [ctx.caller]: { level, queue: city.queue } },
    };
    return {
      applied: true,
      state: { ...ctx.state, cities },
      summary: `upgraded to level ${level}`,
    };
  };
}

export function cityHandlers(config: BuildingsConfig): Map<string, TransitionHandler<WorldState>> {
  return new Map([
    [BUILD_TRANSITION, createBuildHandler(config)],
    [UPGRADE_TRANSITION, createUpgradeHandler()],
  ]);
}

export interface CompletedBuilding {
  readonly holder: string;
  readonly type: BuildingId;
}

export function completeConstructions(
  cities: CitiesData,
  buildings: BuildingsData | undefined,
): { readonly cities: CitiesData; readonly buildings: BuildingsData | undefined } {
  const next: { [holder: string]: CityState } = {};
  const done: CompletedBuilding[] = [];
  for (const [holder, city] of Object.entries(cities.cities)) {
    const queue: QueueItem[] = [];
    for (const item of city.queue) {
      const remaining = item.remaining - 1;
      if (remaining <= 0) {
        done.push({ holder, type: item.type });
      } else {
        queue.push({ type: item.type, remaining });
      }
    }
    next[holder] = { level: city.level, queue };
  }
  let raised: BuildingsData | undefined = buildings;
  for (const item of done) {
    const base = raised ?? { schemaVersion: BUILDINGS_SCHEMA_VERSION, buildings: {} };
    raised = addBuilding(base, item.holder as PlayerId, item.type);
  }
  return { cities: { schemaVersion: CITIES_SCHEMA_VERSION, cities: next }, buildings: raised };
}

/** Structural EventProducer: build.started from validated params. */
export function buildStartedProducer(input: {
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
    throw new Error('buildStartedProducer: invalid params.');
  }
  const fields = input.params as Record<string, unknown>;
  if (typeof fields['type'] !== 'string') {
    throw new Error('buildStartedProducer: invalid params.');
  }
  return [
    {
      type: 'build.started',
      priority: 'normal',
      payload: { player: input.caller, building: fields['type'] },
    },
  ];
}

/**
 * Structural EventProducer: build.completed facts from counts-diff
 * (completions are the only counts writer — exact; holders sorted +
 * BUILDING_IDS order keep facts deterministic).
 */
export function completionProducer(input: {
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
  const facts: Array<{
    readonly type: string;
    readonly priority: 'normal';
    readonly payload: unknown;
  }> = [];
  const before = input.before.buildings?.buildings ?? {};
  const after = input.after.buildings?.buildings ?? {};
  const holders = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const holder of holders) {
    const was = countsOf(input.before.buildings, holder);
    const now = countsOf(input.after.buildings, holder);
    for (const id of BUILDING_IDS) {
      const type = id as BuildingId;
      const completed = now[type] - was[type];
      for (let i = 0; i < completed; i += 1) {
        facts.push({
          type: 'build.completed',
          priority: 'normal',
          payload: { player: holder, building: type },
        });
      }
    }
  }
  return facts;
}

/**
 * M020 — Economy Validation: the 6th post-rule (caps + conservation).
 *
 * Structural post-rule (no validation import — L2→L2 edges are forbidden
 * even for types; assignability is proven where match.ts appends this to
 * `post`). Assume-shape: the shape gate runs first (rosterRule precedent),
 * so sections are read directly. Caps first (after-coherence), then
 * conservation (flow-coherence); first violation wins (deterministic).
 */
export function createEconomyRule(
  buildings: BuildingsConfig,
): (
  before: WorldState,
  after: WorldState,
) => { readonly rule: string; readonly detail: string } | null {
  if (!isBuildingsConfig(buildings)) {
    throw new Error('createEconomyRule: invalid buildings config.');
  }
  return (before, after) => {
    const piles = after.stockpiles;
    if (piles !== undefined) {
      for (const holder of Object.keys(piles.stockpiles).sort()) {
        const cap = capOf(after.buildings, holder as PlayerId, buildings);
        const pile = stockpileOf(piles, holder);
        for (const id of RESOURCE_TYPES) {
          const type = id as ResourceType;
          if (pile[type] > cap) {
            return {
              rule: 'economy-cap',
              detail: `${holder}.${type} ${pile[type]} exceeds cap ${cap}`,
            };
          }
        }
      }
    }
    for (const id of RESOURCE_TYPES) {
      const type = id as ResourceType;
      const was = economyTotal(before, type);
      const now = economyTotal(after, type);
      if (now > was) {
        return { rule: 'economy-conservation', detail: `${type} ${was} -> ${now}` };
      }
    }
    return null;
  };
}

/** Total units of a type across stockpiles + map nodes (exact; size-capped). */
function economyTotal(state: WorldState, type: ResourceType): number {
  let total = 0;
  const piles = state.stockpiles;
  if (piles !== undefined) {
    for (const holder of Object.keys(piles.stockpiles)) {
      total += stockpileOf(piles, holder)[type];
    }
  }
  const map = state.map;
  if (map !== undefined) {
    for (const cell of map.cells) {
      const node = cell.resource;
      if (node !== undefined && node.type === type) {
        total += node.amount;
      }
    }
  }
  return total;
}
