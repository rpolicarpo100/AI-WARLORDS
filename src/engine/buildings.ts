/**
 * M018 — Building data + guard + holder query (LEAF L0, zero imports).
 *
 * Per-holder building counts over the closed master-#16 set
 * (town-center, house, storage, barracks, wall, tower). Counts, not
 * instances: identity/position/hp are ungrounded — counts suffice for
 * derived caps (L-31, in economy.js) and future build transitions
 * (M019). The guard lives here because WorldState (L1) may only import
 * downward (M009 layering law, M014 forcing). Holder validation
 * mirrors stockpiles.js (L0↛L0: deliberately not imported); the test
 * cross-checks the mirror (divergence fails loud).
 */

export const BUILDINGS_SCHEMA_VERSION = 1;

/** Master #16 vocabulary, in master order (locked by test). */
export const BUILDING_IDS: readonly string[] = Object.freeze([
  'town-center',
  'house',
  'storage',
  'barracks',
  'wall',
  'tower',
]);

export type BuildingId = 'town-center' | 'house' | 'storage' | 'barracks' | 'wall' | 'tower';

export function isBuildingId(value: unknown): value is BuildingId {
  return typeof value === 'string' && BUILDING_IDS.includes(value);
}

export type BuildingCounts = { readonly [type in BuildingId]: number };

export interface BuildingsData {
  readonly schemaVersion: typeof BUILDINGS_SCHEMA_VERSION;
  readonly buildings: { readonly [holder: string]: BuildingCounts };
}

/** Mirrors MAX_HOLDER_ID_CHARS (stockpiles.js). Leaf: deliberately not imported. */
export const MAX_HOLDER_ID_CHARS = 64;

/** Mirrors MAX_UINT32 (rng.js). Leaf: deliberately not imported. */
const MAX_COUNT = 0xffffffff;

function isHolderId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_HOLDER_ID_CHARS;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_COUNT;
}

export function isBuildingCounts(value: unknown): value is BuildingCounts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const counts = value as Record<string, unknown>;
  return (
    isCount(counts['town-center']) &&
    isCount(counts['house']) &&
    isCount(counts['storage']) &&
    isCount(counts['barracks']) &&
    isCount(counts['wall']) &&
    isCount(counts['tower'])
  );
}

export function isBuildingsData(value: unknown): value is BuildingsData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  if (fields['schemaVersion'] !== BUILDINGS_SCHEMA_VERSION) {
    return false;
  }
  const buildings = fields['buildings'];
  if (typeof buildings !== 'object' || buildings === null || Array.isArray(buildings)) {
    return false;
  }
  for (const [holder, counts] of Object.entries(buildings)) {
    if (!isHolderId(holder) || !isBuildingCounts(counts)) {
      return false;
    }
  }
  return true;
}

/**
 * Holder's counts as a FRESH copy — or zeros for unknown holders and
 * absent data (fail-soft). Pure L0 builder (map.js loader precedent):
 * callers freeze the result into their own trees.
 */
export function countsOf(data: BuildingsData | undefined, holder: string): BuildingCounts {
  const held = data?.buildings[holder];
  if (held === undefined) {
    return { 'town-center': 0, house: 0, storage: 0, barracks: 0, wall: 0, tower: 0 };
  }
  return {
    'town-center': held['town-center'],
    house: held.house,
    storage: held.storage,
    barracks: held.barracks,
    wall: held.wall,
    tower: held.tower,
  };
}
