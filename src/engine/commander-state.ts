/**
 * M029 — Commander lifecycle: commission + activate/deactivate (LAYER L2).
 *
 * Transitions over the M027 roster (D-023, voted scope): commission mints
 * `c${nextId}` (owner = caller, active from birth — in service on
 * commission) and bootstraps absent data (fail-soft, cityOf precedent);
 * activate/deactivate flip `active` owner-only (cross-holder writes
 * fail closed; unknown ids and no-op flips return applied:false, upgrade
 * precedent). `active` is a MARKER with no engine effect (voted; teeth
 * belong to orders/AI — M043+/M035+); the roster is uncapped (voted N
 * per holder; MAX_STATE_BYTES self-limits spam, city-queue precedent).
 * LAYER L2 (imports authority/commanders/rng L0 + world-state L1
 * type-only, all downward). Events are structural before/after diffs
 * (completionProducer precedent): the three handlers are the only
 * commanders writers, so diffs are exact.
 */

import type { PlayerId, TransitionHandler } from './authority.js';
import {
  COMMANDERS_SCHEMA_VERSION,
  commanderById,
  type CommanderRecord,
  type CommandersData,
} from './commanders.js';
import { MAX_UINT32 } from './rng.js';
import type { WorldState } from './world-state.js';

export const COMMISSION_TRANSITION = 'commander.commission';
export const ACTIVATE_TRANSITION = 'commander.activate';
export const DEACTIVATE_TRANSITION = 'commander.deactivate';

/** Validated activate/deactivate parameters: which commander to flip. */
export interface CommanderIdParams {
  readonly id: string;
}

/** Wire-shape pre-rule (game rules live in the handler, not here). */
export function commanderIdParamsRule(
  _caller: PlayerId,
  params: unknown,
): { readonly rule: string; readonly detail: string } | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return { rule: 'commander-id-params', detail: 'command takes { id }' };
  }
  const fields = params as Record<string, unknown>;
  if (typeof fields['id'] !== 'string') {
    return { rule: 'commander-id-params', detail: 'command takes a string id' };
  }
  return null;
}

export function createCommissionHandler(): TransitionHandler<WorldState> {
  return (ctx) => {
    const known = ctx.state.commanders;
    const nextId = known?.nextId ?? 0;
    if (nextId >= MAX_UINT32) {
      return { applied: false, reason: 'commission: roster exhausted.' };
    }
    const minted: CommanderRecord = { id: `c${nextId}`, owner: ctx.caller, active: true };
    const commanders: CommandersData = {
      schemaVersion: COMMANDERS_SCHEMA_VERSION,
      nextId: nextId + 1,
      commanders: [...(known?.commanders ?? []), minted],
    };
    return {
      applied: true,
      state: { ...ctx.state, commanders },
      summary: `commissioned ${minted.id}`,
    };
  };
}

function flipActive(data: CommandersData, id: string, active: boolean): CommandersData {
  return {
    schemaVersion: data.schemaVersion,
    nextId: data.nextId,
    commanders: data.commanders.map((record) =>
      record.id === id ? { ...record, active } : record,
    ),
  };
}

export function createActivateHandler(): TransitionHandler<WorldState> {
  return (ctx) => {
    // The pre-rule validated an { id } string on the dispatch path;
    // this cast documents the seam (match.ts `validated` precedent).
    const { id } = ctx.params as CommanderIdParams;
    const data = ctx.state.commanders;
    const record = commanderById(data, id);
    if (data === undefined || record === undefined) {
      return { applied: false, reason: 'activate: unknown commander.' };
    }
    if (record.owner !== ctx.caller) {
      return { applied: false, reason: 'activate: not owner.' };
    }
    if (record.active) {
      return { applied: false, reason: 'activate: already active.' };
    }
    return {
      applied: true,
      state: { ...ctx.state, commanders: flipActive(data, id, true) },
      summary: `activated ${id}`,
    };
  };
}

export function createDeactivateHandler(): TransitionHandler<WorldState> {
  return (ctx) => {
    const { id } = ctx.params as CommanderIdParams;
    const data = ctx.state.commanders;
    const record = commanderById(data, id);
    if (data === undefined || record === undefined) {
      return { applied: false, reason: 'deactivate: unknown commander.' };
    }
    if (record.owner !== ctx.caller) {
      return { applied: false, reason: 'deactivate: not owner.' };
    }
    if (!record.active) {
      return { applied: false, reason: 'deactivate: already inactive.' };
    }
    return {
      applied: true,
      state: { ...ctx.state, commanders: flipActive(data, id, false) },
      summary: `deactivated ${id}`,
    };
  };
}

export function commanderHandlers(): Map<string, TransitionHandler<WorldState>> {
  return new Map([
    [COMMISSION_TRANSITION, createCommissionHandler()],
    [ACTIVATE_TRANSITION, createActivateHandler()],
    [DEACTIVATE_TRANSITION, createDeactivateHandler()],
  ]);
}

type CommanderFact = {
  readonly type: string;
  readonly priority: 'normal';
  readonly payload: unknown;
};

/**
 * Structural EventProducer: commissioned facts from id-diff (commission
 * is the only id writer — exact; after-array order keeps facts
 * deterministic).
 */
export function commissionedProducer(input: {
  readonly type: string;
  readonly caller: PlayerId;
  readonly params: unknown;
  readonly before: WorldState;
  readonly after: WorldState;
}): ReadonlyArray<CommanderFact> {
  const facts: CommanderFact[] = [];
  const seen = new Set((input.before.commanders?.commanders ?? []).map((record) => record.id));
  for (const record of input.after.commanders?.commanders ?? []) {
    if (!seen.has(record.id)) {
      facts.push({
        type: 'commander.commissioned',
        priority: 'normal',
        payload: { player: record.owner, commander: record.id },
      });
    }
  }
  return facts;
}

/**
 * Structural EventProducer: activated/deactivated facts from active-flips
 * (activate/deactivate are the only active writers — exact; after-array
 * order keeps facts deterministic; records without a before-entry are
 * births, not flips — skipped).
 */
export function stateFlipProducer(input: {
  readonly type: string;
  readonly caller: PlayerId;
  readonly params: unknown;
  readonly before: WorldState;
  readonly after: WorldState;
}): ReadonlyArray<CommanderFact> {
  const facts: CommanderFact[] = [];
  const was = new Map(
    (input.before.commanders?.commanders ?? []).map((record) => [record.id, record] as const),
  );
  for (const record of input.after.commanders?.commanders ?? []) {
    const prev = was.get(record.id);
    if (prev === undefined || prev.active === record.active) {
      continue;
    }
    facts.push({
      type: record.active ? 'commander.activated' : 'commander.deactivated',
      priority: 'normal',
      payload: { player: record.owner, commander: record.id },
    });
  }
  return facts;
}
