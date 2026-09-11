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
import type { MapData } from './map.js';
import type { UnitsData } from './units.js';
import type { WorldState } from './world-state.js';

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

type DiscoveredFact = {
  readonly type: string;
  readonly priority: 'low';
  readonly payload: unknown;
};

/**
 * M030 — Structural EventProducer: first-sight facts from the explored
 * diff (the Match postStep is the only explored writer — exact).
 * Viewers ascend, indices ascend (markExplored keeps them sorted);
 * terrain resolves through the after-map (M028 mirror: stale indices
 * skip soft). LOW: routine scouting intel (#33 movement-tier).
 */
export function discoveredProducer(input: {
  readonly type: string;
  readonly caller: PlayerId;
  readonly params: unknown;
  readonly before: WorldState;
  readonly after: WorldState;
}): ReadonlyArray<DiscoveredFact> {
  const facts: DiscoveredFact[] = [];
  const map: MapData | undefined = input.after.map;
  if (map === undefined) {
    return facts;
  }
  const beforeViewers = input.before.explored?.viewers ?? {};
  const afterViewers = input.after.explored?.viewers ?? {};
  for (const viewer of Object.keys(afterViewers).sort()) {
    const seen = new Set(beforeViewers[viewer] ?? []);
    // Keyed from this same object: defined by construction (match.ts cast precedent).
    const indices = afterViewers[viewer] as readonly number[];
    for (const index of indices) {
      if (seen.has(index)) {
        continue;
      }
      const cell = map.cells[index];
      if (cell === undefined) {
        continue;
      }
      facts.push({
        type: 'cell.discovered',
        priority: 'low',
        payload: {
          player: viewer,
          col: index % map.width,
          row: Math.floor(index / map.width),
          terrain: cell.terrain,
        },
      });
    }
  }
  return facts;
}

type SpottedFact = {
  readonly type: string;
  readonly priority: 'normal';
  readonly payload: unknown;
};

/**
 * M030 — Enemy sightings from a visibility diff (pure: the Match
 * closure computes both visibilities — L2↛L2 forbids calling fog
 * from here). A viewer spots an enemy unit when its after-cell is
 * visible now but its before-cell (same cell for fresh spawns) was
 * not visible before: entering vision fires, tracked contact and
 * standing under watch stay silent. Viewers ascend, after-roster
 * order keeps facts deterministic. NORMAL: #33 ENEMY SCOUT.
 */
export function spottedFacts(input: {
  readonly beforeUnits: UnitsData | undefined;
  readonly afterUnits: UnitsData | undefined;
  readonly beforeVisible: VisibilitySets;
  readonly afterVisible: VisibilitySets;
  readonly width: number;
}): ReadonlyArray<SpottedFact> {
  const facts: SpottedFact[] = [];
  const was = new Map((input.beforeUnits?.units ?? []).map((unit) => [unit.id, unit] as const));
  const viewers = [...new Set([...Object.keys(input.beforeVisible), ...Object.keys(input.afterVisible)])].sort();
  for (const viewer of viewers) {
    const beforeSet = new Set(input.beforeVisible[viewer] ?? []);
    const afterSet = new Set(input.afterVisible[viewer] ?? []);
    for (const unit of input.afterUnits?.units ?? []) {
      if (unit.owner === viewer) {
        continue;
      }
      const pos = unit.row * input.width + unit.col;
      if (!afterSet.has(pos)) {
        continue;
      }
      const prev = was.get(unit.id);
      const prevPos = prev === undefined ? pos : prev.row * input.width + prev.col;
      if (beforeSet.has(prevPos)) {
        continue;
      }
      facts.push({
        type: 'unit.spotted',
        priority: 'normal',
        payload: {
          player: viewer,
          unit: unit.id,
          owner: unit.owner,
          col: unit.col,
          row: unit.row,
        },
      });
    }
  }
  return facts;
}
