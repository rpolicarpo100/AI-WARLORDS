import { freezeState, type PlayerId } from './authority.js';
import type { WorldState } from './world-state.js';

/** Full canonical state. SERVER-ONLY — never crosses the trust boundary. */
export type WorldView = WorldState;

export interface ClientView {
  readonly kind: 'client-view';
  readonly forPlayer: PlayerId;
  readonly state: WorldState;
}

export interface AiPerception {
  readonly kind: 'ai-perception';
  readonly forPlayer: PlayerId;
  /**
   * M004: known == everything the player seat can see. Fog (M015) and
   * inference UNKNOWN/INFERRED layers (M028) arrive in their own modules.
   */
  readonly known: WorldState;
}

export function toWorldView(state: WorldState): WorldView {
  // Identity by design: the engine operates on canonical state directly.
  // The function exists to mark SERVER-ONLY data at the boundary.
  return state;
}

function redactFor(state: WorldState, playerId: PlayerId): WorldState {
  // Clone first: freezing the redacted view must never freeze the caller's
  // objects through aliasing.
  const clone = structuredClone(state);
  const own = clone.secrets[playerId];
  const redacted: WorldState = {
    schemaVersion: clone.schemaVersion,
    tick: clone.tick,
    players: clone.players,
    secrets: own === undefined ? {} : { [playerId]: own },
  };
  return freezeState(redacted);
}

export function toClientView(state: WorldState, playerId: PlayerId): ClientView {
  const view: ClientView = {
    kind: 'client-view',
    forPlayer: playerId,
    state: redactFor(state, playerId),
  };
  return freezeState(view);
}

export function toAiPerception(state: WorldState, playerId: PlayerId): AiPerception {
  const view: AiPerception = {
    kind: 'ai-perception',
    forPlayer: playerId,
    known: redactFor(state, playerId),
  };
  return freezeState(view);
}
