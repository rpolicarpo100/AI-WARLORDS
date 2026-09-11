/**
 * M021 — Military domain logic (LAYER L2: imports authority/map/rng/units,
 * all downward). Unit config (master #83: UNIT COST/HP/DAMAGE) + spawn
 * mechanics. No transitions (M022+ owns movement/combat/damage/army
 * dispatches); no Match seam (D-006 config-without-consumers, M018
 * precedent). HP/creation are engine-owned (master #5).
 */
import { freezeState, isPlayerId, type PlayerId, type TransitionHandler } from './authority.js';
import { isResourceType, neighborsOf, type ResourceType } from './map.js';
import { MAX_UINT32 } from './rng.js';
import { STOCKPILES_SCHEMA_VERSION, type StockpilesData } from './stockpiles.js';
import type { WorldState } from './world-state.js';
import {
  isUnitsData,
  isUnitType,
  unitById,
  UNITS_SCHEMA_VERSION,
  UNIT_TYPES,
  type UnitsData,
  type UnitType,
} from './units.js';

function isUint32(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_UINT32;
}

/** Structural unit cost (mirrors Cost in economy.js — L2↛L2; meets payCost at the M025 seam). */
export type UnitCost = { readonly [type in ResourceType]?: number };

export interface UnitTypeConfig {
  readonly cost: UnitCost;
  readonly maxHp: number;
  readonly damage: number;
}

export type UnitsConfig = { readonly [type in UnitType]: UnitTypeConfig };

function isUnitCost(value: unknown): value is UnitCost {
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

function isUnitTypeConfig(value: unknown): value is UnitTypeConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  const maxHp = fields['maxHp'];
  return isUnitCost(fields['cost']) && isUint32(maxHp) && maxHp >= 1 && isUint32(fields['damage']);
}

export function isUnitsConfig(value: unknown): value is UnitsConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  if (entries.length !== UNIT_TYPES.length) {
    return false;
  }
  for (const [key, config] of entries) {
    if (!isUnitType(key) || !isUnitTypeConfig(config)) {
      return false;
    }
  }
  return true;
}

/**
 * Neutral default (M011 analogy: only master-dictated deviations, and the
 * master dictates none — tuning belongs to #92/playtesting). Frozen.
 */
export const DEFAULT_UNITS_CONFIG: UnitsConfig = freezeState({
  worker: { cost: {}, maxHp: 1, damage: 0 },
  warrior: { cost: {}, maxHp: 1, damage: 0 },
  archer: { cost: {}, maxHp: 1, damage: 0 },
});

export function unitCostOf(config: UnitsConfig, type: UnitType): UnitCost {
  if (!isUnitsConfig(config)) {
    throw new Error('unitCostOf: invalid units config.');
  }
  if (!isUnitType(type)) {
    throw new Error('unitCostOf: invalid unit type.');
  }
  return config[type].cost;
}

export function maxHpOf(config: UnitsConfig, type: UnitType): number {
  if (!isUnitsConfig(config)) {
    throw new Error('maxHpOf: invalid units config.');
  }
  if (!isUnitType(type)) {
    throw new Error('maxHpOf: invalid unit type.');
  }
  return config[type].maxHp;
}

export function unitDamageOf(config: UnitsConfig, type: UnitType): number {
  if (!isUnitsConfig(config)) {
    throw new Error('unitDamageOf: invalid units config.');
  }
  if (!isUnitType(type)) {
    throw new Error('unitDamageOf: invalid unit type.');
  }
  return config[type].damage;
}

/**
 * Mint a full-hp unit at a cell (pure; id `u${nextId}`). Validates
 * everything loud (mechanics-loud doctrine); id collision (init-placed
 * ids must respect nextId) and nextId exhaustion throw (bug-scale).
 * Bounds are uints only — on-map checks belong to M022 movement.
 */
