/**
 * M065 — Self-play policy brain (LAYER L3, pure).
 *
 * First of the AI Arena block (M065–M068, D-059, voted self-play):
 * simplePolicy is a deterministic template player (no LLM, no RNG)
 * that reads one snapshot and emits one dispatch envelope (or null
 * when no unit can act). Priorities per own unit (id order): attack
 * an adjacent foe (any type — workers brawl too), gather when a
 * worker stands on a live node, else step toward the nearest foe
 * (axial-greedy over passable neighbors, ties by col/row) or patrol
 * (first passable neighbor when no foes live). Passability is
 * injected (M045 mold — configs live above; Match binds its own).
 * Simple-minded by design (approach jitters, patrols wander —
 * every applied lance spends, so matches still end); M066+ grows
 * smarter brains behind the same signature. LAYER L3 (imports
 * warfare/economy L2 values + map L0 + authority L0 + world-state
 * L1 type-only, all downward).
 */
import type { PlayerId } from './authority.js';
import { GATHER_TRANSITION } from './economy.js';
import { axialDistance, cellAt, neighborsOf, offsetToAxial } from './map.js';
import { ATTACK_TRANSITION, MOVE_TRANSITION } from './warfare.js';
import type { WorldState } from './world-state.js';

/** One policy decision: a dispatch envelope, or null when idle. */
export interface PolicyMove {
  readonly type: string;
  readonly payload: unknown;
}

/** Injected terrain check (Match binds terrainPassable). */
export type PassableCheck = (terrain: string) => boolean;

function byId(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id.localeCompare(b.id);
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
  const units = snapshot.units?.units ?? [];
  const mine = units.filter((unit) => unit.owner === player && unit.hp > 0).sort(byId);
  const foes = units.filter((unit) => unit.owner !== player && unit.hp > 0).sort(byId);
  for (const unit of mine) {
    const adjacent = neighborsOf(map, unit.col, unit.row);
    const victim = foes.find((foe) =>
      adjacent.some((cell) => cell.col === foe.col && cell.row === foe.row),
    );
    if (victim !== undefined) {
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
    }
    let best: { readonly col: number; readonly row: number } | undefined;
    let bestKey = '';
    for (const cell of adjacent) {
      if (!passable(cell.terrain)) {
        continue;
      }
      const reach =
        foes.length === 0
          ? 0
          : Math.min(
              ...foes.map((foe) =>
                axialDistance(
                  offsetToAxial(cell.col, cell.row, map.stagger),
                  offsetToAxial(foe.col, foe.row, map.stagger),
                ),
              ),
            );
      const key = `${String(reach).padStart(4, '0')}:${String(cell.col).padStart(4, '0')},${String(cell.row).padStart(4, '0')}`;
      if (best === undefined || key < bestKey) {
        best = cell;
        bestKey = key;
      }
    }
    if (best !== undefined) {
      return { type: MOVE_TRANSITION, payload: { id: unit.id, col: best.col, row: best.row } };
    }
  }
  return null;
}
