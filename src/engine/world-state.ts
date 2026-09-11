import { isPlayerId, type PlayerId, type TransitionHandler } from './authority.js';
import { isBuildingsData, type BuildingsData } from './buildings.js';
import { isCitiesData, type CitiesData } from './city.js';
import { isExploredData, type ExploredData } from './explored.js';
import { isMapData, type MapData } from './map.js';
import { isStockpilesData, type StockpilesData } from './stockpiles.js';

export const WORLD_SCHEMA_VERSION = 1;

export interface WorldPlayer {
  readonly id: PlayerId;
}

export interface WorldState {
  readonly schemaVersion: typeof WORLD_SCHEMA_VERSION;
  /** World clock field. M004 never advances it — time progression belongs to M005+. */
  readonly tick: number;
  readonly players: readonly WorldPlayer[];
  /**
   * World geography (M010, optional compatible extension — no version bump).
   * Absent in abstract/proof matches; present matches carry validated MapData.
   * WORLD views see it; AI/CLIENT views are map-blind by construction
   * (`redactFor` builds explicitly) until fog/perception arrive (M013/M015).
   */
  readonly map?: MapData;
  /**
   * Per-viewer explored-cell memory (M014, optional compatible extension).
   * Requires the map (coherence, one direction — explored⇒map); indices
   * bounds-checked against it. Monotonic under post-invariants; consumed
   * by views (M015).
   */
  readonly explored?: ExploredData;
  /**
   * Per-holder resource stores (M016, optional compatible extension).
   * Map-independent (abstract matches may hold stockpiles); holders are
   * shape-checked only — membership enforced at consumption (M014
   * doctrine; non-roster holders stay invisible, fail-closed).
   */
  readonly stockpiles?: StockpilesData;
  /**
   * Per-holder building counts (M018, optional compatible extension).
   * Map-independent; holders shape-checked only (M014 doctrine).
   * Counts are static data until M019 construction transitions.
   */
  readonly buildings?: BuildingsData;
  /**
   * Per-holder cities (M019, optional compatible extension).
   * Map-independent; holders shape-checked only (M014 doctrine).
   * Cities materialize on first build/upgrade; init-placed allowed.
   */
  readonly cities?: CitiesData;
}

export interface WorldStateInit {
  readonly players: readonly PlayerId[];
  readonly tick?: number;
  readonly map?: MapData;
  readonly explored?: ExploredData;
  readonly stockpiles?: StockpilesData;
  readonly buildings?: BuildingsData;
  readonly cities?: CitiesData;
}

/**
 * Single-path schema guard: the ONLY definition of "valid world".
 * `createWorldState` builds through it; future loaders (M010+) validate with it.
 */
export function isWorldState(value: unknown): value is WorldState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  if (fields['schemaVersion'] !== WORLD_SCHEMA_VERSION) {
    return false;
  }
  const tick = fields['tick'];
  if (typeof tick !== 'number' || !Number.isInteger(tick) || tick < 0) {
    return false;
  }
  const players = fields['players'];
  if (!Array.isArray(players) || players.length === 0) {
    return false;
  }
  const seenIds = new Set<unknown>();
  for (const entry of players) {
    if (typeof entry !== 'object' || entry === null) {
      return false;
    }
    const id = (entry as Record<string, unknown>)['id'];
    if (!isPlayerId(id)) {
      return false;
    }
    if (seenIds.has(id)) {
      return false;
    }
    seenIds.add(id);
  }
  const map = fields['map'];
  if (map !== undefined && !isMapData(map)) {
    return false;
  }
  const explored = fields['explored'];
  if (explored !== undefined) {
    if (map === undefined || !isExploredData(explored)) {
      return false;
    }
    const limit = map.width * map.height;
    for (const indices of Object.values(explored.viewers)) {
      for (const index of indices) {
        if (index >= limit) {
          return false;
        }
      }
    }
  }
  const stockpiles = fields['stockpiles'];
  if (stockpiles !== undefined && !isStockpilesData(stockpiles)) {
    return false;
  }
  const buildings = fields['buildings'];
  if (buildings !== undefined && !isBuildingsData(buildings)) {
    return false;
  }
  const cities = fields['cities'];
  if (cities !== undefined && !isCitiesData(cities)) {
    return false;
  }
  return true;
}

export function createWorldState(init: WorldStateInit): WorldState {
  const candidate = {
    schemaVersion: WORLD_SCHEMA_VERSION,
    tick: init.tick ?? 0,
    players: init.players.map((id) => ({ id })),
    ...(init.map === undefined ? {} : { map: init.map }),
    ...(init.explored === undefined ? {} : { explored: init.explored }),
    ...(init.stockpiles === undefined ? {} : { stockpiles: init.stockpiles }),
    ...(init.buildings === undefined ? {} : { buildings: init.buildings }),
    ...(init.cities === undefined ? {} : { cities: init.cities }),
  };
  if (!isWorldState(candidate)) {
    throw new Error('createWorldState: invalid initial world.');
  }
  return candidate;
}

/**
 * M004 registers plumbing only. ALL mutating transitions arrive with their
 * domain modules (M005+). If you are tempted to add a mutation here, it
 * belongs to a domain module — see the scope fence in docs/modules/M004.md.
 */
export function worldHandlers(): Map<string, TransitionHandler<WorldState>> {
  const entries: Array<[string, TransitionHandler<WorldState>]> = [
    ['world.noop', (ctx) => ({ applied: true, state: ctx.state, summary: 'world-noop' })],
  ];
  return new Map(entries);
}
