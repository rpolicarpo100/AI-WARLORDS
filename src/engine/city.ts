/**
 * M019 — City data + guard + holder query (LEAF L0, zero imports).
 *
 * Per-holder cities: progression level (master #16: 1→2→3) plus a
 * construction queue (pending {type, remaining} items, completed by
 * time — see completeConstructions in economy.js). Queues are uncapped
 * (no master anchor; MAX_STATE_BYTES self-limits spam). The guard lives
 * here because WorldState (L1) may only import downward (M009 layering
 * law, M014 forcing). Holder validation and the building vocabulary
 * mirror stockpiles.js / buildings.js (L0↛L0: deliberately not
 * imported); the test cross-checks the mirrors (divergence fails loud).
 */

export const CITIES_SCHEMA_VERSION = 1;

/** Mirrors BUILDING_IDS (buildings.js). Leaf: deliberately not imported. */
export const QUEUE_BUILDINGS: readonly string[] = Object.freeze([
  'town-center',
  'house',
  'storage',
  'barracks',
  'wall',
  'tower',
]);

/** Mirrors BuildingId (buildings.js). Identical union, mutually assignable. */
export type QueueBuilding = 'town-center' | 'house' | 'storage' | 'barracks' | 'wall' | 'tower';

export type CityLevel = 1 | 2 | 3;

export interface QueueItem {
  readonly type: QueueBuilding;
  readonly remaining: number;
}

export interface CityState {
  readonly level: CityLevel;
  readonly queue: readonly QueueItem[];
}

export interface CitiesData {
  readonly schemaVersion: typeof CITIES_SCHEMA_VERSION;
  readonly cities: { readonly [holder: string]: CityState };
}

/** Mirrors MAX_HOLDER_ID_CHARS (stockpiles.js). Leaf: deliberately not imported. */
export const MAX_HOLDER_ID_CHARS = 64;

/** Mirrors MAX_UINT32 (rng.js). Leaf: deliberately not imported. */
const MAX_PROMPTS = 0xffffffff;

function isHolderId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_HOLDER_ID_CHARS;
}

function isPrompts(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_PROMPTS;
}

export function isQueueBuilding(value: unknown): value is QueueBuilding {
  return typeof value === 'string' && QUEUE_BUILDINGS.includes(value);
}

export function isQueueItem(value: unknown): value is QueueItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  return isQueueBuilding(fields['type']) && isPrompts(fields['remaining']);
}

export function isCityState(value: unknown): value is CityState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  const level = fields['level'];
  if (level !== 1 && level !== 2 && level !== 3) {
    return false;
  }
  const queue = fields['queue'];
  if (!Array.isArray(queue)) {
    return false;
  }
  return queue.every(isQueueItem);
}

export function isCitiesData(value: unknown): value is CitiesData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  if (fields['schemaVersion'] !== CITIES_SCHEMA_VERSION) {
    return false;
  }
  const cities = fields['cities'];
  if (typeof cities !== 'object' || cities === null || Array.isArray(cities)) {
    return false;
  }
  for (const [holder, city] of Object.entries(cities)) {
    if (!isHolderId(holder) || !isCityState(city)) {
      return false;
    }
  }
  return true;
}

/**
 * Holder's city as a FRESH copy — or a virtual level-1 idle city for
 * unknown holders and absent data (fail-soft: every holder effectively
 * holds a city from the start). Pure L0 builder (map.js loader
 * precedent): callers freeze the result into their own trees.
 */
export function cityOf(data: CitiesData | undefined, holder: string): CityState {
  const held = data?.cities[holder];
  if (held === undefined) {
    return { level: 1, queue: [] };
  }
  return { level: held.level, queue: held.queue.map((item) => ({ ...item })) };
}