export function spawnUnit(
  data: UnitsData | undefined,
  owner: PlayerId,
  type: UnitType,
  col: number,
  row: number,
  config: UnitsConfig,
): UnitsData {
  if (data !== undefined && !isUnitsData(data)) {
    throw new Error('spawnUnit: invalid units data.');
  }
  if (!isPlayerId(owner)) {
    throw new Error('spawnUnit: invalid owner.');
  }
  if (!isUnitType(type)) {
    throw new Error('spawnUnit: invalid unit type.');
  }
  if (!isUint32(col) || !isUint32(row)) {
    throw new Error('spawnUnit: invalid cell.');
  }
  if (!isUnitsConfig(config)) {
    throw new Error('spawnUnit: invalid units config.');
  }
  const base: UnitsData = data ?? { schemaVersion: UNITS_SCHEMA_VERSION, nextId: 0, units: [] };
  if (base.nextId >= MAX_UINT32) {
    throw new Error('spawnUnit: id space exhausted.');
  }
  const id = `u${base.nextId}`;
  if (base.units.some((unit) => unit.id === id)) {
    throw new Error('spawnUnit: id collision.');
  }
  return {
    schemaVersion: UNITS_SCHEMA_VERSION,
    nextId: base.nextId + 1,
    units: [...base.units, { id, owner, type, hp: config[type].maxHp, col, row }],
  };
}

/** Transition name (single source — match.ts wires it, tests dispatch it). */
export const MOVE_TRANSITION = 'unit.move';

/** Validated move parameters: a unit id plus a destination cell. */
export interface MoveParams {
  readonly id: string;
  readonly col: number;
  readonly row: number;
}

/** Structural passability predicate (Match injects the terrain-config closure). */
export type PassableTerrain = (terrain: string) => boolean;

/** Structural defense predicate (Match injects the terrain-config closure). */
export type DefenseOfTerrain = (terrain: string) => number;

/**
 * Structural treasury (Match injects the economy closures — L2↛L2 bars
 * warfare from importing payCost; M022 predicate precedent).
 */
export interface UnitTreasury {
  canAfford(funds: StockpilesData, holder: PlayerId, cost: UnitCost): boolean;
  pay(funds: StockpilesData, holder: PlayerId, cost: UnitCost): StockpilesData;
}

/** Wire-shape pre-rule (game rules live in the handler, not here). */
export function moveParamsRule(
  _caller: PlayerId,
  params: unknown,
): { readonly rule: string; readonly detail: string } | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return { rule: 'move-params', detail: 'move takes { id, col, row }' };
  }
  const fields = params as Record<string, unknown>;
  if (typeof fields['id'] !== 'string' || !isUint32(fields['col']) || !isUint32(fields['row'])) {
    return { rule: 'move-params', detail: 'move takes { id string, col/row uint32 }' };
  }
  return null;
}

export function createMoveHandler(passable: PassableTerrain): TransitionHandler<WorldState> {
  if (typeof passable !== 'function') {
    throw new Error('createMoveHandler: invalid passable predicate.');
  }
  return (ctx) => {
    // The pre-rule validated { id, col, row } shape on the dispatch path;
    // this cast documents the seam (match.ts `validated` precedent).
    const { id, col, row } = ctx.params as MoveParams;
    const data = ctx.state.units;
    if (data === undefined) {
      return { applied: false, reason: 'move: no units.' };
    }
    const unit = unitById(data, id);
    if (unit === undefined) {
      return { applied: false, reason: 'move: unknown unit.' };
    }
    if (unit.owner !== ctx.caller) {
      return { applied: false, reason: 'move: not your unit.' };
    }
    const map = ctx.state.map;
    if (map === undefined) {
      return { applied: false, reason: 'move: no map.' };
    }
    const target = map.cells.find((cell) => cell.col === col && cell.row === row);
    if (target === undefined) {
      return { applied: false, reason: 'move: out of bounds.' };
    }
    const adjacent = neighborsOf(map, unit.col, unit.row).some(
      (cell) => cell.col === col && cell.row === row,
    );
    if (!adjacent) {
      return { applied: false, reason: 'move: not adjacent.' };
    }
    if (!passable(target.terrain)) {
      return { applied: false, reason: 'move: impassable.' };
    }
    return {
      applied: true,
      state: {
        ...ctx.state,
        units: {
          schemaVersion: UNITS_SCHEMA_VERSION,
          nextId: data.nextId,
          units: data.units.map((entry) => (entry.id === id ? { ...entry, col, row } : entry)),
        },
      },
      summary: `moved ${id} to ${col},${row}`,
    };
  };
}

/** Transition name (single source — match.ts wires it, tests dispatch it). */
export const ATTACK_TRANSITION = 'unit.attack';

/** Validated attack parameters: attacker id plus target unit id. */
export interface AttackParams {
  readonly id: string;
  readonly target: string;
}

/** Wire-shape pre-rule (game rules live in the handler, not here). */
export function attackParamsRule(
  _caller: PlayerId,
  params: unknown,
): { readonly rule: string; readonly detail: string } | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return { rule: 'attack-params', detail: 'attack takes { id, target }' };
  }
  const fields = params as Record<string, unknown>;
  if (typeof fields['id'] !== 'string' || typeof fields['target'] !== 'string') {
    return { rule: 'attack-params', detail: 'attack takes { id string, target string }' };
  }
  return null;
}

