import { randomUUID } from 'node:crypto';
import {
  AuthorityKernel,
  freezeState,
  isPlayerId,
  MAX_ID_LENGTH,
  type AppliedEntry,
  type ClientRequest,
  type DispatchOutcome,
  type PlayerId,
  type SessionHandle,
  type TransitionHandler,
  type Untrusted,
} from './authority.js';
import { hashState } from './hash.js';
import { MAX_UINT32 } from './rng.js';
import {
  createWorldValidator,
  noParamsRule,
  wrapWithValidation,
  type RngHandler,
} from './validation.js';
import { isWorldState, worldHandlers, type WorldState } from './world-state.js';

declare const matchBrand: unique symbol;
declare const seedBrand: unique symbol;

export type MatchId = string & { readonly [matchBrand]: 'match' };
export type Seed = number & { readonly [seedBrand]: 'seed' };

export function isMatchId(value: unknown): value is MatchId {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_ID_LENGTH;
}

export function createMatchId(): MatchId {
  return randomUUID() as MatchId;
}

export function isSeed(value: unknown): value is Seed {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_UINT32;
}

export const RULESET_VERSION = 1;

export interface MatchRuleset {
  readonly id: 'standard';
  readonly version: typeof RULESET_VERSION;
}

const standardRuleset: MatchRuleset = { id: 'standard', version: RULESET_VERSION };
export const STANDARD_RULESET: MatchRuleset = freezeState(standardRuleset);

export interface TimelineEntry {
  readonly seq: number;
  readonly revision: number;
  readonly tick: number;
  readonly requestId: string;
  readonly playerId: string;
  readonly type: string;
  readonly applied: boolean;
  readonly detail: string;
  readonly stateHash: string;
}

/**
 * M005 registers time progression only. Domain transitions arrive with
 * their modules (via `extraHandlers`). Payload is deliberately ignored by
 * the handler itself; M006 rejects non-empty payloads to built-ins via the
 * no-params pre-rule (fail loud on caller mistakes).
 */
export function matchHandlers(): Map<string, RngHandler<WorldState>> {
  const entries: Array<[string, RngHandler<WorldState>]> = [
    [
      'match.advance',
      (ctx) => {
        const next = ctx.state.tick + 1;
        return {
          applied: true,
          state: { ...ctx.state, tick: next },
          summary: `tick=${next}`,
        };
      },
    ],
  ];
  return new Map(entries);
}

export interface MatchInit {
  readonly matchId?: string;
  readonly seed: unknown;
  readonly ruleset: unknown;
  readonly players: readonly PlayerId[];
  readonly initialState: unknown;
  readonly extraHandlers?: ReadonlyMap<string, RngHandler<WorldState>>;
}

/**
 * Deterministic match aggregate: provenance (id/seed/ruleset/players/
 * initial) + owned kernel + timeline (kernel log enriched with tick and
 * state hash, 1:1). The kernel never escapes: every dispatch flows through
 * `Match.dispatch`, which keeps the timeline coherent by construction.
 * M006 owns the registry: entries are validated at registration, and every
 * handler runs wrapped (pre-rules, per-dispatch RNG, post-invariants).
 */
export class Match {
  readonly id: MatchId;
  readonly seed: Seed;
  readonly ruleset: MatchRuleset;
  readonly players: readonly PlayerId[];
  private readonly kernel: AuthorityKernel<WorldState>;
  private readonly timeline: TimelineEntry[] = [];

