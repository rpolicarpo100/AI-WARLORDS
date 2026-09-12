import { randomUUID } from 'node:crypto';
import {
  AuthorityKernel,
  freezeState,
  isPlayerId,
  markUntrusted,
  MAX_ID_LENGTH,
  type AppliedEntry,
  type ClientRequest,
  type DispatchOutcome,
  type PlayerId,
  type RequestId,
  type SessionHandle,
  type TransitionHandler,
  type Untrusted,
} from './authority.js';
import { assessPlayer, type PlayerAssessment, type StatsOf } from './assessment.js';
import { createAiAssessmentProducer } from './ai-events.js';
import { commandersOf } from './commanders.js';
import {
  matchFinishedEvent,
  matchProducers,
  matchStartedEvent,
  runProducers,
  type EventProducer,
  type GameEvent,
} from './events.js';
import { EXPLORED_SCHEMA_VERSION } from './explored.js';
import { discoveredProducer, markExplored, spottedFacts } from './exploration.js';
import { computeVisibility, sourcesOf } from './fog.js';
import { hashState } from './hash.js';
import { MAX_UINT32 } from './rng.js';
import {
  createWorldValidator,
  noParamsRule,
  promptsAvailableRule,
  promptsRule,
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
import { scoreTable } from './score.js';
import { scoreSuperiorCondition } from './victory-score.js';
import type { PassableCheck, PolicyMove } from './selfplay.js';
import { isWorldState, worldHandlers, type WorldState } from './world-state.js';
import {
  buildParamsRule,
  buildStartedProducer,
  BUILD_TRANSITION,
  canAfford,
  cityHandlers,
  completeConstructions,
  completionProducer,
  costOf,
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
  type BuildingsConfig,
} from './economy.js';
import {
  ACTIVATE_TRANSITION,
  commissionedProducer,
  COMMISSION_TRANSITION,
  commanderHandlers,
  commanderIdParamsRule,
  DEACTIVATE_TRANSITION,
  stateFlipProducer,
} from './commander-state.js';
import {
  CLEAR_TRANSITION,
  clearParamsRule,
  directiveClearedProducer,
  directiveSetProducer,
  directiveStateHandlers,
  SET_TRANSITION,
  setParamsRule,
} from './directive-state.js';
import {
  APPROVE_TRANSITION,
  AUTOAPPROVE_TRANSITION,
  AUTOFILE_TRANSITION,
  DECLINE_TRANSITION,
  PROPOSE_TRANSITION,
  proposalApprovedProducer,
  proposalDeclinedProducer,
  proposalProposedProducer,
  proposalStateHandlers,
  proposeParamsRule,
} from './proposal-state.js';
import {
  CANCEL_TRANSITION,
  ISSUE_TRANSITION,
  issueParamsRule,
  orderCanceledProducer,
  orderHandlers,
  orderIssuedProducer,
} from './order-state.js';
import {
  createOrderExecutedProducer,
  EXECUTE_TRANSITION,
  orderExecutionHandlers,
  type OrderSubProducer,
} from './order-execution.js';
import {
  OVERRIDE_TRANSITION,
  orderOverriddenProducer,
  orderOverrideHandlers,
  overrideParamsRule,
} from './order-override.js';
import { isMemorableKind } from './memories.js';
import { recallMemories, type Recollection, type StreamLookup } from './memory-recall.js';
import { memoryRecordHandlers, RECORD_TRANSITION, recordParamsRule } from './memory-record.js';
import type { TerrainId } from './map.js';
import {
  DEFAULT_TERRAIN_CONFIG,
  isTerrainConfig,
  modifiersFor,
  type TerrainConfig,
} from './terrain.js';
import {
  ATTACK_TRANSITION,
  attackParamsRule,
  attackProducer,
  DEFAULT_UNITS_CONFIG,
  isUnitsConfig,
  maxHpOf,
  MOVE_TRANSITION,
  moveParamsRule,
  moveProducer,
  TRAIN_TRANSITION,
  trainParamsRule,
  trainProducer,
  unitCostOf,
  unitDamageOf,
  warfareHandlers,
  type UnitsConfig,
  type UnitTreasury,
} from './warfare.js';
import { seedPrompts, spendPrompt } from './prompts.js';
import { postureOf, type ArmyPosture } from './posture.js';
import {
  STANCE_BATTLE_KINDS,
  STANCE_FAILURE_KINDS,
  stanceOf,
  stanceWithRecall,
  type CommanderStance,
} from './stance.js';
import { isUnitType, type UnitType } from './units.js';
import { isBuildingId } from './buildings.js';
import { confidenceOfOrder, type ConfidenceRules, type OrderConfidence } from './confidence.js';
import {
  rankCandidates,
  whatIfConfidence,
  whatIfScript,
  type CandidateRanking,
  type CounterfactualDeps,
  type HypotheticalOrder,
  type WhatIfConfidence,
  type WhatIfScript,
} from './counterfactual.js';

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

/** M065 extraction (behavior-identical): finite move cost passes. */
export function terrainPassable(terrainConfig: TerrainConfig, terrain: string): boolean {
  return Number.isFinite(modifiersFor(terrainConfig, terrain as TerrainId).move);
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

/**
 * M062 — one journaled lance: the full envelope plus its verbatim
 * outcome (the kernel log carries no payloads, so redrive is
 * impossible without this). Payload stored by reference (M063
 * serializes on export); sessionPlayer replays forgeries exactly;
 * post-finish no-ops never journal.
 */
export interface JournalEntry {
  readonly requestId: RequestId;
  readonly playerId: PlayerId;
  readonly sessionPlayer: PlayerId;
  readonly type: string;
  readonly payload: unknown;
  readonly outcome: MatchDispatchOutcome;
}

/** M065 — template player signature (brains behind one seam). */
export type SelfplayPolicy = (
  snapshot: WorldState,
  player: PlayerId,
  passable: PassableCheck,
) => PolicyMove | null;

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
  private readonly unitsConfig: UnitsConfig;
  private readonly buildingsConfig: BuildingsConfig;
  private readonly terrainConfig: TerrainConfig;
  private readonly domainHandlers: ReadonlyMap<string, TransitionHandler<WorldState>>;
  private readonly domainRules: ReadonlyMap<string, PreRule>;
  private readonly timeline: TimelineEntry[] = [];
  private readonly journal: JournalEntry[] = [];
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
    this.unitsConfig = unitsConfig;
    this.buildingsConfig = buildingsConfig;
    this.terrainConfig = terrainConfig;
    const world = worldHandlers();
    const economy = economyHandlers(economyConfig, buildingsConfig);
    const city = cityHandlers(buildingsConfig);
    const commanders = new Map([
      ...commanderHandlers(),
      ...directiveStateHandlers(),
      ...proposalStateHandlers(),
    ]);
    const orders = new Map([...orderHandlers(), ...orderOverrideHandlers()]);
    // M022: passable = finite move cost (Infinity/NaN block, fail-closed).
    const passable = (terrain: string): boolean => terrainPassable(terrainConfig, terrain);
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
      ...commanders,
      ...orders,
      ...warfare,
      ...extra,
    ]);
    if (
      merged.size !==
      world.size +
        economy.size +
        city.size +
        commanders.size +
        orders.size +
        warfare.size +
        extra.size
    ) {
      throw new Error('Match: duplicate handler names.');
    }
    const baseValidator = createWorldValidator();
    // M020: the economy post-rule closes over the match's validated
    // buildings config (composition 5 + 1 — the declared rewrite).
    const validator = {
      ...baseValidator,
      post: [...baseValidator.post, createEconomyRule(buildingsConfig)],
    };
    const noParamHandlers = new Set([...world.keys(), UPGRADE_TRANSITION, COMMISSION_TRANSITION]);
    const paramRules = new Map<string, PreRule>([
      [GATHER_TRANSITION, gatherParamsRule],
      [BUILD_TRANSITION, buildParamsRule],
      [MOVE_TRANSITION, moveParamsRule],
      [ATTACK_TRANSITION, attackParamsRule],
      [TRAIN_TRANSITION, trainParamsRule],
      [ACTIVATE_TRANSITION, commanderIdParamsRule],
      [DEACTIVATE_TRANSITION, commanderIdParamsRule],
      [ISSUE_TRANSITION, issueParamsRule],
      [CANCEL_TRANSITION, commanderIdParamsRule],
      [EXECUTE_TRANSITION, commanderIdParamsRule],
      [OVERRIDE_TRANSITION, overrideParamsRule],
      [RECORD_TRANSITION, recordParamsRule],
      [SET_TRANSITION, setParamsRule],
      [CLEAR_TRANSITION, clearParamsRule],
      [PROPOSE_TRANSITION, proposeParamsRule],
      [APPROVE_TRANSITION, commanderIdParamsRule],
      [DECLINE_TRANSITION, commanderIdParamsRule],
      [AUTOFILE_TRANSITION, proposeParamsRule],
      [AUTOAPPROVE_TRANSITION, commanderIdParamsRule],
    ]);
    // M045: execute runs heads through the live verb maps (treasury
    // precedent — the L2 executor cannot import them, so Match injects).
    const execution = orderExecutionHandlers({
      handlers: new Map([...economy, ...city, ...warfare]),
      rules: paramRules,
    });
    // M049: the counterfactual query runs these same live maps over forks.
    this.domainHandlers = new Map([...economy, ...city, ...warfare]);
    this.domainRules = paramRules;
    for (const [name, handler] of execution) {
      if (merged.has(name)) {
        throw new Error('Match: duplicate handler names.');
      }
      merged.set(name, handler);
    }
    // M052: the memory write path registers like execution (no size-check churn).
    for (const [name, handler] of memoryRecordHandlers()) {
      if (merged.has(name)) {
        throw new Error('Match: duplicate handler names.');
      }
      merged.set(name, handler);
    }
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
      // M052: the system record transition is budget-free (bookkeeping
      // is not a player action — no budget pre-check, no spend, no
      // ledger post-check). Its wire rule is fixed, not looked up.
      // M059: the assisted autofile rides the same system rail (its
      // fixed wire rule is proposeParamsRule — same { id, proposal }).
      // M060: the autonomous autoapprove rides it too ({ id } rule).
      const system =
        name === RECORD_TRANSITION ||
        name === AUTOFILE_TRANSITION ||
        name === AUTOAPPROVE_TRANSITION;
      let pre: readonly PreRule[];
      if (name === RECORD_TRANSITION) {
        pre = [recordParamsRule, ...validator.pre];
      } else if (name === AUTOFILE_TRANSITION) {
        pre = [proposeParamsRule, ...validator.pre];
      } else if (name === AUTOAPPROVE_TRANSITION) {
        pre = [commanderIdParamsRule, ...validator.pre];
      } else if (paramRule !== undefined) {
        pre = [promptsAvailableRule, paramRule, ...validator.pre];
      } else if (noParamHandlers.has(name)) {
        pre = [promptsAvailableRule, noParamsRule(name), ...validator.pre];
      } else {
        pre = [promptsAvailableRule, ...validator.pre];
      }
      const postStep = (_before: WorldState, caller: PlayerId, applied: WorldState): WorldState => {
        // M052: the system transition keeps the prompt ledger untouched
        // (spread-conditional — never an explicit undefined, M047 law).
        const prompts = system ? {} : { prompts: spendPrompt(applied.prompts, caller) };
        const built =
          applied.cities === undefined
            ? undefined
            : completeConstructions(applied.cities, applied.buildings, caller);
        const stepped: WorldState = {
          ...applied,
          ...prompts,
          ...(built === undefined
            ? {}
            : {
                cities: built.cities,
                ...(built.buildings === undefined ? {} : { buildings: built.buildings }),
              }),
        };
        // M030: every dispatch observes — accumulate explored memory from
        // canonical visibility (mapless matches skip, M015 precedent).
        if (stepped.map === undefined) {
          return stepped;
        }
        const visibility = computeVisibility(stepped.map, sourcesOf(stepped.units));
        const explored = markExplored(
          stepped.explored ?? { schemaVersion: EXPLORED_SCHEMA_VERSION, viewers: {} },
          visibility,
        );
        return { ...stepped, explored };
      };
      // M052: the system transition skips the spend ledger (it spends 0).
      const post = system ? validator.post.filter((rule) => rule !== promptsRule) : validator.post;
      validated.set(
        name,
        wrapWithValidation(handler, { ...validator, pre, post }, this.seed, nextSeq, postStep),
      );
    }
    const producers = new Map<string, readonly EventProducer[]>(matchProducers());
    // M045: execute replays the verb's own domain facts behind its
    // acknowledgment (static map — the riders loop must not double-run).
    const orderSubProducers: ReadonlyMap<string, OrderSubProducer> = new Map<
      string,
      OrderSubProducer
    >([
      [GATHER_TRANSITION, gatherProducer],
      [BUILD_TRANSITION, buildStartedProducer],
      [MOVE_TRANSITION, moveProducer],
      [ATTACK_TRANSITION, attackProducer],
      [TRAIN_TRANSITION, trainProducer],
    ]);
    producers.set(GATHER_TRANSITION, [gatherProducer]);
    producers.set(BUILD_TRANSITION, [buildStartedProducer]);
    producers.set(MOVE_TRANSITION, [moveProducer]);
    producers.set(ATTACK_TRANSITION, [attackProducer]);
    producers.set(TRAIN_TRANSITION, [trainProducer]);
    producers.set(COMMISSION_TRANSITION, [commissionedProducer]);
    producers.set(UPGRADE_TRANSITION, [createAiAssessmentProducer(this.unitsConfig)]);
    producers.set(ACTIVATE_TRANSITION, [stateFlipProducer]);
    producers.set(DEACTIVATE_TRANSITION, [stateFlipProducer]);
    producers.set(ISSUE_TRANSITION, [orderIssuedProducer]);
    producers.set(CANCEL_TRANSITION, [orderCanceledProducer]);
    producers.set(EXECUTE_TRANSITION, [createOrderExecutedProducer(orderSubProducers)]);
    producers.set(OVERRIDE_TRANSITION, [orderOverriddenProducer]);
    producers.set(SET_TRANSITION, [directiveSetProducer]);
    producers.set(CLEAR_TRANSITION, [directiveClearedProducer]);
    producers.set(PROPOSE_TRANSITION, [proposalProposedProducer]);
    producers.set(APPROVE_TRANSITION, [proposalApprovedProducer]);
    producers.set(DECLINE_TRANSITION, [proposalDeclinedProducer]);
    // M030: sightings need before/after visibility, computed here (L4 may
    // import fog; the L2 producer cannot — L2↛L2). Either map absent (or
    // the maps differing, impossible live) yields silence, never a fault.
    const spottedProducer: EventProducer = (input) => {
      const beforeMap = input.before.map;
      const afterMap = input.after.map;
      if (beforeMap === undefined || afterMap === undefined) {
        return [];
      }
      return spottedFacts({
        beforeUnits: input.before.units,
        afterUnits: input.after.units,
        beforeVisible: computeVisibility(beforeMap, sourcesOf(input.before.units)),
        afterVisible: computeVisibility(afterMap, sourcesOf(input.after.units)),
        width: afterMap.width,
      });
    };
    const extraProducers = init.extraProducers ?? new Map<string, readonly EventProducer[]>();
    // (PROMPTS/M030) Completion + discovery ride every transition: domain
    // producers first, completions second, discoveries third, sightings
    // fourth, caller extras last.
    for (const name of validated.keys()) {
      producers.set(name, [
        ...(producers.get(name) ?? []),
        completionProducer,
        discoveredProducer,
        spottedProducer,
      ]);
    }
    const orderedExtras: Array<[string, readonly EventProducer[]]> = [...extraProducers];
    for (const [name, extra] of orderedExtras) {
      producers.set(name, [...(producers.get(name) ?? []), ...extra]);
    }
    this.producers = producers;
    const extraConditions: readonly VictoryCondition[] = init.extraConditions ?? [];
    // Score superiority judges every standard match ahead of the built-ins
    // (extras-first seam; ties fall through to the exhaustion draw).
    this.conditions = [...extraConditions, scoreSuperiorCondition(), ...matchConditions()];
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
        // M052: stamped memorable events persist as commander memories
        // (direct kernel call — bookkeeping bypasses producers/victory).
        this.recordMemories(session, emitted);
        // M059: assisted commanders file stance proposals from new
        // lessons (after memories — recall reads this lance's record).
        // M061: autonomous heads pop FIRST (own-action lessons
        // record inside — counsel sees this lance's doing).
        this.autoexecuteHeads(session);
        // M059: assisted commanders file stance proposals from new
        // lessons (after memories + executions — recall reads the
        // whole chain's record).
        this.autofileProposals(session, outcome.revision);
        // M060: autonomous commanders verdict at once (after filing
        // — file and approve land the same lance).
        this.autoapproveProposals(session);
        // Victory reads the post-bookkeeping state (M061: autonomous
        // spends can exhaust the ledger — the deciding lance owns
        // the verdict, stamped with its revision).
        const verdict = evaluateVictory(this.conditions, {
          state: this.kernel.getSnapshot(),
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
      // M062: every readable in-try attempt journals (applied,
      // rejected and kernel errors alike — replay re-attempts all,
      // outcomes re-derive; nullish adversarial noise skips — reads
      // would throw, and garbage has no redrive value; the
      // MATCH_FINISHED early-return never reaches here).
      if (raw) {
        const envelope = raw as ClientRequest;
        this.journal.push({
          requestId: envelope.requestId,
          playerId: envelope.playerId,
          sessionPlayer: session.playerId,
          type: envelope.type,
          payload: envelope.payload,
          outcome,
        });
      }
      this.syncTimeline();
    }
    return outcome;
  }

  /**
   * M052 — bookkeeping: stamped memorable events persist as commander
   * memories. Direct kernel dispatch (no finished-guard — the final
   * lance records too; no producers — the record emits nothing; no
   * victory re-check — memories cannot end games). Nothing memorable
   * skips the dispatch (zero revision-bloat on banal lances); a
   * rejected record is tolerated (per-event fail-closed); an error
   * FAULTS loud (the internally-built envelope must never fault).
   */
  private recordMemories(session: SessionHandle, emitted: readonly GameEvent[]): void {
    const memorable = emitted.filter((event) => isMemorableKind(event.type));
    if (memorable.length === 0) {
      return;
    }
    // Deterministic request id (one record per game dispatch —
    // twins stay identical; the hygiene gate forbids fresh randomness).
    const outcome = this.kernel.dispatch(
      session,
      markUntrusted({
        requestId: `memory.record rev ${this.kernel.getRevision()}` as RequestId,
        playerId: session.playerId,
        type: RECORD_TRANSITION,
        payload: { events: memorable },
      }),
    );
    if (outcome.status === 'error') {
      throw new Error(`recordMemories: bookkeeping fault (${outcome.code}).`);
    }
  }

  /**
   * M059 — bookkeeping: assisted/autonomous commanders file a stance
   * proposal when a NEW lesson diverges recall from DNA (the slot
   * fills from this lance's record — battle, then counsel). Manual
   * and directive-less commanders stay silent (manual is status
   * quo, D-049 honored); occupied slots, set stances and inactive
   * records are skipped; the new-lesson gate (fresh battle/failure
   * stamped this lance) keeps declines declined until new evidence.
   * Direct kernel dispatches (fire-and-forget — pre-checked slots
   * are distinct and single-threaded, so the defensive rejects are
   * unreachable here; direct-dispatch tests prove them instead).
   * Each filing runs the proposed producer by hand (bookkeeping
   * bypasses producers — but the holder MUST notice an attention
   * slot; M052-silence would defeat the purpose).
   */
  private autofileProposals(session: SessionHandle, outerRevision: number): void {
    const lookup = this.streamLookup();
    for (const record of this.kernel.getSnapshot().commanders?.commanders ?? []) {
      if (!record.active) {
        continue;
      }
      // Absent directives read silent (manual-by-default, D-049).
      const directives = record.directives ?? {};
      const autonomy = directives.autonomy;
      if (autonomy !== 'assisted' && autonomy !== 'autonomous') {
        continue;
      }
      if (record.proposal !== undefined) {
        continue;
      }
      if (directives.stance !== undefined) {
        continue;
      }
      // Defined records always recollect (cast documents the seam).
      const recollected = recallMemories(record, lookup) as Recollection;
      // This lance's chain: the outer revision or a later inner one
      // (M061: own-action lessons stamp inner revisions).
      const lesson = recollected.fresh.some(
        (memory) =>
          (STANCE_BATTLE_KINDS.includes(memory.kind) ||
            STANCE_FAILURE_KINDS.includes(memory.kind)) &&
          memory.revision >= outerRevision,
      );
      if (!lesson) {
        continue;
      }
      const counsel = stanceWithRecall(record, recollected);
      if (counsel === stanceOf(record)) {
        continue;
      }
      const payload = { id: record.id, proposal: { kind: 'stance', stance: counsel } };
      const before = this.kernel.getSnapshot();
      this.kernel.dispatch(
        session,
        markUntrusted({
          requestId: `proposal.autofile ${record.id} rev ${this.kernel.getRevision()}` as RequestId,
          playerId: session.playerId,
          type: AUTOFILE_TRANSITION,
          payload,
        }),
      );
      const after = this.kernel.getSnapshot();
      this.events.push(
        ...runProducers(
          { type: AUTOFILE_TRANSITION, caller: session.playerId, params: payload, before, after },
          [proposalProposedProducer],
          this.kernel.getRevision(),
          this.events.length + 1,
        ),
      );
    }
  }

  /**
   * M060 — bookkeeping: autonomous commanders verdict their pending
   * proposal at once (assisted holders keep the verdict — THE ladder
   * distinction; manual and directive-less stay silent). Runs after
   * filing, so an autonomous file approves the same lance (battle,
   * counsel, verdict, one move). Full queues and corrupt slots are
   * tolerated (the slot retries silently next lance). Direct kernel
   * dispatches, fire-and-forget (M059 mold); each approval runs the
   * approved producer by hand (the holder MUST notice a verdict).
   */
  private autoapproveProposals(session: SessionHandle): void {
    for (const record of this.kernel.getSnapshot().commanders?.commanders ?? []) {
      if (!record.active) {
        continue;
      }
      if ((record.directives ?? {}).autonomy !== 'autonomous') {
        continue;
      }
      if (record.proposal === undefined) {
        continue;
      }
      const payload = { id: record.id };
      const before = this.kernel.getSnapshot();
      this.kernel.dispatch(
        session,
        markUntrusted({
          requestId:
            `proposal.autoapprove ${record.id} rev ${this.kernel.getRevision()}` as RequestId,
          playerId: session.playerId,
          type: AUTOAPPROVE_TRANSITION,
          payload,
        }),
      );
      const after = this.kernel.getSnapshot();
      this.events.push(
        ...runProducers(
          {
            type: AUTOAPPROVE_TRANSITION,
            caller: session.playerId,
            params: payload,
            before,
            after,
          },
          [proposalApprovedProducer],
          this.kernel.getRevision(),
          this.events.length + 1,
        ),
      );
    }
  }

  /**
   * M061 — bookkeeping: the acting holder's autonomous commanders pop
   * one queue head each (paced, one head per lance — no recursion).
   * Runs FIRST (act, then think — own-action lessons record here so
   * counsel sees this lance's doing). Owner-bounded (your lance,
   * your commanders act — prompt spends stay honest); assisted/
   * manual stay manual (THE ladder, complete). Reuses the PLAYER
   * execute verb (no new transition): exhausted ledgers and verb
   * rejects fail closed and retry silently next lance. The
   * applied-gate is load-bearing (the executed producer throws on
   * no-change); the FULL producer list rides (execute moves
   * map/units — riders matter here, unlike M059/M060).
   */
  private autoexecuteHeads(session: SessionHandle): void {
    for (const record of this.kernel.getSnapshot().commanders?.commanders ?? []) {
      if (!record.active) {
        continue;
      }
      if (record.owner !== session.playerId) {
        continue;
      }
      if ((record.directives ?? {}).autonomy !== 'autonomous') {
        continue;
      }
      if ((record.orders ?? []).length === 0) {
        continue;
      }
      const payload = { id: record.id };
      const before = this.kernel.getSnapshot();
      const outcome = this.kernel.dispatch(
        session,
        markUntrusted({
          requestId:
            `order.execute auto ${record.id} rev ${this.kernel.getRevision()}` as RequestId,
          playerId: session.playerId,
          type: EXECUTE_TRANSITION,
          payload,
        }),
      );
      if (outcome.status !== 'applied') {
        continue;
      }
      const after = this.kernel.getSnapshot();
      // Total lookup: EXECUTE registers producers at construction
      // (same-keys proof as the outer dispatch path).
      const producers = this.producers.get(EXECUTE_TRANSITION) as readonly EventProducer[];
      const inner = runProducers(
        { type: EXECUTE_TRANSITION, caller: session.playerId, params: payload, before, after },
        producers,
        this.kernel.getRevision(),
        this.events.length + 1,
      );
      this.events.push(...inner);
      // Own-action lessons persist (inner executes bypass the outer
      // record — without this the AI never learns its own doing).
      this.recordMemories(session, inner);
    }
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

  /**
   * M038 — live strategic assessment of one holder (read-only query over
   * the current snapshot; units stats come from this Match's validated
   * unitsConfig). The `as UnitType` casts document the validated-state
   * seam (M029 precedent): Match states always validate (M006), and the
   * warfare lookups re-guard fail-loud.
   */
  assessmentOf(holder: string): PlayerAssessment {
    const statsOf: StatsOf = (type: string) => ({
      damage: unitDamageOf(this.unitsConfig, type as UnitType),
      maxHp: maxHpOf(this.unitsConfig, type as UnitType),
    });
    return assessPlayer(this.kernel.getSnapshot(), holder, statsOf);
  }

  /**
   * M038 — live per-commander stances of one holder, in roster order
   * (read-only). M054: stances read validated recollection (memories
   * steer posture); memoryless records read DNA stance exactly.
   */
  stancesOf(holder: string): ReadonlyArray<CommanderStance> {
    const lookup = this.streamLookup();
    return commandersOf(this.kernel.getSnapshot().commanders, holder).map((record) => ({
      id: record.id,
      // Defined records always recollect (cast documents the seam).
      stance: stanceWithRecall(record, recallMemories(record, lookup) as Recollection),
    }));
  }

  /** M039 — live army posture of one holder (read-only aggregation over stancesOf). */
  postureOf(holder: string): ArmyPosture {
    return postureOf(commandersOf(this.kernel.getSnapshot().commanders, holder));
  }

  /**
   * M048 — live confidence of one queued order (read-only; undefined when
   * the commander or the order is missing). Rules adapt this Match's
   * validated configs; unknown unit/building types abstain (never throw).
   * No treasury means unaffordable (honest: nothing to pay with). The
   * `as` casts document the validated-state seam (M029 precedent).
   */
  confidenceOf(commanderId: string, orderIndex: number): OrderConfidence | undefined {
    const snapshot = this.kernel.getSnapshot();
    return confidenceOfOrder(
      snapshot.commanders?.commanders.find((record) => record.id === commanderId),
      orderIndex,
      snapshot,
      this.confidenceRules(snapshot),
    );
  }

  /**
   * M049 — live counterfactual: what would confidence say about one
   * queued order after a hypothetical order applied (read-only;
   * undefined when the commander or the target is missing). The sim
   * runs the live domain handlers over a fork — the real Match never
   * moves (no prompts, no events, no timeline).
   */
  whatIf(
    commanderId: string,
    orderIndex: number,
    hypothetical: HypotheticalOrder,
  ): WhatIfConfidence | undefined {
    const snapshot = this.kernel.getSnapshot();
    return whatIfConfidence(
      snapshot.commanders?.commanders.find((record) => record.id === commanderId),
      orderIndex,
      snapshot,
      hypothetical,
      this.counterfactualDeps(),
    );
  }

  /**
   * M050 — live counterfactual script: what would confidence say about
   * one queued order after a hypothetical sequence applied in order
   * (read-only; undefined when the commander or the target is
   * missing). First failure wins with its step index.
   */
  whatIfScript(
    commanderId: string,
    orderIndex: number,
    script: readonly HypotheticalOrder[],
  ): WhatIfScript | undefined {
    const snapshot = this.kernel.getSnapshot();
    return whatIfScript(
      snapshot.commanders?.commanders.find((record) => record.id === commanderId),
      orderIndex,
      snapshot,
      script,
      this.counterfactualDeps(),
    );
  }

  /**
   * M050 — live candidate ranking: which hypothetical best serves one
   * queued order (read-only; undefined when the commander or the
   * target is missing). Best-first by outcome score, stable ties,
   * unapplied sink; recommended names the input index to play.
   */
  rankCandidates(
    commanderId: string,
    orderIndex: number,
    candidates: readonly HypotheticalOrder[],
  ): CandidateRanking | undefined {
    const snapshot = this.kernel.getSnapshot();
    return rankCandidates(
      snapshot.commanders?.commanders.find((record) => record.id === commanderId),
      orderIndex,
      snapshot,
      candidates,
      this.counterfactualDeps(),
    );
  }

  /**
   * M053 — live recall: what one commander remembers, validated
   * against the stream (read-only; undefined when the commander is
   * missing). Optional subject narrows to one entity ("about X").
   * Fresh memories are safe to consume; stale ones flag forgery.
   */
  recall(commanderId: string, subject?: string): Recollection | undefined {
    const snapshot = this.kernel.getSnapshot();
    const record = snapshot.commanders?.commanders.find((entry) => entry.id === commanderId);
    return recallMemories(record, this.streamLookup(), subject);
  }

  /** M054 — stream lookup over live events (shared by recall + stancesOf). */
  private streamLookup(): StreamLookup {
    const bySeq = new Map(this.events.map((event) => [event.seq, event] as const));
    return (seq) => {
      const found = bySeq.get(seq);
      return found === undefined ? undefined : { revision: found.revision, kind: found.type };
    };
  }

  /** M050 — CounterfactualDeps (shared by the three counterfactual queries). */
  private counterfactualDeps(): CounterfactualDeps {
    return {
      handlers: this.domainHandlers,
      rules: this.domainRules,
      confidenceFor: (outcome: WorldState) => this.confidenceRules(outcome),
    };
  }

  /** M048/M049 — ConfidenceRules over one snapshot (shared by both queries). */
  private confidenceRules(snapshot: WorldState): ConfidenceRules {
    return {
      unitStatsOf: (type: string) => {
        if (!isUnitType(type)) {
          return undefined;
        }
        return {
          damage: unitDamageOf(this.unitsConfig, type),
          maxHp: maxHpOf(this.unitsConfig, type),
          cost: unitCostOf(this.unitsConfig, type),
        };
      },
      buildCostOf: (type: string) =>
        isBuildingId(type) ? costOf(this.buildingsConfig, type) : undefined,
      passable: (terrain: string) =>
        Number.isFinite(modifiersFor(this.terrainConfig, terrain as TerrainId).move),
      defenseOf: (terrain: string) =>
        modifiersFor(this.terrainConfig, terrain as TerrainId).defense,
      canAfford: (holder: string, cost) =>
        snapshot.stockpiles !== undefined &&
        canAfford(snapshot.stockpiles, holder as PlayerId, cost),
    };
  }

  getTimeline(): readonly TimelineEntry[] {
    return [...this.timeline];
  }

  getEvents(): readonly GameEvent[] {
    return [...this.events];
  }

  /** M062 — the dispatch journal (copy; redrive with Match.replay). */
  getJournal(): readonly JournalEntry[] {
    return [...this.journal];
  }

  /**
   * M062 — redrive a journal through a fresh Match (deterministic
   * rebuild: same init, same envelopes, same sessions-by-holder,
   * outcomes re-derive — forgeries included). One session per entry
   * (join is cheap; session ids are unobservable). Returns the live
   * Match plus per-attempt replay outcomes for verify-comparison
   * (M063 persists, M064 steps by slice).
   */
  static replay(
    init: MatchInit,
    journal: readonly JournalEntry[],
  ): { readonly match: Match; readonly outcomes: readonly MatchDispatchOutcome[] } {
    const match = new Match(init);
    const outcomes: MatchDispatchOutcome[] = [];
    for (const entry of journal) {
      const session = match.join(entry.sessionPlayer);
      outcomes.push(
        match.dispatch(
          session,
          markUntrusted({
            requestId: entry.requestId,
            playerId: entry.playerId,
            type: entry.type,
            payload: entry.payload,
          }),
        ),
      );
    }
    return { match, outcomes };
  }

  /**
   * M065 — hands-free match: a policy plays every side in roster order
   * until victory or stall (two consecutive lances without an applied
   * dispatch — rejects and idles). Termination is structural for
   * spending policies (every applied lance spends toward exhaustion);
   * custom policies are trusted like M064 journals (a policy that
   * applies budget-free forever wedges — simplePolicy never does).
   */
  static selfplay(
    init: MatchInit,
    policy: SelfplayPolicy,
  ): {
    readonly match: Match;
    readonly lances: number;
    readonly stalled: boolean;
    readonly scores: Readonly<Record<PlayerId, number>>;
  } {
    const match = new Match(init);
    let lance = 0;
    let turn = 0;
    let stale = 0;
    for (;;) {
      if (match.getVerdict().status === 'finished') {
        return {
          match,
          lances: lance,
          stalled: false,
          scores: scoreTable(match.getSnapshot(), init.players),
        };
      }
      // Non-empty roster (the kernel threw otherwise — cast documents it).
      const player = init.players[turn % init.players.length] as PlayerId;
      const move = policy(match.getSnapshot(), player, (terrain) =>
        terrainPassable(match.terrainConfig, terrain),
      );
      lance += 1;
      if (move === null) {
        stale += 1;
      } else {
        const session = match.join(player);
        const outcome = match.dispatch(
          session,
          markUntrusted({
            requestId: `selfplay ${lance}` as RequestId,
            playerId: player,
            type: move.type,
            payload: move.payload,
          }),
        );
        stale = outcome.status === 'applied' ? 0 : stale + 1;
      }
      if (stale >= 2) {
        return {
          match,
          lances: lance,
          stalled: true,
          scores: scoreTable(match.getSnapshot(), init.players),
        };
      }
      turn += 1;
    }
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

/** M063 — replay blob version (bumped only by breaking shape changes). */
export const REPLAY_BLOB_VERSION = 1;

/** M063 mirror of DispatchErrorCode (authority.ts canonical; deliberately not imported). */
const BLOB_ERROR_CODES: readonly string[] = [
  'INVALID_SESSION',
  'SPOOFED_SENDER',
  'MALFORMED_REQUEST',
  'PAYLOAD_TOO_LARGE',
  'UNKNOWN_TRANSITION',
  'HANDLER_FAULT',
];

function isRecordedOutcomeShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  if (fields['status'] === 'applied') {
    return typeof fields['revision'] === 'number' && typeof fields['summary'] === 'string';
  }
  if (fields['status'] === 'rejected') {
    return typeof fields['reason'] === 'string';
  }
  return false;
}

function isOutcomeShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  if (fields['status'] === 'applied' || fields['status'] === 'rejected') {
    return isRecordedOutcomeShape(value);
  }
  if (fields['status'] === 'duplicate') {
    return isRecordedOutcomeShape(fields['original']);
  }
  if (fields['status'] === 'error') {
    const code = fields['code'];
    return typeof code === 'string' && BLOB_ERROR_CODES.includes(code);
  }
  return false;
}

