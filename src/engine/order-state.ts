/**
 * M044 — Order queue transitions: issue + cancel (LAYER L2).
 *
 * Mechanics over the M043 queue (D-038, voted fifo-queue): issue appends
 * one envelope-validated order (owner-only, capped, duplicates apply —
 * queue position matters); cancel clears the whole queue (owner-only;
 * empty queues fail closed, no-op precedent). Per-kind executable
 * semantics belong to M045 (L2↛L2 bars reusing the domain pre-rules
 * here); the L0 envelope (orders.ts canonical) is the total gate.
 * Events are structural before/after diffs (commissionedProducer
 * precedent): issue is the only queue writer, cancel the only
 * clearer, so diffs are exact. LAYER L2 (imports
 * authority/commanders/orders L0 + world-state L1 type-only, all
 * downward; CancelOrderParams mirrors CommanderIdParams —
 * commander-state sits at L2 too, L2↛L2).
 */

import type { PlayerId, TransitionHandler } from './authority.js';
import {
  commanderById,
  type CommanderOrder,
  type CommanderRecord,
  type CommandersData,
} from './commanders.js';
import { isCommanderOrder, isOrderKind, MAX_ORDERS_PER_COMMANDER } from './orders.js';
import type { WorldState } from './world-state.js';

export const ISSUE_TRANSITION = 'order.issue';
export const CANCEL_TRANSITION = 'order.cancel';

/** Validated issue parameters: target commander, verb, envelope args. */
export interface IssueOrderParams {
  readonly id: string;
  readonly kind: string;
  readonly params?: unknown;
}

/** Structural mirror of CommanderIdParams (commander-state L2↛L2). */
export interface CancelOrderParams {
  readonly id: string;
}

/** Wire-shape pre-rule (game rules live in the handler, not here). */
export function issueParamsRule(
  _caller: PlayerId,
  params: unknown,
): { readonly rule: string; readonly detail: string } | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return { rule: 'issue-params', detail: 'issue takes { id, kind, params? }' };
  }
  const fields = params as Record<string, unknown>;
  if (typeof fields['id'] !== 'string' || typeof fields['kind'] !== 'string') {
    return { rule: 'issue-params', detail: 'issue takes { id string, kind string }' };
  }
  const args = fields['params'];
  if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
    return { rule: 'issue-params', detail: 'issue params must be an object' };
  }
  return null;
}

function replaceRecord(data: CommandersData, id: string, next: CommanderRecord): CommandersData {
  return {
    schemaVersion: data.schemaVersion,
    nextId: data.nextId,
    commanders: data.commanders.map((record) => (record.id === id ? next : record)),
  };
}

export function createIssueHandler(): TransitionHandler<WorldState> {
  return (ctx) => {
    // The pre-rule validated { id, kind, params? } shape on the dispatch
    // path; this cast documents the seam (match.ts `validated` precedent).
    const { id, kind, params } = ctx.params as IssueOrderParams;
    const data = ctx.state.commanders;
    const record = commanderById(data, id);
    if (data === undefined || record === undefined) {
      return { applied: false, reason: 'issue: unknown commander.' };
    }
    if (record.owner !== ctx.caller) {
      return { applied: false, reason: 'issue: not owner.' };
    }
    if (!isOrderKind(kind)) {
      return { applied: false, reason: 'issue: unknown kind.' };
    }
    const candidate: unknown = params === undefined ? { kind } : { kind, params };
    if (!isCommanderOrder(candidate)) {
      return { applied: false, reason: 'issue: bad params.' };
    }
    const queue = record.orders ?? [];
    if (queue.length >= MAX_ORDERS_PER_COMMANDER) {
      return { applied: false, reason: 'issue: queue full.' };
    }
    const queued: CommanderOrder =
      candidate.params === undefined
        ? { kind: candidate.kind }
        : { kind: candidate.kind, params: { ...candidate.params } };
    return {
      applied: true,
      state: {
        ...ctx.state,
        commanders: replaceRecord(data, id, { ...record, orders: [...queue, queued] }),
      },
      summary: `issued ${kind} to ${id}`,
    };
  };
}

export function createCancelHandler(): TransitionHandler<WorldState> {
  return (ctx) => {
    // The shared commander-id pre-rule validated an { id } string on the
    // dispatch path; this cast documents the seam (match.ts precedent).
    const { id } = ctx.params as CancelOrderParams;
    const data = ctx.state.commanders;
    const record = commanderById(data, id);
    if (data === undefined || record === undefined) {
      return { applied: false, reason: 'cancel: unknown commander.' };
    }
    if (record.owner !== ctx.caller) {
      return { applied: false, reason: 'cancel: not owner.' };
    }
    const queue = record.orders ?? [];
    if (queue.length === 0) {
      return { applied: false, reason: 'cancel: no orders.' };
    }
    return {
      applied: true,
      state: { ...ctx.state, commanders: replaceRecord(data, id, { ...record, orders: [] }) },
      summary: `canceled ${queue.length} orders on ${id}`,
    };
  };
}

export function orderHandlers(): Map<string, TransitionHandler<WorldState>> {
  return new Map([
    [ISSUE_TRANSITION, createIssueHandler()],
    [CANCEL_TRANSITION, createCancelHandler()],
  ]);
}

type OrderFact = {
  readonly type: string;
  readonly priority: 'normal';
  readonly payload: unknown;
};

/**
 * Structural EventProducer: issued facts from queue tail-diff (issue is
 * the only queue writer and appends — exact; after-array order keeps
 * facts deterministic).
 */
export function orderIssuedProducer(input: {
  readonly type: string;
  readonly caller: PlayerId;
  readonly params: unknown;
  readonly before: WorldState;
  readonly after: WorldState;
}): ReadonlyArray<OrderFact> {
  const facts: OrderFact[] = [];
  const was = new Map(
    (input.before.commanders?.commanders ?? []).map(
      (record) => [record.id, record.orders ?? []] as const,
    ),
  );
  for (const record of input.after.commanders?.commanders ?? []) {
    const before = was.get(record.id) ?? [];
    const now = record.orders ?? [];
    for (const order of now.slice(before.length)) {
      facts.push({
        type: 'order.issued',
        priority: 'normal',
        payload: {
          player: record.owner,
          commander: record.id,
          kind: order.kind,
          depth: now.length,
        },
      });
    }
  }
  return facts;
}

/**
 * Structural EventProducer: canceled facts from queue clears (cancel is
 * the only clearer — exact; after-array order keeps facts
 * deterministic).
 */
export function orderCanceledProducer(input: {
  readonly type: string;
  readonly caller: PlayerId;
  readonly params: unknown;
  readonly before: WorldState;
  readonly after: WorldState;
}): ReadonlyArray<OrderFact> {
  const facts: OrderFact[] = [];
  const was = new Map(
    (input.before.commanders?.commanders ?? []).map(
      (record) => [record.id, (record.orders ?? []).length] as const,
    ),
  );
  for (const record of input.after.commanders?.commanders ?? []) {
    const cleared = was.get(record.id) ?? 0;
    const now = (record.orders ?? []).length;
    if (cleared > 0 && now === 0) {
      facts.push({
        type: 'order.canceled',
        priority: 'normal',
        payload: { player: record.owner, commander: record.id, cleared },
      });
    }
  }
  return facts;
}
