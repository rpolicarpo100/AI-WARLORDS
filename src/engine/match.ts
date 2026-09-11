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
import {
  matchFinishedEvent,
  matchProducers,
  matchStartedEvent,
  runProducers,
  type EventProducer,
  type GameEvent,
} from './events.js';
import { hashState } from './hash.js';
import { MAX_UINT32 } from './rng.js';
import {
  createWorldValidator,
  noParamsRule,
  promptsAvailableRule,
  wrapWithValidation,
  type PreRule,
  type RngHandler,
} from './validation.js';
import {
  evaluateVictory,
  matchConditions,
  type Verdict,
  type VictoryCondition,
} from './victory.js';
import { isWorldState, worldHandlers, type WorldState } from './world-state.js';
import {
  buildParamsRule,
  buildStartedProducer,
  BUILD_TRANSITION,
  canAfford,
  cityHandlers,
  completeConstructions,
  completionProducer,
  createEconomyRule,
  DEFAULT_BUILDINGS_CONFIG,
  DEFAULT_ECONOMY_CONFIG,
  economyHandlers,
  gatherParamsRule,
  gatherProducer,
  GATHER_TRANSITION,
  isBuildingsConfig,
  isEconomyConfig,
  payCost,
  UPGRADE_TRANSITION,
} from './economy.js';
import type { TerrainId } from './map.js';
import { DEFAULT_TERRAIN_CONFIG, isTerrainConfig, modifiersFor } from './terrain.js';
import {
  ATTACK_TRANSITION,
  attackParamsRule,
  attackProducer,
  DEFAULT_UNITS_CONFIG,
  isUnitsConfig,
  MOVE_TRANSITION,
  moveParamsRule,
  moveProducer,
  TRAIN_TRANSITION,
  trainParamsRule,
  trainProducer,
  warfareHandlers,
  type UnitTreasury,
} from './warfare.js';
import { seedPrompts, spendPrompt } from './prompts.js';

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

/** Default per-player prompt budget (D-022: ~one 15-minute game). */
export const DEFAULT_PROMPTS_PER_PLAYER = 10;

export interface MatchRuleset {
  readonly id: 'standard';
  readonly version: typeof RULESET_VERSION;
}

const standardRuleset: MatchRuleset = { id: 'standard', version: RULESET_VERSION };
export const STANDARD_RULESET: MatchRuleset = freezeState(standardRuleset);

export interface TimelineEntry {
  readonly seq: number;
  readonly revision: number;
  readonly requestId: string;
  readonly playerId: string;
  readonly type: string;
  readonly applied: boolean;
  readonly detail: string;
  readonly stateHash: string;
}

export interface MatchInit {
  readonly matchId?: string;
  readonly seed: unknown;
  readonly ruleset: unknown;
  readonly players: readonly PlayerId[];
  readonly initialState: unknown;
  readonly promptsPerPlayer?: unknown;
  readonly extraHandlers?: ReadonlyMap<string, RngHandler<WorldState>>;
  readonly extraProducers?: ReadonlyMap<string, readonly EventProducer[]>;
  readonly extraConditions?: readonly VictoryCondition[];
  readonly economyConfig?: unknown;
  readonly buildingsConfig?: unknown;
  readonly terrainConfig?: unknown;
  readonly unitsConfig?: unknown;
}

export type MatchDispatchOutcome =
  DispatchOutcome | { readonly status: 'error'; readonly code: 'MATCH_FINISHED' };

/**
 * Deterministic match aggregate: provenance (id/seed/ruleset/players/
 * initial) + owned kernel + timeline (kernel log enriched with revision
 * and state hash, 1:1). The kernel never escapes: every dispatch flows through
 * `Match.dispatch`, which keeps the timeline coherent by construction.
 * M006 owns the registry: entries are validated at registration, and every
 * handler runs wrapped (pre-rules, per-dispatch RNG, post-invariants).
 * M007 emits domain facts: genesis on construction, producer facts on
 * applied outcomes (observation never breaks execution).
 * M008 judges terminal verdicts lazily and blocks post-finish dispatches.
 */