function isJournalEntryShape(value: unknown): value is JournalEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  return (
    typeof fields['requestId'] === 'string' &&
    typeof fields['playerId'] === 'string' &&
    typeof fields['sessionPlayer'] === 'string' &&
    typeof fields['type'] === 'string' &&
    isOutcomeShape(fields['outcome'])
  );
}

/** M063 — strict blob-shape check (game-validity stays with Match). */
export function isReplayBlob(value: unknown): value is {
  readonly version: number;
  readonly init: MatchInit;
  readonly journal: readonly JournalEntry[];
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  if (fields['version'] !== REPLAY_BLOB_VERSION) {
    return false;
  }
  const init = fields['init'];
  if (typeof init !== 'object' || init === null || Array.isArray(init)) {
    return false;
  }
  const journal = fields['journal'];
  if (!Array.isArray(journal)) {
    return false;
  }
  return journal.every(isJournalEntryShape);
}

/**
 * M063 — serialize a match history to a portable blob (init + journal;
 * test seams stripped — extraHandlers/extraProducers/extraConditions
 * never persist).
 */
export function exportReplayBlob(init: MatchInit, journal: readonly JournalEntry[]): string {
  const {
    extraHandlers: _strippedHandlers,
    extraProducers: _strippedProducers,
    extraConditions: _strippedConditions,
    ...kept
  } = init;
  void _strippedHandlers;
  void _strippedProducers;
  void _strippedConditions;
  return JSON.stringify({ version: REPLAY_BLOB_VERSION, init: kept, journal });
}

