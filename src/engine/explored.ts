/**
 * M014 — Explored memory data + guard (LEAF L0, zero imports).
 *
 * Canonical per-viewer explored-cell sets (ascending unique indices).
 * The guard lives here (not in exploration.ts) because WorldState (L1)
 * may only import downward (M009 layering law). Viewers mirror PlayerId
 * shape (marked); indices are uint32 — map bounds are checked
 * contextually in isWorldState, which holds both fields (M014).
 */

export const EXPLORED_SCHEMA_VERSION = 1;

/** Mirrors MAX_ID_LENGTH (authority.js). Leaf: deliberately not imported. */
export const MAX_VIEWER_ID_CHARS = 64;

/** Mirrors map MAX_INDEX uint32 (leaf: deliberately not imported). */
const MAX_CELL_INDEX = 0xffffffff;

export interface ExploredData {
  readonly schemaVersion: typeof EXPLORED_SCHEMA_VERSION;
  readonly viewers: { readonly [viewer: string]: readonly number[] };
}

function isViewerId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_VIEWER_ID_CHARS;
}

/** Cell index: uint32 (bounds need map context — checked in isWorldState). */
export function isCellIndex(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_CELL_INDEX
  );
}

export function isExploredData(value: unknown): value is ExploredData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  if (fields['schemaVersion'] !== EXPLORED_SCHEMA_VERSION) {
    return false;
  }
  const viewers = fields['viewers'];
  if (typeof viewers !== 'object' || viewers === null || Array.isArray(viewers)) {
    return false;
  }
  for (const [viewer, indices] of Object.entries(viewers)) {
    if (!isViewerId(viewer)) {
      return false;
    }
    if (!Array.isArray(indices)) {
      return false;
    }
    let prev = -1;
    for (const index of indices) {
      if (!isCellIndex(index) || index <= prev) {
        return false;
      }
      prev = index;
    }
  }
  return true;
}
