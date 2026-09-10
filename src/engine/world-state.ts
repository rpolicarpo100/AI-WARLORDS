import { isPlayerId, type PlayerId, type TransitionHandler } from './authority.js';

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
   * Opaque per-player secret store — M004 MECHANISM PLACEHOLDER.
   * Exists ONLY to prove WORLD/AI/CLIENT view separation with real
   * redaction. Real hidden data (fog-hidden tiles, unseen units, …)
   * arrives in M010/M015+; this store itself may be removed then.
   */
  readonly secrets: { readonly [playerId: string]: readonly string[] };
}

export interface WorldStateInit {
  readonly players: readonly PlayerId[];
  readonly secrets?: { readonly [playerId: string]: readonly string[] };
  readonly tick?: number;
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
  const secrets = fields['secrets'];
  if (typeof secrets !== 'object' || secrets === null || Array.isArray(secrets)) {
    return false;
  }
  const entries = Object.entries(secrets as Record<string, unknown>);
  for (const [id, list] of entries) {
    if (!isPlayerId(id)) {
      return false;
    }
    if (!Array.isArray(list)) {
      return false;
    }
    for (const item of list) {
      if (typeof item !== 'string') {
        return false;
      }
    }
  }
  return true;
}

export function createWorldState(init: WorldStateInit): WorldState {
  const candidate = {
    schemaVersion: WORLD_SCHEMA_VERSION,
    tick: init.tick ?? 0,
    players: init.players.map((id) => ({ id })),
    secrets: init.secrets ?? {},
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
