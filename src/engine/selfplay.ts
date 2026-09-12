/**
 * M065 — Self-play policy brain (LAYER L3, pure).
 *
 * First of the AI Arena block (M065–M068, D-059, voted self-play):
 * simplePolicy is a deterministic template player (no LLM, no RNG)
 * that reads one snapshot and emits one dispatch envelope (or null
 * when no unit can act). M066 (D-060, voted smarter-brains) grows
 * the v2 brain behind the same signature (the runner is untouched):
 * per own unit (id order) — FLEE when critical (hp <= 2) with an
 * adjacent foe (a step that strictly grows the nearest-foe gap, or
 * fight cornered); ATTACK with focus fire (lowest hp, tie by id);
 * workers GATHER on live nodes, SEEK the nearest live node, else
 * close in; everyone else steps toward the nearest foe
 * (axial-greedy over passable neighbors) or patrols (first
 * passable neighbor when no foes live). All move ties break by
 * col/row. Passability is injected (M045 mold — configs live
 * above; Match binds its own). Still greedy by design (approach
 * jitters — every applied lance spends, so matches still end).
 * LAYER L3 (imports warfare/economy L2 values + map L0 + authority
 * L0 + world-state L1 type-only, all downward).
 */
import type { PlayerId } from './authority.js';
import { GATHER_TRANSITION } from './economy.js';
import { axialDistance, cellAt, neighborsOf, offsetToAxial, type MapCell } from './map.js';
import { ATTACK_TRANSITION, MOVE_TRANSITION } from './warfare.js';
import type { WorldState } from './world-state.js';

/** One policy decision: a dispatch envelope, or null when idle. */
export interface PolicyMove {
  readonly type: string;
  readonly payload: unknown;
}

/** Injected terrain check (Match binds terrainPassable). */
export type PassableCheck = (terrain: string) => boolean;

/**
 * M066 — critical flesh: at or below this hp a unit with an
 * adjacent foe retreats instead of fighting (the snapshot carries
 * no damage config, so the line is explicit, not derived).
 */
const CRITICAL_HP = 2;

function byId(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id.localeCompare(b.id);
}

/** Rank key: smaller reach first, ties by col/row (M065 mold). */
function rankKey(reach: number, col: number, row: number): string {
  return `${String(reach).padStart(4, '0')}:${String(col).padStart(4, '0')},${String(row).padStart(4, '0')}`;
}

/** Cheapest passable neighbor (approach / seek / patrol mold). */
function stepToward(
  cells: readonly MapCell[],
  passable: PassableCheck,
  reachOf: (cell: MapCell) => number,
): MapCell | undefined {
  let best: MapCell | undefined;
  let bestKey = '';
  for (const cell of cells) {
    if (!passable(cell.terrain)) {
      continue;
    }
    const key = rankKey(reachOf(cell), cell.col, cell.row);
    if (best === undefined || key < bestKey) {
      best = cell;
      bestKey = key;
    }
  }
  return best;
}

/**
 * M066 — retreat: the passable neighbor that strictly grows the
 * nearest-foe gap (ties by col/row); undefined when cornered (the
 * caller falls through to fighting).
 */
function fleeStep(
  cells: readonly MapCell[],
  passable: PassableCheck,
  gapOf: (cell: MapCell) => number,
  current: number,
): MapCell | undefined {
  let best: MapCell | undefined;
  let bestGap = current;
  let bestKey = '';
  for (const cell of cells) {
    if (!passable(cell.terrain)) {
      continue;
    }
    const gap = gapOf(cell);
    const key = rankKey(0, cell.col, cell.row);
    if (gap > bestGap || (best !== undefined && gap === bestGap && key < bestKey)) {
      best = cell;
      bestGap = gap;
      bestKey = key;
    }
  }
  return best;
}

/**
 * Template player: first applicable action in id order (total —
 * every input yields exactly one decision or null).
 */
export function simplePolicy(
  snapshot: WorldState,
  player: PlayerId,
  passable: PassableCheck,
): PolicyMove | null {
  const map = snapshot.map;
  if (map === undefined) {
    return null;
  }
  const stagger = map.stagger;
  const units = snapshot.units?.units ?? [];
  const mine = units.filter((unit) => unit.owner === player && unit.hp > 0).sort(byId);
  const foes = units.filter((unit) => unit.owner !== player && unit.hp > 0).sort(byId);
  const gapFrom = (col: number, row: number): number =>
    foes.length === 0
      ? 0
      : Math.min(
          ...foes.map((foe) =>
            axialDistance(
              offsetToAxial(col, row, stagger),
              offsetToAxial(foe.col, foe.row, stagger),
            ),
          ),
        );
  for (const unit of mine) {
    const adjacent = neighborsOf(map, unit.col, unit.row);
    const victims = foes.filter((foe) =>
      adjacent.some((cell) => cell.col === foe.col && cell.row === foe.row),
    );
    if (unit.hp <= CRITICAL_HP && victims.length > 0) {
      const escape = fleeStep(
        adjacent,
        passable,
        (cell) => gapFrom(cell.col, cell.row),
        gapFrom(unit.col, unit.row),
      );
      if (escape !== undefined) {
        return {
          type: MOVE_TRANSITION,
          payload: { id: unit.id, col: escape.col, row: escape.row },
        };
      }
    }
    if (victims.length > 0) {
      const victim = victims.reduce((alpha, beta) => (beta.hp < alpha.hp ? beta : alpha));
      return {
        type: ATTACK_TRANSITION,
        payload: { id: unit.id, target: victim.id },
      };
    }
    if (unit.type === 'worker') {
      const node = cellAt(map, unit.col, unit.row)?.resource;
      if (node !== undefined && node.amount > 0) {
        return { type: GATHER_TRANSITION, payload: { col: unit.col, row: unit.row } };
      }
      let target: MapCell | undefined;
      let targetKey = '';
      for (const cell of map.cells) {
        if (cell.resource === undefined || cell.resource.amount <= 0) {
          continue;
        }
        const key = rankKey(
          axialDistance(
            offsetToAxial(unit.col, unit.row, stagger),
            offsetToAxial(cell.col, cell.row, stagger),
          ),
          cell.col,
          cell.row,
        );
        if (target === undefined || key < targetKey) {
          target = cell;
          targetKey = key;
        }
      }
      if (target !== undefined) {
        const targetCell = target;
        const step = stepToward(adjacent, passable, (cell) =>
          axialDistance(
            offsetToAxial(cell.col, cell.row, stagger),
            offsetToAxial(targetCell.col, targetCell.row, stagger),
          ),
        );
        if (step !== undefined) {
          return {
            type: MOVE_TRANSITION,
            payload: { id: unit.id, col: step.col, row: step.row },
          };
        }
      }
    }
    const step = stepToward(adjacent, passable, (cell) => gapFrom(cell.col, cell.row));
    if (step !== undefined) {
      return { type: MOVE_TRANSITION, payload: { id: unit.id, col: step.col, row: step.row } };
    }
  }
  return null;
}
