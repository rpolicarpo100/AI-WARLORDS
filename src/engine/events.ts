import { freezeState, MAX_ID_LENGTH, type PlayerId } from './authority.js';
import type { VerdictOutcome } from './victory.js';
import type { WorldState } from './world-state.js';

/**
 * EVENT SYSTEM (M007): domain facts for downstream consumers (replay,
 * chronicle, analytics, AI attention). Facts, not journal: emission happens
 * on applied outcomes only, and only when a registered producer returns
 * facts — restraint is the point (#20: no excessive unnecessary events).
 *
 * Observation never breaks execution: every producer runs isolated; any
 * failure yields a `system.event-fault` surrogate (HIGH) and emission
 * continues. `runProducers` is total (never throws).
 */

/** Attention scale (#33 DECISION BUDGET). Producers assign; M007 only records. */
export type EventPriority = 'low' | 'normal' | 'high' | 'critical';

export interface GameEvent {
  readonly seq: number;
  readonly revision: number;
  readonly type: string;
  readonly priority: EventPriority;
  readonly payload: unknown;
}

/** Unsequenced fact returned by producers; the emitter stamps seq/revision. */
export interface EventInput {
  readonly type: string;
  readonly priority: EventPriority;
  readonly payload: unknown;
}

export interface ProducerInput {
  readonly type: string;
  readonly caller: PlayerId;
  readonly params: unknown;
  readonly before: WorldState;
  readonly after: WorldState;
}

export type EventProducer = (input: ProducerInput) => readonly EventInput[];

/**
 * Built-in producers by transition name. Empty today: `world.noop` is
 * deliberately absent (silence is a feature) and `match.advance` retired
 * with ticks (PROMPTS).
 */
export function matchProducers(): Map<string, readonly EventProducer[]> {
  const entries: Array<[string, readonly EventProducer[]]> = [];
  return new Map(entries);
}

export function matchStartedEvent(
  seed: number,
  players: readonly PlayerId[],
  ruleset: { readonly id: string; readonly version: number },
  map?: { readonly id: string; readonly version: number },
): GameEvent {
  return freezeState({
    seq: 1,
    revision: 0,
    type: 'match.started',
    priority: 'normal',
    payload: map === undefined ? { seed, players, ruleset } : { seed, players, ruleset, map },
  });
}

export function matchFinishedEvent(
  outcome: VerdictOutcome,
  condition: string,
  revision: number,
  seq: number,
): GameEvent {
  return freezeState({
    seq,
    revision,
    type: 'match.finished',
    priority: 'high',
    payload: { outcome, condition },
  });
}

function assertFact(fact: EventInput, transition: string, producerIndex: number): void {
  if (typeof fact.type !== 'string' || fact.type.length === 0 || fact.type.length > MAX_ID_LENGTH) {
    throw new Error(`invalid event fact for ${transition} (producer ${producerIndex}): bad type`);
  }
  if (
    fact.priority !== 'low' &&
    fact.priority !== 'normal' &&
    fact.priority !== 'high' &&
    fact.priority !== 'critical'
  ) {
    throw new Error(
      `invalid event fact for ${transition} (producer ${producerIndex}): bad priority`,
    );
  }
}

function surrogate(
  transition: string,
  producerIndex: number,
  thrown: unknown,
  revision: number,
  seq: number,
): GameEvent {
  const message = thrown instanceof Error ? thrown.message : 'non-error thrown';
  return freezeState({
    seq,
    revision,
    type: 'system.event-fault',
    priority: 'high',
    payload: { transition, producer: producerIndex, message },
  });
}

export function runProducers(
  input: ProducerInput,
  producers: readonly EventProducer[],
  revision: number,
  baseSeq: number,
): GameEvent[] {
  const emitted: GameEvent[] = [];
  for (const [index, producer] of producers.entries()) {
    try {
      const facts = producer(input);
      for (const fact of facts) {
        assertFact(fact, input.type, index);
        emitted.push(
          freezeState({
            seq: baseSeq + emitted.length,
            revision,
            type: fact.type,
            priority: fact.priority,
            payload: fact.payload,
          }),
        );
      }
    } catch (error) {
      emitted.push(surrogate(input.type, index, error, revision, baseSeq + emitted.length));
    }
  }
  return emitted;
}
