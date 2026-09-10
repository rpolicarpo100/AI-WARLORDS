import type { TransitionContext, TransitionHandler, TransitionResult } from './authority.js';

/**
 * M003 AUTHORITY TEST-HARNESS DOMAIN.
 *
 * This is explicitly NOT the game world (M004), NOT the economy (M016+),
 * NOT gathering (M017). These minimal transitions exist ONLY to prove the
 * authority mechanism on real (if tiny) state: the client proposes intents,
 * the server computes every outcome from its own tables and rules.
 * Future domain modules will register their own handlers; nothing here is
 * load-bearing for the game.
 */
export interface HarnessState {
  readonly tick: number;
  readonly yields: { readonly [nodeId: string]: number };
  readonly balances: { readonly [playerId: string]: number };
}

export function initialHarnessState(): HarnessState {
  return {
    tick: 0,
    yields: { 'node-a': 3, 'node-b': 7 },
    balances: {},
  };
}

function noopHandler(ctx: TransitionContext<HarnessState>): TransitionResult<HarnessState> {
  return { applied: true, state: ctx.state, summary: 'noop' };
}

function harvestHandler(ctx: TransitionContext<HarnessState>): TransitionResult<HarnessState> {
  const params = ctx.params;
  if (typeof params !== 'object' || params === null) {
    return { applied: false, reason: 'harvest: params must be an object' };
  }
  const nodeId = (params as Record<string, unknown>)['nodeId'];
  if (typeof nodeId !== 'string' || nodeId.length === 0) {
    return { applied: false, reason: 'harvest: nodeId must be a non-empty string' };
  }
  const yieldAmount = ctx.state.yields[nodeId];
  if (yieldAmount === undefined) {
    return { applied: false, reason: `harvest: unknown node ${JSON.stringify(nodeId)}` };
  }
  // AUTHORITY POINT: any client-supplied yield/amount/bonus fields in the
  // payload are DELIBERATELY never read. The granted amount comes ONLY from
  // the server-side table above.
  const balance = ctx.state.balances[ctx.caller] ?? 0;
  return {
    applied: true,
    state: {
      tick: ctx.state.tick + 1,
      yields: ctx.state.yields,
      balances: { ...ctx.state.balances, [ctx.caller]: balance + yieldAmount },
    },
    summary: `harvested ${nodeId} for +${yieldAmount}`,
  };
}

export function harnessHandlers(): Map<string, TransitionHandler<HarnessState>> {
  const entries: Array<[string, TransitionHandler<HarnessState>]> = [
    ['noop', noopHandler],
    ['harvest', harvestHandler],
  ];
  return new Map(entries);
}
