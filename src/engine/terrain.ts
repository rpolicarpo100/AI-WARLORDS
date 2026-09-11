/**
 * M011 — Terrain: gameplay semantics for the 9 M010 terrain ids.
 *
 * LAYER L2 (imports map.js + authority.js freeze only). Pure rules data:
 * configs are NOT canonical state (rules version separately, master-doc
 * #84); consumers (M022+) close over a validated config. Default values
 * follow ONLY #17's directions; everything else stays neutral until its
 * module speaks. HIGH GROUND (#17) ⟺ mountain cells — no elevation field
 * exists (L-22). All values are plain tunable numbers (#82: balanceable).
 */

import { freezeState } from './authority.js';
import { cellAt, isTerrainId, TERRAIN_IDS, type MapData, type TerrainId } from './map.js';

export interface TerrainModifiers {
  /** Movement cost multiplier (≥0). +Infinity = impassable. */
  readonly move: number;
  /** Additive defense bonus (interpreted in M023). */
  readonly defense: number;
  /** Additive stealth bonus (mechanics arrive with their module). */
  readonly stealth: number;
  /** Additive ranged bonus (mountain = high ground). */
  readonly ranged: number;
}

/** Complete rules table: all 9 terrains required, no partial configs. */
export type TerrainConfig = { readonly [T in TerrainId]: TerrainModifiers };

function isModifiers(value: unknown): value is TerrainModifiers {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  const move = fields['move'];
  if (typeof move !== 'number' || !(move >= 0)) {
    return false;
  }
  for (const key of ['defense', 'stealth', 'ranged'] as const) {
    const bonus = fields[key];
    if (typeof bonus !== 'number' || !Number.isFinite(bonus)) {
      return false;
    }
  }
  return true;
}

export function isTerrainConfig(value: unknown): value is TerrainConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  if (entries.length !== TERRAIN_IDS.length) {
    return false;
  }
  for (const [key, modifiers] of entries) {
    if (!isTerrainId(key) || !isModifiers(modifiers)) {
      return false;
    }
  }
  return true;
}

const defaultTerrainConfig: TerrainConfig = {
  field: { move: 1, defense: 0, stealth: 0, ranged: 0 },
  forest: { move: 2, defense: 1, stealth: 2, ranged: 0 },
  mountain: { move: 3, defense: 2, stealth: 0, ranged: 1 },
  river: { move: Infinity, defense: 0, stealth: 0, ranged: 0 },
  road: { move: 0.5, defense: 0, stealth: 0, ranged: 0 },
  bridge: { move: 1, defense: 0, stealth: 0, ranged: 0 },
  resource: { move: 1, defense: 0, stealth: 0, ranged: 0 },
  village: { move: 1, defense: 0, stealth: 0, ranged: 0 },
  city: { move: 1, defense: 0, stealth: 0, ranged: 0 },
};

// D-001: river Infinity (impassable) is rules-config, never canonical state.
export const DEFAULT_TERRAIN_CONFIG: TerrainConfig = freezeState(defaultTerrainConfig, {
  allowNonFinite: true,
});

/** Fail-stop: unknown terrain throws (never invent defaults). */
export function modifiersFor(config: TerrainConfig, terrain: TerrainId): TerrainModifiers {
  const found: TerrainModifiers | undefined = config[terrain];
  if (found === undefined) {
    throw new Error(`modifiersFor: unknown terrain "${String(terrain)}".`);
  }
  return found;
}

/** Cell modifiers, or undefined out of bounds. */
export function cellModifiers(
  config: TerrainConfig,
  map: MapData,
  col: number,
  row: number,
): TerrainModifiers | undefined {
  const cell = cellAt(map, col, row);
  if (cell === undefined) {
    return undefined;
  }
  return modifiersFor(config, cell.terrain);
}

export function isPassable(config: TerrainConfig, terrain: TerrainId): boolean {
  return modifiersFor(config, terrain).move !== Infinity;
}
