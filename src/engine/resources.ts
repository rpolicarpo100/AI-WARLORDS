/**
 * M012 — Resources: queries over resource-bearing map cells.
 *
 * LAYER L2 (imports map.js only). Nodes are geography: they ride inside
 * MapData (validated + loaded by map.js), inherit map-blindness, and are
 * protected by map-preserved until gathering arrives (M017 mutates amounts).
 * This module only READS: lookups fail soft (undefined), aggregations
 * compute (unknown types sum to 0 — correct over an empty match set).
 */

import {
  cellAt,
  type MapCell,
  type MapData,
  type ResourceDetail,
  type ResourceType,
} from './map.js';

/** Node detail at a cell, or undefined (no node / out of bounds). */
export function resourceAt(map: MapData, col: number, row: number): ResourceDetail | undefined {
  return cellAt(map, col, row)?.resource;
}

/** Every resource-bearing cell, in canonical cell order. */
export function resourceNodes(map: MapData): readonly MapCell[] {
  return map.cells.filter((cell) => cell.resource !== undefined);
}

/** Total amount of one resource across the map (content auditing). */
export function totalResource(map: MapData, type: ResourceType): number {
  let total = 0;
  for (const cell of map.cells) {
    const found = cell.resource;
    if (found !== undefined && found.type === type) {
      total += found.amount;
    }
  }
  return total;
}
