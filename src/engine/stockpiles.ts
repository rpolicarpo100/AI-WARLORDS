/**
 * M016 — Stockpile data + guard + holder query (LEAF L0, zero imports).
 *
 * Per-holder resource stores over the closed food/wood/stone/gold set.
 * The guard lives here because WorldState (L1) may only import downward
 * (M009 layering law, M014 forcing). Fixed keys mirror RESOURCE_TYPES
 * (map.js); the test cross-checks the mirror (divergence fails loud).
 */

export const STOCKPILES_SCHEMA_VERSION = 1;

/** Mirrors MAX_ID_LENGTH (authority.js). Leaf: deliberately not imported. */
export const MAX_HOLDER_ID_CHARS = 64;

/** Mirrors MAX_UINT32 (rng.js). Leaf: deliberately not imported. */
const MAX_AMOUNT = 0xffffffff;

/** Mirrors ResourceType (map.js). Identical union, mutually assignable. */
export type StockpileType = 'food' | 'wood' | 'stone' | 'gold';

export type StockpileAmounts = { readonly [type in StockpileType]: number };

export interface StockpilesData {
  readonly schemaVersion: typeof STOCKPILES_SCHEMA_VERSION;
  readonly stockpiles: { readonly [holder: string]: StockpileAmounts };
}

function isHolderId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_HOLDER_ID_CHARS;
}

function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_AMOUNT;
}

export function isStockpileAmounts(value: unknown): value is StockpileAmounts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const amounts = value as Record<string, unknown>;
  return (
    isAmount(amounts['food']) &&
    isAmount(amounts['wood']) &&
    isAmount(amounts['stone']) &&
    isAmount(amounts['gold'])
  );
}

export function isStockpilesData(value: unknown): value is StockpilesData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  if (fields['schemaVersion'] !== STOCKPILES_SCHEMA_VERSION) {
    return false;
  }
  const stockpiles = fields['stockpiles'];
  if (typeof stockpiles !== 'object' || stockpiles === null || Array.isArray(stockpiles)) {
    return false;
  }
  for (const [holder, amounts] of Object.entries(stockpiles)) {
    if (!isHolderId(holder) || !isStockpileAmounts(amounts)) {
      return false;
    }
  }
  return true;
}

/**
 * Holder's amounts as a FRESH copy — or zeros for unknown holders and
 * absent data (fail-soft). Pure L0 builder (map.js loader precedent):
 * callers freeze the result into their own trees.
 */
export function stockpileOf(data: StockpilesData | undefined, holder: string): StockpileAmounts {
  const held = data?.stockpiles[holder];
  if (held === undefined) {
    return { food: 0, wood: 0, stone: 0, gold: 0 };
  }
  return { food: held.food, wood: held.wood, stone: held.stone, gold: held.gold };
}
