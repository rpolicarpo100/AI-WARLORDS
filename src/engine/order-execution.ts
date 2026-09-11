/**
 * M045 — Order execution: run the queue head through the live verb (LAYER L2).
 *
 * The Player → AI Command closer (D-039, voted execute-close): order.execute
 * pops the head through the REAL pre-rule + the LIVE domain handler (both
 * Match-injected — treasury precedent; L2↛L2 bars importing them).
 * Pop-then-apply: the sub-handler runs over the already-popped state, so
 * any failure (bad head, verb rejects) discards everything and the queue
 * keeps its head (fail-closed; cancel is the escape hatch; verb reasons
 * propagate verbatim). Composed facts: the factory's static domain-
 * producer map replays the verb's own facts BEHIND order.executed (M040
 * riders-behind mold; kind+params derived from the before-head).
 * Caller-injected extras don't ride execute (test seam, declared).
 * LAYER L2 (imports authority/commanders L0 + world-state L1 type-only,
 * all downward; OrderPreRule mirrors PreRule, OrderPriority mirrors
 * EventPriority, OrderSubProducer mirrors EventProducer — validation
 * and events sit above, strictly-downward law).
 */

import type { PlayerId, TransitionHandler } from './authority.js';
import { commanderById, type CommandersData } from './commanders.js';
import type { WorldState } from './world-state.js';

export const EXECUTE_TRANSITION = 'order.execute';

/** Validated execute parameters: which commander's head to run. */
export interface ExecuteOrderParams {
  readonly id: string;
}

/** Structural mirror of PreRule (validation L2↛L2). */
export interface OrderPreRule {
  (
    caller: PlayerId,
    params: unknown,
    state: WorldState,
  ): { readonly rule: string; readonly detail: string } | null;
}

/** Structural mirror of EventPriority (events L3; canonical, deliberately not imported). */
export type OrderPriority = 'low' | 'normal' | 'high' | 'critical';

/** A composed fact: the acknowledgment or a replayed verb fact. */
export interface OrderExecutedFact {
  readonly type: string;
  readonly priority: OrderPriority;
  readonly payload: unknown;
}

/** Structural mirror of the domain-producer shape (accepts the real ones). */
export interface OrderSubProducer {
  (input: {
    readonly type: string;
    readonly caller: PlayerId;
    readonly params: unknown;
    readonly before: WorldState;
    readonly after: WorldState;
  }): ReadonlyArray<OrderExecutedFact>;
}

/** Match-injected live maps (treasury precedent): verbs + their rules. */
export interface ExecuteDeps {
  readonly handlers: ReadonlyMap<string, TransitionHandler<WorldState>>;
  readonly rules: ReadonlyMap<string, OrderPreRule>;
}

export function createExecuteHandler(deps: ExecuteDeps): TransitionHandler<WorldState> {
  return (ctx) => {
    // The shared commander-id pre-rule validated an { id } string on the
    // dispatch path; this cast documents the seam (match.ts precedent).
    const { id } = ctx.params as ExecuteOrderParams;
    const data = ctx.state.commanders;
    const record = commanderById(data, id);
    if (data === undefined || record === undefined) {
      return { applied: false, reason: 'execute: unknown commander.' };
    }
    if (record.owner !== ctx.caller) {
      return { applied: false, reason: 'execute: not owner.' };
    }
    const queue = record.orders ?? [];
    const head = queue[0];
    if (head === undefined) {
      return { applied: false, reason: 'execute: queue empty.' };
    }
    const rule = deps.rules.get(head.kind);
    if (rule === undefined) {
      return { applied: false, reason: 'execute: no rule.' };
    }
    if (rule(ctx.caller, head.params, ctx.state) !== null) {
      return { applied: false, reason: 'execute: bad head.' };
    }
    const handler = deps.handlers.get(head.kind);
    if (handler === undefined) {
      return { applied: false, reason: 'execute: no handler.' };
    }
    const popped: CommandersData = {
      schemaVersion: data.schemaVersion,
      nextId: data.nextId,
      commanders: data.commanders.map((entry) =>
        entry.id === id ? { ...entry, orders: queue.slice(1) } : entry,
      ),
    };
    const sub = handler({
      ...ctx,
      state: { ...ctx.state, commanders: popped },
      params: head.params,
    });
    if (!sub.applied) {
      return { applied: false, reason: sub.reason };
    }
    return {
      applied: true,
      state: sub.state,
      summary: `executed ${head.kind} on ${id}`,
    };
  };
}

export function orderExecutionHandlers(
  deps: ExecuteDeps,
): Map<string, TransitionHandler<WorldState>> {
  return new Map([[EXECUTE_TRANSITION, createExecuteHandler(deps)]]);
}

/**
 * Structural EventProducer: order.executed acknowledgment + the verb's own
 * facts replayed behind (riders-behind mold); kind+params derive from the
 * before-head. Underivable input throws (fail-loud, M040 doctrine —
 * applied execute always pops exactly its head).
 */
export function createOrderExecutedProducer(
  sub: ReadonlyMap<string, OrderSubProducer>,
): (input: {
  readonly type: string;
  readonly caller: PlayerId;
  readonly params: unknown;
  readonly before: WorldState;
  readonly after: WorldState;
}) => ReadonlyArray<OrderExecutedFact> {
  return (input) => {
    const raw = input.params;
    const id =
      typeof raw === 'object' && raw !== null && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)['id']
        : undefined;
    if (typeof id !== 'string') {
      throw new Error('orderExecutedProducer: execute takes { id }.');
    }
    const record = input.before.commanders?.commanders.find((entry) => entry.id === id);
    if (record === undefined) {
      throw new Error('orderExecutedProducer: unknown commander.');
    }
    const queue = record.orders ?? [];
    const head = queue[0];
    if (head === undefined) {
      throw new Error('orderExecutedProducer: executed an empty queue.');
    }
    const afterOrders =
      input.after.commanders?.commanders.find((entry) => entry.id === id)?.orders ?? [];
    if (JSON.stringify(afterOrders) !== JSON.stringify(queue.slice(1))) {
      throw new Error('orderExecutedProducer: queue did not pop its head.');
    }
    const facts: OrderExecutedFact[] = [
      {
        type: 'order.executed',
        priority: 'normal',
        payload: {
          player: record.owner,
          commander: id,
          kind: head.kind,
          depth: afterOrders.length,
        },
      },
    ];
    const replay = sub.get(head.kind);
    if (replay !== undefined) {
      facts.push(
        ...replay({
          type: head.kind,
          caller: input.caller,
          params: head.params,
          before: input.before,
          after: input.after,
        }),
      );
    }
    return facts;
  };
}
