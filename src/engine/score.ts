/**
 * M067 — Arena scoring (LAYER L2, pure).
 *
 * Third of the AI Arena block (M065–M068, D-061): scorePlayer reads
 * one snapshot and scores one holder — living flesh (hp) + wealth
 * (stockpile) + cities (level sum) + buildings (count sum), v1
 * weights all-ones (no tuned constants without data). Missing
 * sections and missing holders score zero; corpses (hp <= 0) and
 * foreign flesh never count. rankPlayers orders a roster by score
 * (ties by id); scoreTable scores a whole roster at once (the
 * selfplay runner reports it). Derived, never stored — scores
 * survive replay for free. Victory/draws untouched (score-decided
 * wins would ripple M060 + the gate — a future module's call).
 * LAYER L2 (type-only authority L0 + world-state L1, downward).
 */
import type { PlayerId } from './authority.js';
import type { WorldState } from './world-state.js';

/** One holder's arena score (v1 all-ones weights, total). */
export function scorePlayer(state: WorldState, player: PlayerId): number {
  let score = 0;
  for (const unit of state.units?.units ?? []) {
    if (unit.owner === player && unit.hp > 0) {
      score += unit.hp;
    }
  }
  const stock = state.stockpiles?.stockpiles[player];
  if (stock !== undefined) {
    score += stock.food + stock.wood + stock.stone + stock.gold;
  }
  const city = state.cities?.cities[player];
  if (city !== undefined) {
    score += city.level;
  }
  const buildings = state.buildings?.buildings[player];
  if (buildings !== undefined) {
    for (const count of Object.values(buildings)) {
      score += count;
    }
  }
  return score;
}

/** Whole-roster scores in one pass (selfplay reports this). */
export function scoreTable(
  state: WorldState,
  players: readonly PlayerId[],
): Readonly<Record<PlayerId, number>> {
  return Object.fromEntries(
    players.map((player) => [player, scorePlayer(state, player)]),
  ) as Readonly<Record<PlayerId, number>>;
}

/** Roster ordered by score (descending, ties by id). */
export function rankPlayers(state: WorldState, players: readonly PlayerId[]): PlayerId[] {
  return [...players].sort(
    (alpha, beta) =>
      scorePlayer(state, beta) - scorePlayer(state, alpha) || alpha.localeCompare(beta),
  );
}