/**
 * M063 — parse a blob back (throws on malformed JSON or bad shape;
 * init passes through — Match re-validates game-validity on replay).
 */
export function importReplayBlob(json: string): {
  readonly init: MatchInit;
  readonly journal: readonly JournalEntry[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('replay blob: not JSON.');
  }
  if (!isReplayBlob(parsed)) {
    throw new Error('replay blob: bad shape.');
  }
  return { init: parsed.init, journal: parsed.journal };
}

/**
 * M064 — a live frame in a stepped replay (match observes snapshot /
 * events / timeline at the current lance; step advances one entry).
 */
export interface ReplayStepper {
  readonly match: Match;
  readonly lance: number;
  readonly total: number;
  step(): MatchDispatchOutcome | null;
}

/**
 * M064 — incremental replay stepping (one dispatch per step, O(n)
 * total — fat slices would re-redrive O(n²)). Trusts a valid journal
 * (importReplayBlob owns validity — seam documented). The match is
 * live: frames read straight off it.
 */
export function createReplayStepper(
  init: MatchInit,
  journal: readonly JournalEntry[],
): ReplayStepper {
  const match = new Match(init);
  let lance = 0;
  return {
    match,
    get lance() {
      return lance;
    },
    total: journal.length,
    step() {
      const entry = journal[lance];
      if (entry === undefined) {
        return null;
      }
      lance += 1;
      const session = match.join(entry.sessionPlayer);
      return match.dispatch(
        session,
        markUntrusted({
          requestId: entry.requestId,
          playerId: entry.playerId,
          type: entry.type,
          payload: entry.payload,
        }),
      );
    },
  };
}
