import { freezeState, type PlayerId } from './authority.js';
import { countsOf, type BuildingCounts } from './buildings.js';
import { cityOf, type CityState } from './city.js';
import { commandersOf, type CommanderRecord } from './commanders.js';
import { isCellIndex } from './explored.js';
import type { TerrainId } from './map.js';
import { promptsOf } from './prompts.js';
import { stockpileOf, type StockpileAmounts } from './stockpiles.js';
import { unitsOf, type UnitInstance } from './units.js';
import type { WorldPlayer, WorldState } from './world-state.js';

/** Full canonical state. SERVER-ONLY — never crosses the trust boundary. */
export type WorldView = WorldState;

/**
 * Visibility input: structural twin of fog.VisibilityResult /
 * exploration.VisibilitySets (an L2→L2 edge is forbidden; feeding
 * computeVisibility output into perceive is proven by integration test).
 */
export type VisibilityInput = { readonly [viewer: string]: readonly number[] };

export interface PerceivedMap {
  readonly width: number;
  readonly height: number;
  /**
   * Visible cell index → terrain (sparse; explored-only cells expose
   * position in `explored` + remembered terrain in `inferred` —
   * M028 closes L-29).
   */
  readonly visible: { readonly [index: number]: TerrainId };
  /** Explored-but-not-visible indices (canonical; unexplored = absent). */
  readonly explored: readonly number[];
  /**
   * Remembered terrain for explored-but-not-visible cells (M028
   * inference; terrain is immutable so memory == current; OOB memory
   * skipped soft — D-006). Disjoint from visible by construction.
   */
  readonly inferred: { readonly [index: number]: TerrainId };
}

export interface PerceivedState {
  /**
   * Own remaining prompts (PROMPTS; 0 when absent). Other holders'
   * budgets stay out — fail-closed (no owning module for foe intel).
   */
  readonly prompts: number;
  /** Roster is public (no roster-fog until an owning module exists). */
  readonly players: readonly WorldPlayer[];
  readonly viewer: PlayerId;
  /** Currently-visible indices (canonical ascending unique). */
  readonly visibleCells: readonly number[];
  /** Full explored memory, visible-or-not (M014 semantics preserved). */
  readonly exploredCells: readonly number[];
  /**
   * Own stockpile (M016; zeros when absent). Other holders' stores stay
   * out — enemy intel is fail-closed until an owning module (M028+).
   */
  readonly stockpile: StockpileAmounts;
  /**
   * Own building counts (M018; zeros when absent). Other holders'
   * buildings stay out — fail-closed until an owning module (M028+).
   */
  readonly buildings: BuildingCounts;
  /**
   * Own city (M019; virtual level-1 idle when absent). Other holders'
   * cities stay out — fail-closed until an owning module (M028+).
   */
  readonly city: CityState;
  /**
   * Own units (M021; [] when absent). Other holders' units stay out —
   * fail-closed until an owning module (M028+; enemy scout is vision).
   */
  readonly units: readonly UnitInstance[];
  /**
   * Own commanders (M027; [] when absent). Other holders' commanders
   * stay out — fail-closed until an owning module (M028+).
   */
  readonly commanders: readonly CommanderRecord[];
  /** Absent when the world is mapless (no map context ⇒ no cells). */
  readonly map?: PerceivedMap;
}

export interface ClientView {
  readonly kind: 'client-view';
  readonly forPlayer: PlayerId;
  readonly state: PerceivedState;
}

export interface AiPerception {
  readonly kind: 'ai-perception';
  readonly forPlayer: PlayerId;
  /**
   * M015: known == knowledge-compatible state (mestre #10): what the
   * viewer sees now + remembers. INFERRED/UNKNOWN layers arrive in M028.
   */
  readonly known: PerceivedState;
}

export function toWorldView(state: WorldState): WorldView {
  // Identity by design: the engine operates on canonical state directly.
  // The function exists to mark SERVER-ONLY data at the boundary.
  return state;
}

/**
 * Builds one viewer's knowledge: current sight filtered by the map,
 * plus explored memory. Membership is enforced loud (unknown viewer =
 * programmer error — L-27 closes here, at consumption). Structural
 * input validated loud; positional context stays soft (D-006 levels).
 */
export function perceive(
  state: WorldState,
  viewer: PlayerId,
  visibility: VisibilityInput = {},
): PerceivedState {
  if (!state.players.some((player) => player.id === viewer)) {
    throw new Error('perceive: unknown viewer.');
  }
  if (typeof visibility !== 'object' || visibility === null || Array.isArray(visibility)) {
    throw new Error('perceive: invalid visibility.');
  }
  const seen = visibility[viewer] ?? [];
  if (!Array.isArray(seen)) {
    throw new Error('perceive: invalid visibility.');
  }
  for (const index of seen) {
    if (!isCellIndex(index)) {
      throw new Error('perceive: invalid visibility.');
    }
  }
  const map = state.map;
  const limit = map === undefined ? 0 : map.width * map.height;
  const visibleCells =
    map === undefined
      ? []
      : [...new Set(seen.filter((index) => index < limit))].sort((a, b) => a - b);
  const memory = map === undefined ? [] : (state.explored?.viewers[viewer] ?? []);
  const visibleSet = new Set(visibleCells);
  // Fresh containers first: freezing the view must never freeze the
  // caller's objects through aliasing (copies below, never live refs).
  const visible: Record<number, TerrainId> = {};
  const explored: number[] = [];
  const inferred: Record<number, TerrainId> = {};
  if (map !== undefined) {
    let position = 0;
    for (const cell of map.cells) {
      if (visibleSet.has(position)) {
        visible[position] = cell.terrain;
      }
      position += 1;
    }
    for (const index of memory) {
      if (!visibleSet.has(index)) {
        explored.push(index);
        const cell = map.cells[index];
        if (cell !== undefined) {
          inferred[index] = cell.terrain;
        }
      }
    }
  }
  const perceived: PerceivedState = {
    prompts: promptsOf(state.prompts, viewer),
    players: [...state.players],
    viewer,
    visibleCells,
    exploredCells: [...memory],
    stockpile: stockpileOf(state.stockpiles, viewer),
    buildings: countsOf(state.buildings, viewer),
    city: cityOf(state.cities, viewer),
    units: unitsOf(state.units, viewer),
    commanders: commandersOf(state.commanders, viewer),
    ...(map === undefined
      ? {}
      : { map: { width: map.width, height: map.height, visible, explored, inferred } }),
  };
  return freezeState(perceived);
}

export function toClientView(
  state: WorldState,
  playerId: PlayerId,
  visibility: VisibilityInput = {},
): ClientView {
  const view: ClientView = {
    kind: 'client-view',
    forPlayer: playerId,
    state: perceive(state, playerId, visibility),
  };
  return freezeState(view);
}

export function toAiPerception(
  state: WorldState,
  playerId: PlayerId,
  visibility: VisibilityInput = {},
): AiPerception {
  const view: AiPerception = {
    kind: 'ai-perception',
    forPlayer: playerId,
    known: perceive(state, playerId, visibility),
  };
  return freezeState(view);
}
