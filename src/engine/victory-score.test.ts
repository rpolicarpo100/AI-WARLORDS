/**
 * M078 — score-superiority tests: hand-built states (cast seam,
 * M065 precedent — verdicts are pure derivation, no validation).
 * Strict leader wins once dry; ties and empty rosters abstain
 * (prompt exhaustion still draws them downstream).
 */
import { describe, expect, it } from 'vitest';
import type { PlayerId } from './authority.js';
import { Match, STANDARD_RULESET } from './match.js';
import { scoreSuperiorCondition } from './victory-score.js';
import type { ConditionInput } from './victory.js';
import type { WorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

function state(sections: Record<string, unknown>): WorldState {
  return {
    schemaVersion: 1,
    players: [{ id: P1 }, { id: P2 }],
    ...sections,
  } as WorldState;
}

const dry = { schemaVersion: 1, remaining: { p1: 0, p2: 0 } };
const held = { schemaVersion: 1, remaining: { p1: 1, p2: 0 } };

function ahead(rich: string): unknown {
  return {
    schemaVersion: 1,
    stockpiles: { [rich]: { food: 1, wood: 0, stone: 0, gold: 0 } },
  };
}

function input(seen: WorldState): ConditionInput {
  return { state: seen, revision: 20 };
}

describe('scoreSuperiorCondition (unit)', () => {
  it('stays undecided while anyone holds prompts', () => {
    const seen = state({ prompts: held, stockpiles: ahead('p1') });
    expect(scoreSuperiorCondition()(input(seen))).toBeNull();
  });

  it('crowns the early leader once dry', () => {
    const seen = state({ prompts: dry, stockpiles: ahead('p1') });
    expect(scoreSuperiorCondition()(input(seen))).toEqual({
      outcome: { kind: 'win', winner: P1 },
      condition: 'score-superior',
    });
  });

  it('crowns the late leader once dry', () => {
    const seen = state({ prompts: dry, stockpiles: ahead('p2') });
    expect(scoreSuperiorCondition()(input(seen))).toEqual({
      outcome: { kind: 'win', winner: P2 },
      condition: 'score-superior',
    });
  });

  it('abstains on ties (exhaustion draws downstream)', () => {
    const seen = state({ prompts: dry });
    expect(scoreSuperiorCondition()(input(seen))).toBeNull();
  });

  it('abstains on empty rosters (nothing to crown)', () => {
    const seen = { ...state({ prompts: dry }), players: [] };
    expect(scoreSuperiorCondition()(input(seen))).toBeNull();
  });

  it('crowns through a real match (extras-first seam)', () => {
    const match = new Match({
      seed: 78,
      ruleset: STANDARD_RULESET,
      players: [P1, P2],
      initialState: state({ prompts: dry, stockpiles: ahead('p1') }),
    });
    expect(match.getVerdict()).toEqual({
      status: 'finished',
      outcome: { kind: 'win', winner: P1 },
      condition: 'score-superior',
      revision: 0,
    });
  });
});
