import { freezeState, isPlayerId, MAX_ID_LENGTH, type PlayerId } from './authority.js';
import { promptsOf } from './prompts.js';
import type { WorldState } from './world-state.js';

/**
 * VICTORY CONDITIONS (M008): terminal verdicts as a pure function of state.
 * Conditions plug a uniform seam (first decisive verdict wins; extras run
 * before built-ins so domain-specific beats general). Decisions are
 * validated strictly — a malformed verdict fails stop-loud, never invented
 * (#40: never invent happenings). Engine-side only: validation guards
 * field-level corruption (the realistic bug class for typed seams).
 *
 * The only real condition today is prompt exhaustion (D-022 reforms #46):
 * with no score tracked yet, an undecided match where nobody can act is
 * a draw (a winner would have to be invented). Score comparison upgrades
 * this when scoring exists.
 */

export type VerdictOutcome =
  { readonly kind: 'win'; readonly winner: PlayerId } | { readonly kind: 'draw' };

export type Verdict =
  | { readonly status: 'ongoing' }
  | {
      readonly status: 'finished';
      readonly outcome: VerdictOutcome;
      readonly condition: string;
      readonly revision: number;
    };

export interface ConditionInput {
  readonly state: WorldState;
  readonly revision: number;
}

export interface ConditionDecision {
  readonly outcome: VerdictOutcome;
  readonly condition: string;
}

export type VictoryCondition = (input: ConditionInput) => ConditionDecision | null;

const ONGOING: Verdict = freezeState<Verdict>({ status: 'ongoing' });

export function promptsExhaustedCondition(): VictoryCondition {
  return (input) => {
    for (const player of input.state.players) {
      if (promptsOf(input.state.prompts, player.id) > 0) {
        return null;
      }
    }
    return { outcome: { kind: 'draw' }, condition: 'prompts-exhausted' };
  };
}

export function matchConditions(): readonly VictoryCondition[] {
  return [promptsExhaustedCondition()];
}

function assertDecision(
  decision: ConditionDecision,
  index: number,
  roster: readonly PlayerId[],
): void {
  const outcome = decision.outcome;
  if (outcome.kind !== 'win' && outcome.kind !== 'draw') {
    throw new Error(`invalid victory decision (condition ${index}): bad outcome`);
  }
  if (outcome.kind === 'win' && (!isPlayerId(outcome.winner) || !roster.includes(outcome.winner))) {
    throw new Error(`invalid victory decision (condition ${index}): bad winner`);
  }
  if (
    typeof decision.condition !== 'string' ||
    decision.condition.length === 0 ||
    decision.condition.length > MAX_ID_LENGTH
  ) {
    throw new Error(`invalid victory decision (condition ${index}): bad condition`);
  }
}

export function evaluateVictory(
  conditions: readonly VictoryCondition[],
  input: ConditionInput,
): Verdict {
  const roster = input.state.players.map((p) => p.id);
  for (const [index, condition] of conditions.entries()) {
    let decision: ConditionDecision | null;
    try {
      decision = condition(input);
    } catch {
      throw new Error(`invalid victory decision (condition ${index}): threw`);
    }
    if (decision !== null) {
      assertDecision(decision, index, roster);
      return freezeState<Verdict>({
        status: 'finished',
        outcome: decision.outcome,
        condition: decision.condition,
        revision: input.revision,
      });
    }
  }
  return ONGOING;
}