export class Match {
  readonly id: MatchId;
  readonly seed: Seed;
  readonly ruleset: MatchRuleset;
  readonly players: readonly PlayerId[];
  private readonly kernel: AuthorityKernel<WorldState>;
  private readonly timeline: TimelineEntry[] = [];
  private readonly producers: ReadonlyMap<string, readonly EventProducer[]>;
  private readonly events: GameEvent[] = [];
  private readonly conditions: readonly VictoryCondition[];

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
    let promptsPerPlayer: number;
    if (init.promptsPerPlayer === undefined) {
      promptsPerPlayer = DEFAULT_PROMPTS_PER_PLAYER;
    } else if (!isSeed(init.promptsPerPlayer) || init.promptsPerPlayer === 0) {
      throw new Error('Match: invalid promptsPerPlayer (expected positive uint32).');
    } else {
      promptsPerPlayer = init.promptsPerPlayer;
    }
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
    // PROMPTS: seed an absent budget (present slots are respected as-is).
    const seeded: WorldState =
      init.initialState.prompts === undefined
        ? { ...init.initialState, prompts: seedPrompts(init.players, promptsPerPlayer) }
        : init.initialState;
    const economyConfig = init.economyConfig ?? DEFAULT_ECONOMY_CONFIG;
    if (!isEconomyConfig(economyConfig)) {
      throw new Error('Match: invalid economy config.');
    }
    const buildingsConfig = init.buildingsConfig ?? DEFAULT_BUILDINGS_CONFIG;
    if (!isBuildingsConfig(buildingsConfig)) {
      throw new Error('Match: invalid buildings config.');
    }
    const terrainConfig = init.terrainConfig ?? DEFAULT_TERRAIN_CONFIG;
    if (!isTerrainConfig(terrainConfig)) {
      throw new Error('Match: invalid terrain config.');
    }
    const unitsConfig = init.unitsConfig ?? DEFAULT_UNITS_CONFIG;
    if (!isUnitsConfig(unitsConfig)) {
      throw new Error('Match: invalid units config.');
    }
    const world = worldHandlers();
    const economy = economyHandlers(economyConfig, buildingsConfig);
    const city = cityHandlers(buildingsConfig);
    // M022: passable = finite move cost (Infinity/NaN block, fail-closed).
    const passable = (terrain: string): boolean =>
      Number.isFinite(modifiersFor(terrainConfig, terrain as TerrainId).move);
    const defenseOf = (terrain: string): number =>
      modifiersFor(terrainConfig, terrain as TerrainId).defense;
    const treasury: UnitTreasury = {
      canAfford: (funds, holder, cost) => canAfford(funds, holder, cost),
      pay: (funds, holder, cost) => payCost(funds, holder, cost),
    };
    const warfare = warfareHandlers(passable, unitsConfig, defenseOf, treasury);
    const extra = init.extraHandlers ?? new Map<string, RngHandler<WorldState>>();
    const merged = new Map<string, RngHandler<WorldState>>([
      ...world,
      ...economy,
      ...city,
      ...warfare,
      ...extra,
    ]);
    if (merged.size !== world.size + economy.size + city.size + warfare.size + extra.size) {
      throw new Error('Match: duplicate handler names.');
    }
    const baseValidator = createWorldValidator();
    // M020: the economy post-rule closes over the match's validated
    // buildings config (composition 5 + 1 — the declared rewrite).
    const validator = {
      ...baseValidator,
      post: [...baseValidator.post, createEconomyRule(buildingsConfig)],
    };
    const noParamHandlers = new Set([...world.keys(), UPGRADE_TRANSITION]);
    const paramRules = new Map<string, PreRule>([
      [GATHER_TRANSITION, gatherParamsRule],
      [BUILD_TRANSITION, buildParamsRule],
      [MOVE_TRANSITION, moveParamsRule],
      [ATTACK_TRANSITION, attackParamsRule],
      [TRAIN_TRANSITION, trainParamsRule],
    ]);
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
      const paramRule = paramRules.get(name);
      let pre: readonly PreRule[];
      if (paramRule !== undefined) {
        pre = [promptsAvailableRule, paramRule, ...validator.pre];
      } else if (noParamHandlers.has(name)) {
        pre = [promptsAvailableRule, noParamsRule(name), ...validator.pre];
      } else {
        pre = [promptsAvailableRule, ...validator.pre];
      }
      const postStep = (_before: WorldState, caller: PlayerId, applied: WorldState): WorldState => {
        const prompts = spendPrompt(applied.prompts, caller);
        if (applied.cities === undefined) {
          return { ...applied, prompts };
        }
        const built = completeConstructions(applied.cities, applied.buildings, caller);
        return {
          ...applied,
          prompts,
          cities: built.cities,
          ...(built.buildings === undefined ? {} : { buildings: built.buildings }),
        };
      };
      validated.set(
        name,
        wrapWithValidation(handler, { ...validator, pre }, this.seed, nextSeq, postStep),
      );
    }
    const producers = new Map<string, readonly EventProducer[]>(matchProducers());
    producers.set(GATHER_TRANSITION, [gatherProducer]);
    producers.set(BUILD_TRANSITION, [buildStartedProducer]);
    producers.set(MOVE_TRANSITION, [moveProducer]);
    producers.set(ATTACK_TRANSITION, [attackProducer]);
    producers.set(TRAIN_TRANSITION, [trainProducer]);
    const extraProducers = init.extraProducers ?? new Map<string, readonly EventProducer[]>();
    // (PROMPTS) The completion producer rides every transition: domain
    // producers first, completions second, caller extras last.
    for (const name of validated.keys()) {
      producers.set(name, [...(producers.get(name) ?? []), completionProducer]);
    }
    const orderedExtras: Array<[string, readonly EventProducer[]]> = [...extraProducers];
    for (const [name, extra] of orderedExtras) {
      producers.set(name, [...(producers.get(name) ?? []), ...extra]);
    }
    this.producers = producers;
    const extraConditions: readonly VictoryCondition[] = init.extraConditions ?? [];
    this.conditions = [...extraConditions, ...matchConditions()];
    this.players = freezeState([...init.players]);
    this.kernel = new AuthorityKernel<WorldState>({
      players: init.players,
      initialState: seeded,
      handlers: validated,
    });
    const initialMap = seeded.map;
    this.events.push(
      matchStartedEvent(
        this.seed,
        this.players,
        this.ruleset,
        initialMap === undefined
          ? undefined
          : { id: initialMap.id, version: initialMap.schemaVersion },
      ),
    );
    const genesis = evaluateVictory(this.conditions, {
      state: seeded,
      revision: 0,
    });
    if (genesis.status === 'finished') {
      this.events.push(
        matchFinishedEvent(genesis.outcome, genesis.condition, 0, this.events.length + 1),
      );
    }
    Object.freeze(this);
  }

  join(playerId: PlayerId): SessionHandle {
    return this.kernel.join(playerId);
  }

  /**
   * Runs one request through the kernel + producers + victory check.
   * @throws on engine faults (victory evaluation) — fail-stop loud.
   * Transport (M069) must treat throws as faults, never as outcomes.
   */
  dispatch(session: SessionHandle, raw: Untrusted<ClientRequest>): MatchDispatchOutcome {
    if (this.getVerdict().status === 'finished') {
      return { status: 'error', code: 'MATCH_FINISHED' };
    }
    const before = this.kernel.getSnapshot();
    const outcome = this.kernel.dispatch(session, raw);
    try {
      if (outcome.status === 'applied') {
        // Kernel-accepted ⟹ well-formed: type/params below passed envelope
        // validation inside `kernel.dispatch` (this cast documents the seam).
        const validated = raw as ClientRequest;
        const after = this.kernel.getSnapshot();
        // Total lookup: kernel-accepted ⟹ registered ⟹ the universal
        // loop added an entry (same-keys proof as the cast above).
        const producers = this.producers.get(validated.type) as readonly EventProducer[];
        const emitted = runProducers(
          {
            type: validated.type,
            caller: session.playerId,
            params: validated.payload,
            before,
            after,
          },
          producers,
          outcome.revision,
          this.events.length + 1,
        );
        this.events.push(...emitted);
        const verdict = evaluateVictory(this.conditions, {
          state: after,
          revision: outcome.revision,
        });
        if (verdict.status === 'finished') {
          this.events.push(
            matchFinishedEvent(
              verdict.outcome,
              verdict.condition,
              outcome.revision,
              this.events.length + 1,
            ),
          );
        }
      }
    } finally {
      this.syncTimeline();
    }
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

  getStateHash(): string {
    return hashState(this.kernel.getSnapshot());
  }

  getTimeline(): readonly TimelineEntry[] {
    return [...this.timeline];
  }

  getEvents(): readonly GameEvent[] {
    return [...this.events];
  }

  getVerdict(): Verdict {
    const snapshot = this.kernel.getSnapshot();
    return evaluateVictory(this.conditions, {
      state: snapshot,
      revision: this.kernel.getRevision(),
    });
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
