/**
 * M078 — Score-superiority victories (LAYER L3, pure).
 *
 * First of the Competitive-continued arc (D-072): when every holder is
 * dry, the strict arena-score leader wins ('score-superior') — the
 * upgrade victory.ts promised once scoring existed (M067 shipped it).
 * Ties and empty rosters stay undecided (null) so prompt exhaustion
 * still draws them; standard matches compose this ahead of the
 * built-ins through the extras-first seam (never inside victory.ts:
 * layers point strictly downward and victory:2 cannot read score:2).
 * Per-holder scorePlayer (never scoreTable indexing — complete by
 * construction, so the undefined side would lie uncovered).
 * LAYER L3 (authority L0 + prompts L0 + score L2 + victory L2, downward).
 */
import type { PlayerId } from './authority.js';
import { promptsOf } from './prompts.js';
import { scorePlayer } from './score.js';
import type { VictoryCondition } from './victory.js';

/** Crowns the strict score leader once nobody can act (ties abstain). */
export function scoreSuperiorCondition(): VictoryCondition {
  return (input) => {
    for (const player of input.state.players) {
      if (promptsOf(input.state.prompts, player.id) > 0) {
        return null;
      }
    }
    let winner: PlayerId | null = null;
    let top = 0;
    let tied = false;
    for (const player of input.state.players) {
      const score = scorePlayer(input.state, player.id);
      if (winner === null || score > top) {
        winner = player.id;
        top = score;
        tied = false;
      } else if (score === top) {
        tied = true;
      }
    }
    if (winner === null || tied) {
      return null;
    }
    return { outcome: { kind: 'win', winner }, condition: 'score-superior' };
  };
}
