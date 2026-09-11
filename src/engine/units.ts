/**
 * M021 — Unit data + guard + queries (LEAF L0, zero imports).
 *
 * Positioned individuals (master #15: worker/warrior/archer MVP;
 * cavalry/spearman/heavy/siege/special explicitly NOT YET). Each
 * instance carries id/owner/type/hp/cell; `nextId` mints deterministic
 * spawn ids (replay-safe — random-UUID minting is engine-banned). The guard
 * lives here because WorldState (L1) may only import downward (M009
 * layering law, M014 forcing). Holder ids and the uint32 ceiling mirror
 * stockpiles.js / rng.js (L0↛L0: deliberately not imported); the test
 * cross-checks the mirrors (divergence fails loud).
 */

export const UNITS_SCHEMA_VERSION = 1;

/** Master #15 MVP, closed. Order: gatherer, melee, ranged. */
export const UNIT_TYPES: readonly string[] = Object.freeze(['worker', 'warrior', 'archer']);

/** Master #15 MVP unit types (mutually assignable with config keys). */
export type UnitType = 'worker' | 'warrior' | 'archer';

export interface UnitInstance {
  readonly id: string;
  readonly owner: string;
  readonly type: UnitType;
  readonly hp: number;
  readonly col: number;
  readonly row: number;
}

export interface UnitsData {
  readonly schemaVersion: typeof UNITS_SCHEMA_VERSION;
  readonly nextId: number;
  readonly units: readonly UnitInstance[];
}

/** Mirrors MAX_HOLDER_ID_CHARS (stockpiles.js). Leaf: deliberately not imported. */
export const MAX_HOLDER_ID_CHARS = 64;

/** Unit ids share the holder bound (symmetric; own bound, not mirrored). */
export const MAX_UNIT_ID_CHARS = 64;

/** Mirrors MAX_UINT32 (rng.js). Leaf: deliberately not imported. */
const MAX_WORD = 0xffffffff;

function isHolderId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_HOLDER_ID_CHARS;
}

function isUnitId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_UNIT_ID_CHARS;
}

function isWord(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_WORD;
}

export function isUnitType(value: unknown): value is UnitType {
  return typeof value === 'string' && UNIT_TYPES.includes(value);
}

export function isUnitInstance(value: unknown): value is UnitInstance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  return (
    isUnitId(fields['id']) &&
    isHolderId(fields['owner']) &&
    isUnitType(fields['type']) &&
    isWord(fields['hp']) &&
    isWord(fields['col']) &&
    isWord(fields['row'])
  );
}

export function isUnitsData(value: unknown): value is UnitsData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  if (fields['schemaVersion'] !== UNITS_SCHEMA_VERSION) {
    return false;
  }
  if (!isWord(fields['nextId'])) {
    return false;
  }
  const units = fields['units'];
  if (!Array.isArray(units)) {
    return false;
  }
  const seen = new Set<string>();
  for (const unit of units) {
    if (!isUnitInstance(unit)) {
      return false;
    }
    if (seen.has(unit.id)) {
      return false;
    }
    seen.add(unit.id);
  }
  return true;
}

/**
 * Holder's units as FRESH copies in array order — or [] for unknown
 * holders and absent data (fail-soft). Pure L0 builder (map.js loader
 * precedent): callers freeze the result into their own trees.
 */
export function unitsOf(data: UnitsData | undefined, holder: string): UnitInstance[] {
  if (data === undefined) {
    return [];
  }
  return data.units.filter((unit) => unit.owner === holder).map((unit) => ({ ...unit }));
}

/**
 * Instance lookup as a FRESH copy — or undefined when absent (fail-soft).
 * Ids are unique per the guard, so the first match is the only match.
 */
export function unitById(data: UnitsData | undefined, id: string): UnitInstance | undefined {
  const found = data?.units.find((unit) => unit.id === id);
  if (found === undefined) {
    return undefined;
  }
  return { ...found };
}