export function createAttackHandler(
  unitsConfig: UnitsConfig,
  defenseOf: DefenseOfTerrain,
): TransitionHandler<WorldState> {
  if (!isUnitsConfig(unitsConfig)) {
    throw new Error('createAttackHandler: invalid units config.');
  }
  if (typeof defenseOf !== 'function') {
    throw new Error('createAttackHandler: invalid defense predicate.');
  }
  return (ctx) => {
    // The pre-rule validated { id, target } shape on the dispatch path;
    // this cast documents the seam (match.ts `validated` precedent).
    const { id, target } = ctx.params as AttackParams;
    const data = ctx.state.units;
    if (data === undefined) {
      return { applied: false, reason: 'attack: no units.' };
    }
    const unit = unitById(data, id);
    if (unit === undefined) {
      return { applied: false, reason: 'attack: unknown unit.' };
    }
    if (unit.owner !== ctx.caller) {
      return { applied: false, reason: 'attack: not your unit.' };
    }
    if (unit.hp <= 0) {
      return { applied: false, reason: 'attack: unit down.' };
    }
    const foe = unitById(data, target);
    if (foe === undefined) {
      return { applied: false, reason: 'attack: unknown target.' };
    }
    if (foe.owner === ctx.caller) {
      return { applied: false, reason: 'attack: not an enemy.' };
    }
    if (foe.hp <= 0) {
      return { applied: false, reason: 'attack: target down.' };
    }
    const map = ctx.state.map;
    if (map === undefined) {
      return { applied: false, reason: 'attack: no map.' };
    }
    const foeCell = neighborsOf(map, unit.col, unit.row).find(
      (cell) => cell.col === foe.col && cell.row === foe.row,
    );
    if (foeCell === undefined) {
      return { applied: false, reason: 'attack: out of range.' };
    }
    const damage = unitsConfig[unit.type].damage;
    const defense = defenseOf(foeCell.terrain);
    const net = Math.max(0, damage - defense);
    const hp = Math.max(0, foe.hp - net);
    const slain = hp <= 0;
    return {
      applied: true,
      state: {
        ...ctx.state,
        units: {
          schemaVersion: UNITS_SCHEMA_VERSION,
          nextId: data.nextId,
          units: slain
            ? data.units.filter((entry) => entry.id !== target)
            : data.units.map((entry) => (entry.id === target ? { ...entry, hp } : entry)),
        },
      },
      summary: `attacked ${target} for ${net} (hp ${foe.hp}→${hp})${slain ? ', slain' : ''}`,
    };
  };
}

export function warfareHandlers(
  passable: PassableTerrain,
  unitsConfig: UnitsConfig,
  defenseOf: DefenseOfTerrain,
  treasury: UnitTreasury,
): Map<string, TransitionHandler<WorldState>> {
  return new Map([
    [MOVE_TRANSITION, createMoveHandler(passable)],
    [ATTACK_TRANSITION, createAttackHandler(unitsConfig, defenseOf)],
    [TRAIN_TRANSITION, createTrainHandler(unitsConfig, treasury)],
  ]);
}

/** Transition name (single source — match.ts wires it, tests dispatch it). */
export const TRAIN_TRANSITION = 'unit.train';

/** Validated train parameters: a unit type plus a muster cell. */
export interface TrainParams {
  readonly type: string;
  readonly col: number;
  readonly row: number;
}

/** Wire-shape pre-rule (game rules live in the handler, not here). */
export function trainParamsRule(
  _caller: PlayerId,
  params: unknown,
): { readonly rule: string; readonly detail: string } | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return { rule: 'train-params', detail: 'train takes { type, col, row }' };
  }
  const fields = params as Record<string, unknown>;
  if (typeof fields['type'] !== 'string' || !isUint32(fields['col']) || !isUint32(fields['row'])) {
    return { rule: 'train-params', detail: 'train takes { type string, col/row uint32 }' };
  }
  return null;
}

