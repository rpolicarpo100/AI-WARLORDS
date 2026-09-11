/**
 * M014 — Exploration operations: accumulation, queries, tri-state.
 *
 * LAYER L2 (imports explored.js + authority.js). `VisibilitySets` is the
 * structural twin of fog.VisibilityResult (an L2→L2 edge is forbidden;
 * compatibility is proven by the integration test feeding computeVisibility
 * output into markExplored). Memory persists in WorldState.explored;
 * enforcement of viewer membership happens at consumption (M015).
 */

import { freezeState, type PlayerId } from './authority.js';
import {
  EXPLORED_SCHEMA_VERSION,
  isCellIndex,
  isExploredData,
  type ExploredData,
} from './explored.js';

/** Structural twin of fog.VisibilityResult (see module doc). */
export type VisibilitySets = { readonly [viewer: string]: readonly number[] };

export type ExplorationStatus = 'visible' | 'explored' | 'unexplored';

/**
 * Accumulates sight into memory: union per viewer, canonical ascending
 * unique form, new viewers admitted. Frozen. Loud on malformed input.
 */
export function markExplored(current: ExploredData, visibility: VisibilitySets): ExploredData {
  if (!isExploredData(current)) {
    throw new Error('markExplored: invalid current explored data.');
  }
  if (typeof visibility !== 'object' || visibility === null || Array.isArray(visibility)) {
    throw new Error('markExplored: invalid visibility.');
  }
  const merged: Record<string, number[]> = {};
  for (const [viewer, known] of Object.entries(current.viewers)) {
    merged[viewer] = [...known];
  }
  for (const [viewer, seen] of Object.entries(visibility)) {
    if (!Array.isArray(seen)) {
      throw new Error('markExplored: invalid visibility.');
    }
    let acc = merged[viewer];
    if (acc === undefined) {
      acc = [];
      merged[viewer] = acc;
    }
    for (const index of seen) {
      if (!isCellIndex(index)) {
        throw new Error('markExplored: invalid visibility.');
      }
      acc.push(index);
    }
  }
  const viewers: Record<string, readonly number[]> = {};
  for (const [viewer, indices] of Object.entries(merged)) {
    viewers[viewer] = [...new Set(indices)].sort((a, b) => a - b);
  }
  return freezeState({ schemaVersion: EXPLORED_SCHEMA_VERSION, viewers });
}

/** Ascending explored indices for a viewer, or [] for unknown viewers. */
export function exploredCells(explored: ExploredData, viewer: PlayerId): readonly number[] {
  return explored.viewers[viewer] ?? [];
}

/** Whether a cell index is explored by a viewer (fail-soft false). */
export function isExplored(explored: ExploredData, viewer: PlayerId, index: number): boolean {
  return explored.viewers[viewer]?.includes(index) ?? false;
}

/**
 * Tri-state knowledge of one cell: current sight beats memory, memory
 * beats darkness. Either input may be absent (mapless/early matches).
 */
export function explorationStatus(
  visibility: VisibilitySets | undefined,
  explored: ExploredData | undefined,
  viewer: PlayerId,
  index: number,
): ExplorationStatus {
  if (visibility?.[viewer]?.includes(index) === true) {
    return 'visible';
  }
  if (explored?.viewers[viewer]?.includes(index) === true) {
    return 'explored';
  }
  return 'unexplored';
}