  constructor(init: MatchInit) {
    if (init.matchId === undefined) {
      this.id = createMatchId();
    } else if (!isMatchId(init.matchId)) {
      throw new Error('Match: invalid matchId.');
    } else {
      this.id = init.matchId;
    }
    if (!isSeed(init.seed)) {
      throw new Error('Match: invalid seed (expected uint32).');
    }
    this.seed = init.seed;
    const ruleset = init.ruleset;
    if (typeof ruleset !== 'object' || ruleset === null) {
      throw new Error('Match: invalid ruleset (not an object).');
    }
    const fields = ruleset as Record<string, unknown>;
    if (fields['id'] !== 'standard') {
      throw new Error('Match: unknown ruleset id.');
    }
    if (fields['version'] !== RULESET_VERSION) {
      throw new Error(`Match: unsupported ruleset version (engine: ${RULESET_VERSION}).`);
    }
    const matchRuleset: MatchRuleset = { id: 'standard', version: RULESET_VERSION };
    this.ruleset = freezeState(matchRuleset);
    for (const id of init.players) {
      if (!isPlayerId(id)) {
        throw new Error('Match: invalid player id in roster.');
      }
    }
    if (!isWorldState(init.initialState)) {
      throw new Error('Match: invalid initialState.');
    }
    // Provenance coherence: the dispatch roster must equal the world roster
    // (every session maps to a world player; spectators use read-only views).
    const stateIds = new Set<unknown>(init.initialState.players.map((p) => p.id));
    if (stateIds.size !== init.players.length || !init.players.every((id) => stateIds.has(id))) {
      throw new Error('Match: roster does not match initialState players.');
    }
    const world = worldHandlers();
    const match = matchHandlers();
    const extra = init.extraHandlers ?? new Map<string, RngHandler<WorldState>>();
    const merged = new Map<string, RngHandler<WorldState>>([...world, ...match, ...extra]);
    if (merged.size !== world.size + match.size + extra.size) {
      throw new Error('Match: duplicate handler names.');
    }
    const validator = createWorldValidator();
    const builtins = new Set([...world.keys(), ...match.keys()]);
    let dispatchCount = 0;
    const nextSeq = (): number => {
      dispatchCount += 1;
      return dispatchCount;
    };
    const validated = new Map<string, TransitionHandler<WorldState>>();
    for (const [name, handler] of merged) {
      if (name.length === 0 || typeof handler !== 'function') {
        throw new Error('Match: invalid handler registration.');
      }
      const pre = builtins.has(name) ? [noParamsRule(name), ...validator.pre] : validator.pre;
      validated.set(name, wrapWithValidation(handler, { ...validator, pre }, this.seed, nextSeq));
    }
    this.players = freezeState([...init.players]);
    this.kernel = new AuthorityKernel<WorldState>({
      players: init.players,
      initialState: init.initialState,
      handlers: validated,
    });
    Object.freeze(this);
  }

  join(playerId: PlayerId): SessionHandle {
    return this.kernel.join(playerId);
  }

  dispatch(session: SessionHandle, raw: Untrusted<ClientRequest>): DispatchOutcome {
    const outcome = this.kernel.dispatch(session, raw);
    this.syncTimeline();
    return outcome;
  }

  getSnapshot(): WorldState {
    return this.kernel.getSnapshot();
  }

  getLog(): readonly AppliedEntry[] {
    return this.kernel.getLog();
  }

  getRevision(): number {
    return this.kernel.getRevision();
  }

  getTick(): number {
    return this.kernel.getSnapshot().tick;
  }

  getStateHash(): string {
    return hashState(this.kernel.getSnapshot());
  }

  getTimeline(): readonly TimelineEntry[] {
    return [...this.timeline];
  }

  private syncTimeline(): void {
    const fresh = this.kernel.getLog().slice(this.timeline.length);
    if (fresh.length === 0) {
      return;
    }
    const snapshot = this.kernel.getSnapshot();
    const stateHash = hashState(snapshot);
    for (const entry of fresh) {
      const timelineEntry: TimelineEntry = {
        seq: this.timeline.length + 1,
        revision: entry.revision,
        tick: snapshot.tick,
        requestId: entry.requestId,
        playerId: entry.playerId,
        type: entry.type,
        applied: entry.applied,
        detail: entry.detail,
        stateHash,
      };
      this.timeline.push(freezeState(timelineEntry));
    }
  }
}
