/**
 * M013 — Fog of War: pure visibility computation.
 *
 * LAYER L2 (imports map.js + authority.js + rng.js). No state, no views, no
 * memory: given a map + vision sources + a blocking config, computes the
 * deterministic visible-cell set per viewer. Sources arrive with their
 * owners (M021+); exploration memory is M014; enforcement inside AI/CLIENT
 * views is M015. Viewer membership is NOT checked here (pure layer) —
 * enforced at consumption (M015). See D-006.
 */

import { freezeState, isPlayerId, type PlayerId } from './authority.js';
import {
  cellAt,
  isTerrainId,
  neighborsOf,
  TERRAIN_IDS,
  type MapData,
  type TerrainId,
} from './map.js';
import { MAX_UINT32 } from './rng.js';

/** A vision source: who sees, from where, how far (hex steps). */
export interface VisionSource {
  readonly viewer: PlayerId;
  readonly col: number;
  readonly row: number;
  readonly range: number;
}

function isUint32(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_UINT32;
}

function isCoord(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function isVisionSource(value: unknown): value is VisionSource {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  return (
    isPlayerId(fields['viewer']) &&
    isCoord(fields['col']) &&
    isCoord(fields['row']) &&
    isUint32(fields['range'])
  );
}

/** Per-terrain vision rule: does this terrain stop propagation past it? */
export interface VisionRule {
  readonly blocksVision: boolean;
}

/** Complete rules table: all 9 terrains required, no partial configs. */
export type FogConfig = { readonly [T in TerrainId]: VisionRule };

function isVisionRule(value: unknown): value is VisionRule {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return typeof (value as Record<string, unknown>)['blocksVision'] === 'boolean';
}

export function isFogConfig(value: unknown): value is FogConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  if (entries.length !== TERRAIN_IDS.length) {
    return false;
  }
  for (const [key, rule] of entries) {
    if (!isTerrainId(key) || !isVisionRule(rule)) {
      return false;
    }
  }
  return true;
}

const defaultFogConfig: FogConfig = {
  field: { blocksVision: false },
  forest: { blocksVision: true },
  mountain: { blocksVision: true },
  river: { blocksVision: false },
  road: { blocksVision: false },
  bridge: { blocksVision: false },
  resource: { blocksVision: false },
  village: { blocksVision: false },
  city: { blocksVision: false },
};

export const DEFAULT_FOG_CONFIG: FogConfig = freezeState(defaultFogConfig);

/**
 * Visibility outcome: ascending cell indices per viewer (`index =
 * row * map.width + col`), viewers in ascending id order. Frozen.
 * Every sourced viewer gets a key (possibly empty — OOB sources).
 */
export type VisibilityResult = { readonly [viewer: string]: readonly number[] };

export function computeVisibility(
  map: MapData,
  sources: readonly VisionSource[],
  config: FogConfig = DEFAULT_FOG_CONFIG,
): VisibilityResult {
  if (!isFogConfig(config)) {
    throw new Error('computeVisibility: invalid fog config.');
  }
  if (!Array.isArray(sources)) {
    throw new Error('computeVisibility: invalid sources (expected array).');
  }
  for (const source of sources) {
    if (!isVisionSource(source)) {
      throw new Error('computeVisibility: invalid vision source.');
    }
  }
  const viewers = [...new Set(sources.map((source) => source.viewer))].sort();
  const result: Record<string, number[]> = {};
  for (const viewer of viewers) {
    const seen = new Set<number>();
    for (const source of sources) {
      if (source.viewer !== viewer) {
        continue;
      }
      floodFrom(map, source, config, seen);
    }
    result[viewer] = [...seen].sort((a, b) => a - b);
  }
  return freezeState(result);
}

/**
 * Level-order flood limited by range. Blocked cells are seen but never
 * expanded — except the observer's own cell, which always expands (an
 * observer sees out of where it stands; blocking occludes what is BEYOND).
 * OOB origins are skipped soft (stale positions must not crash computation).
 */
function floodFrom(map: MapData, source: VisionSource, config: FogConfig, seen: Set<number>): void {
  if (cellAt(map, source.col, source.row) === undefined) {
    return;
  }
  const start = source.row * map.width + source.col;
  const visited = new Set<number>([start]);
  seen.add(start);
  let frontier: Array<{ readonly col: number; readonly row: number }> = [
    { col: source.col, row: source.row },
  ];
  for (let step = 0; step < source.range; step += 1) {
    const next: Array<{ readonly col: number; readonly row: number }> = [];
    for (const cell of frontier) {
      for (const found of neighborsOf(map, cell.col, cell.row)) {
        const index = found.row * map.width + found.col;
        if (visited.has(index)) {
          continue;
        }
        visited.add(index);
        seen.add(index);
        if (!config[found.terrain].blocksVision) {
          next.push({ col: found.col, row: found.row });
        }
      }
    }
    frontier = next;
  }
}

/** Ascending visible indices for a viewer, or [] for unknown viewers. */
export function visibleCells(result: VisibilityResult, viewer: PlayerId): readonly number[] {
  return result[viewer] ?? [];
}

/** Whether a cell index is visible to a viewer (fail-soft false). */
export function isVisibleCell(result: VisibilityResult, viewer: PlayerId, index: number): boolean {
  return result[viewer]?.includes(index) ?? false;
}
