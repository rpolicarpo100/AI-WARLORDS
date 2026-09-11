/**
 * M047 — Order override transition (LAYER L2).
 *
 * Resolution over the M046 challenge (D-041, voted override-head):
 * order.override replaces the challenged HEAD with a substitute order
 * (owner-only) and clears the refutation atomically. The challenge must
 * be present, head-anchored (orderIndex 0), and fresh (head kind still
 * matches) — stale challenges fail closed with the queue and the
 * refutation intact (M045 precedent). The substitute passes the same
 * L0 gates as an issue (orderable kind + flat envelope). The override
 * is the only refutation clearer, so the structural before/after diff
 * is exact. LAYER L2 (imports authority/commanders/orders L0 +
 * world-state L1 type-only, all downward; the wire rule mirrors
 * issueParamsRule — order-state sits at L2 too, L2↛L2).
 */

import type { PlayerId, TransitionHandler } from './authority.js';
import {
  clearRefutation,
  commanderById,
  type CommanderOrder,
  type CommanderRecord,
  type CommandersData,
} from './commanders.js';
import { isCommanderOrder, isOrderKind } from './orders.js';
import type { WorldState } from './world-state.js';

export const OVERRIDE_TRANSITION = 'order.override';

/** Validated override parameters: target commander, substitute verb, envelope args. */
export interface OverrideOrderParams {
  readonly id: string;
  readonly kind: string;
  readonly params?: unknown;
}

/** Wire-shape pre-rule (game rules live in the handler, not here). */
export function overrideParamsRule(
  _caller: PlayerId,
  params: unknown,
): { readonly rule: string; readonly detail: string } | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return { rule: 'override-params', detail: 'override takes { id, kind, params? }' };
  }
  const fields = params as Record<string, unknown>;
  if (typeof fields['id'] !== 'string' || typeof fields['kind'] !== 'string') {
    return { rule: 'override-params', detail: 'override takes { id string, kind string }' };
  }
  const args = fields['params'];
  if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
    return { rule: 'override-params', detail: 'override params must be an object' };
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

export function createOverrideHandler(): TransitionHandler<WorldState> {
  return (ctx) => {
    // The pre-rule validated { id, kind, params? } shape on the dispatch
    // path; this cast documents the seam (match.ts `validated` precedent).
    const { id, kind, params } = ctx.params as OverrideOrderParams;
    const data = ctx.state.commanders;
    const record = commanderById(data, id);
    if (data === undefined || record === undefined) {
      return { applied: false, reason: 'override: unknown commander.' };
    }
    if (record.owner !== ctx.caller) {
      return { applied: false, reason: 'override: not owner.' };
    }
    const refutation = record.refutation;
    if (refutation === undefined) {
      return { applied: false, reason: 'override: no refutation.' };
    }
    if (refutation.orderIndex !== 0) {
      return { applied: false, reason: 'override: not head.' };
    }
    const queue = record.orders ?? [];
    if (queue.length === 0) {
      return { applied: false, reason: 'override: queue empty.' };
    }
    const head = queue[0];
    if (head === undefined || head.kind !== refutation.kind) {
      return { applied: false, reason: 'override: stale refutation.' };
    }
    if (!isOrderKind(kind)) {
      return { applied: false, reason: 'override: unknown kind.' };
    }
    const candidate: unknown = params === undefined ? { kind } : { kind, params };
    if (!isCommanderOrder(candidate)) {
      return { applied: false, reason: 'override: bad params.' };
    }
    const substitute: CommanderOrder =
      candidate.params === undefined
        ? { kind: candidate.kind }
        : { kind: candidate.kind, params: { ...candidate.params } };
    const next: CommanderRecord = clearRefutation({
      ...record,
      orders: [substitute, ...queue.slice(1)],
    });
    return {
      applied: true,
      state: { ...ctx.state, commanders: replaceRecord(data, id, next) },
      summary: `overrode ${head.kind} with ${kind} on ${id}`,
    };
  };
}

export function orderOverrideHandlers(): Map<string, TransitionHandler<WorldState>> {
  return new Map([[OVERRIDE_TRANSITION, createOverrideHandler()]]);
}

type OverrideFact = {
  readonly type: string;
  readonly priority: 'normal';
  readonly payload: unknown;
};

/**
 * Structural EventProducer: overridden facts from refutation clears
 * (override is the only clearer — exact; after-array order keeps facts
 * deterministic).
 */
export function orderOverriddenProducer(input: {
  readonly type: string;
  readonly caller: PlayerId;
  readonly params: unknown;
  readonly before: WorldState;
  readonly after: WorldState;
}): ReadonlyArray<OverrideFact> {
  const facts: OverrideFact[] = [];
  const was = new Map(
    (input.before.commanders?.commanders ?? []).map((record) => [record.id, record] as const),
  );
  for (const record of input.after.commanders?.commanders ?? []) {
    const before = was.get(record.id);
    const nowHead = (record.orders ?? [])[0];
    const wasHead = (before?.orders ?? [])[0];
    if (
      before !== undefined &&
      before.refutation !== undefined &&
      record.refutation === undefined &&
      wasHead !== undefined &&
      nowHead !== undefined
    ) {
      facts.push({
        type: 'order.overridden',
        priority: 'normal',
        payload: {
          player: record.owner,
          commander: record.id,
          kind: nowHead.kind,
          over: wasHead.kind,
          reason: before.refutation.reason,
        },
      });
    }
  }
  return facts;
}
