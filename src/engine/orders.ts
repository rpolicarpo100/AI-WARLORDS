/**
 * M043 — Commander orders data (LEAF L0, zero imports).
 *
 * Player → AI Command foundation (data-first, M027 mold): an order names
 * an orderable engine verb (ORDER_IDS — existing transition names, voted
 * engine-verbs, alphabetical, locked by test) plus optional flat params.
 * Params stay kind-agnostic here: all five orderable wire-shapes are flat
 * scalar records (move {id,col,row}, attack {id,target}, train
 * {type,col,row}, build {type}, gather {col,row}), so flat covers the
 * grounded present; per-kind shapes belong to the M044 pre-rules.
 * CUTS (D-037): commander.* (lifecycle meta), city.upgrade (player
 * progression), world.noop (absence of an order IS no order).
 * Zero transitions, zero events, zero readers until M044+.
 * M044 amends the storage contract: records carry an optional FIFO
 * `orders` queue (absent means empty) capped at
 * MAX_ORDERS_PER_COMMANDER; isOrderQueue is the canonical array
 * guard (commanders.ts mirrors, same L0↛L0 law).
 */

export const ORDER_IDS = [
  'city.build',
  'economy.gather',
  'unit.attack',
  'unit.move',
  'unit.train',
] as const;

/** Orderable engine verbs (ORDER_IDS canonical; commanders.ts mirrors). */
export type OrderKind = (typeof ORDER_IDS)[number];

/** Flat param values: strings, finite numbers, booleans (no nesting). */
export type OrderParamValue = string | number | boolean;

/** Kind-agnostic flat params (per-kind shapes are M044's pre-rules). */
export interface OrderParams {
  readonly [key: string]: OrderParamValue;
}

/** A standing commander directive: which verb, with what arguments. */
export interface CommanderOrder {
  readonly kind: OrderKind;
  readonly params?: OrderParams;
}

/** Param-count ceiling (largest grounded shape has 3; headroom, not law). */
export const MAX_ORDER_PARAMS = 8;

/** Param-key ceiling (longest grounded key is `target`, 6 chars). */
export const MAX_ORDER_PARAM_KEY_CHARS = 32;

/** String-value ceiling (symmetric with the commander-id bound). */
export const MAX_ORDER_PARAM_CHARS = 64;

/** Queue-length ceiling (M044, own bound: headroom, not law). */
export const MAX_ORDERS_PER_COMMANDER = 8;

export function isOrderKind(value: unknown): value is OrderKind {
  return typeof value === 'string' && (ORDER_IDS as readonly string[]).includes(value);
}

function isParamKey(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length >= 1 && value.length <= MAX_ORDER_PARAM_KEY_CHARS
  );
}

function isParamValue(value: unknown): value is OrderParamValue {
  if (typeof value === 'string') {
    return value.length <= MAX_ORDER_PARAM_CHARS;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  return typeof value === 'boolean';
}

export function isOrderParams(value: unknown): value is OrderParams {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_ORDER_PARAMS) {
    return false;
  }
  for (const [key, entry] of entries) {
    if (!isParamKey(key) || !isParamValue(entry)) {
      return false;
    }
  }
  return true;
}

/** Total order check: kind whitelisted, params optional, extras ignored (M015). */
export function isCommanderOrder(value: unknown): value is CommanderOrder {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  return (
    isOrderKind(fields['kind']) &&
    (fields['params'] === undefined || isOrderParams(fields['params']))
  );
}

/** Total queue check: array, capped, every element a valid order. */
export function isOrderQueue(value: unknown): value is CommanderOrder[] {
  if (!Array.isArray(value)) {
    return false;
  }
  if (value.length > MAX_ORDERS_PER_COMMANDER) {
    return false;
  }
  for (const entry of value) {
    if (!isCommanderOrder(entry)) {
      return false;
    }
  }
  return true;
}