export function createTrainHandler(
  unitsConfig: UnitsConfig,
  treasury: UnitTreasury,
): TransitionHandler<WorldState> {
  if (!isUnitsConfig(unitsConfig)) {
    throw new Error('createTrainHandler: invalid units config.');
  }
  if (typeof treasury?.pay !== 'function' || typeof treasury?.canAfford !== 'function') {
    throw new Error('createTrainHandler: invalid treasury.');
  }
  return (ctx) => {
    // The pre-rule validated { type, col, row } shape on the dispatch path;
    // this cast documents the seam (match.ts `validated` precedent).
    const { type, col, row } = ctx.params as TrainParams;
    if (!isUnitType(type)) {
      return { applied: false, reason: 'train: unknown unit type.' };
    }
    const map = ctx.state.map;
    if (map === undefined) {
      return { applied: false, reason: 'train: no map.' };
    }
    if (map.cells.find((entry) => entry.col === col && entry.row === row) === undefined) {
      return { applied: false, reason: 'train: out of bounds.' };
    }
    const cost = unitsConfig[type].cost;
    const funds: StockpilesData =
      ctx.state.stockpiles ?? { schemaVersion: STOCKPILES_SCHEMA_VERSION, stockpiles: {} };
    if (!treasury.canAfford(funds, ctx.caller, cost)) {
      return { applied: false, reason: 'train: cannot afford.' };
    }
    const paid = treasury.pay(funds, ctx.caller, cost);
    const data = ctx.state.units;
    const id = `u${data?.nextId ?? 0}`;
    const spawned = spawnUnit(data, ctx.caller, type, col, row, unitsConfig);
    return {
      applied: true,
      state: { ...ctx.state, units: spawned, stockpiles: paid },
      summary: `trained ${type} ${id} at ${col},${row}`,
    };
  };
}

/** Structural EventProducer: unit.moved from validated params (LOW per #priorities). */
export function moveProducer(input: {
  readonly type: string;
  readonly caller: PlayerId;
  readonly params: unknown;
  readonly before: WorldState;
  readonly after: WorldState;
}): ReadonlyArray<{
  readonly type: string;
  readonly priority: 'low';
  readonly payload: unknown;
}> {
  const params = input.params;
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new Error('moveProducer: invalid params.');
  }
  const fields = params as Record<string, unknown>;
  const { id, col, row } = fields;
  if (typeof id !== 'string' || !isUint32(col) || !isUint32(row)) {
    throw new Error('moveProducer: invalid params.');
  }
  return [
    { type: 'unit.moved', priority: 'low', payload: { player: input.caller, unit: id, col, row } },
  ];
}

/** Structural EventProducer: unit.attacked from validated params (NORMAL per M023 approval). */
export function attackProducer(input: {
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
  const params = input.params;
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new Error('attackProducer: invalid params.');
  }
  const fields = params as Record<string, unknown>;
  const { id, target } = fields;
  if (typeof id !== 'string' || typeof target !== 'string') {
    throw new Error('attackProducer: invalid params.');
  }
  const beforeUnits = input.before.units;
  const afterUnits = input.after.units;
  if (beforeUnits === undefined || afterUnits === undefined) {
    throw new Error('attackProducer: missing units.');
  }
  const was = unitById(beforeUnits, target);
  const now = unitById(afterUnits, target);
  if (was === undefined) {
    throw new Error('attackProducer: missing target.');
  }
  const facts: { type: string; priority: 'normal'; payload: unknown }[] = [
    {
      type: 'unit.attacked',
      priority: 'normal',
      payload: { player: input.caller, unit: id, target, damage: was.hp - (now === undefined ? 0 : now.hp) },
    },
  ];
  if (now === undefined) {
    facts.push({
      type: 'unit.slain',
      priority: 'normal',
      payload: { player: input.caller, unit: id, target },
    });
  }
  return facts;
}

/** Structural EventProducer: unit.trained from the created unit (NORMAL per production precedent). */
export function trainProducer(input: {
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
  const params = input.params;
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new Error('trainProducer: invalid params.');
  }
  const fields = params as Record<string, unknown>;
  const { type, col, row } = fields;
  if (typeof type !== 'string' || !isUint32(col) || !isUint32(row)) {
    throw new Error('trainProducer: invalid params.');
  }
  const afterUnits = input.after.units;
  if (afterUnits === undefined) {
    throw new Error('trainProducer: missing unit.');
  }
  const id = `u${input.before.units?.nextId ?? 0}`;
  const recruit = unitById(afterUnits, id);
  if (recruit === undefined) {
    throw new Error('trainProducer: missing unit.');
  }
  return [
    {
      type: 'unit.trained',
      priority: 'normal',
      payload: {
        player: input.caller,
        unit: id,
        type: recruit.type,
        col: recruit.col,
        row: recruit.row,
      },
    },
  ];
}
