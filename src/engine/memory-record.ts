/**
 * M052 — Memory record transition (LAYER L2).
 *
 * Write path over the M051 log (D-046, voted record-verb +
 * attribute-named): memory.record persists stamped stream events as
 * commander memories. Per event, fail-closed skips: kind not
 * memorable? payload names no commander? commander unknown, or
 * owned by another caller (anti-spam: you only write your own
 * logs)? malformed? already logged (seq dedup)? — skip. Survivors
 * append (FIFO cap 8, oldest evicted). Subject is the named
 * commander itself — details live at the referenced seq (the M051
 * self-validating pointer). Zero survivors reject ('record:
 * nothing memorable.' — rejected are free, D-022: the budget-free
 * system transition cannot bloat revisions). M053 attributes the
 * commander-less battle/sighting facts caller-bound to the
 * caller's ACTIVE commanders (subject-is-unit); enemy dispatches
 * never write your logs. LAYER L2 (imports
 * authority/commanders/memories L0 + world-state L1 type-only, all
 * downward; the wire rule mirrors overrideParamsRule — validation
 * sits at L2 too, L2↛L2).
 */

import type { PlayerId, TransitionHandler } from './authority.js';
import type { CommanderMemory, CommanderRecord } from './commanders.js';
import { isAmbientKind, isCommanderMemory, MAX_MEMORIES_PER_COMMANDER } from './memories.js';
import type { WorldState } from './world-state.js';

export const RECORD_TRANSITION = 'memory.record';

/** Wire ceiling: one dispatch emits a handful of events; bound the envelope. */
export const MAX_RECORD_EVENTS = 32;

/** Wire-shape pre-rule (per-event rules live in the handler, not here). */
export function recordParamsRule(
  _caller: PlayerId,
  params: unknown,
): { readonly rule: string; readonly detail: string } | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return { rule: 'record-params', detail: 'record takes { events }' };
  }
  const events = (params as Record<string, unknown>)['events'];
  if (!Array.isArray(events)) {
    return { rule: 'record-params', detail: 'record takes { events: array }' };
  }
  if (events.length === 0) {
    return { rule: 'record-params', detail: 'record takes a non-empty events array' };
  }
  if (events.length > MAX_RECORD_EVENTS) {
    return { rule: 'record-params', detail: `record takes at most ${MAX_RECORD_EVENTS} events` };
  }
  return null;
}

export function memoryRecordHandlers(): Map<string, TransitionHandler<WorldState>> {
  return new Map([[RECORD_TRANSITION, createRecordHandler()]]);
}

function createRecordHandler(): TransitionHandler<WorldState> {
  return (ctx) => {
    const data = ctx.state.commanders;
    const records = data?.commanders ?? [];
    const wanted = new Map<string, CommanderMemory[]>();
    for (const event of readRecordEvents(ctx.params)) {
      // M053: named events resolve to one commander; ambient events
      // fan out to the caller's active commanders (or nowhere).
      for (const attributed of attribute(event, ctx.caller, records)) {
        const known = wanted.get(attributed.to);
        if (known === undefined) {
          wanted.set(attributed.to, [attributed.memory]);
        } else {
          known.push(attributed.memory);
        }
      }
    }
    if (wanted.size === 0 || data === undefined) {
      return { applied: false, reason: 'record: nothing memorable.' };
    }
    let recorded = 0;
    const commanders = data.commanders.map((record) => {
      const additions = wanted.get(record.id);
      if (additions === undefined || record.owner !== ctx.caller) {
        return record;
      }
      const seen = new Set((record.memories ?? []).map((entry) => entry.seq));
      const fresh: CommanderMemory[] = [];
      for (const memory of additions) {
        if (seen.has(memory.seq)) {
          continue;
        }
        seen.add(memory.seq);
        fresh.push(memory);
      }
      if (fresh.length === 0) {
        return record;
      }
      recorded += fresh.length;
      const next = [...(record.memories ?? []), ...fresh];
      return { ...record, memories: next.slice(-MAX_MEMORIES_PER_COMMANDER) };
    });
    if (recorded === 0) {
      return { applied: false, reason: 'record: nothing memorable.' };
    }
    return {
      applied: true,
      state: { ...ctx.state, commanders: { ...data, commanders } },
      summary: `recorded ${recorded} ${recorded === 1 ? 'memory' : 'memories'}`,
    };
  };
}

/** Envelope read (the rule gates shape; the handler stays total anyway). */
function readRecordEvents(params: unknown): readonly unknown[] {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return [];
  }
  const events = (params as Record<string, unknown>)['events'];
  return Array.isArray(events) ? events : [];
}

/** One memory resolved to the commander that keeps it. */
interface AttributedMemory {
  readonly to: string;
  readonly memory: CommanderMemory;
}

/**
 * One stamped event → attributed memories, or none (fail-closed).
 * GameEvents carry the kind in `type`. Named events (payload
 * commander) resolve to that commander, subject-is-self (M052).
 * Ambient battle/sighting facts fan out to the caller's ACTIVE
 * commanders, subject-is-unit (M053) — caller-bound, so enemy
 * dispatches never write your logs (the budget-free transition
 * cannot become a memory-wipe).
 */
function attribute(
  event: unknown,
  caller: PlayerId,
  records: readonly CommanderRecord[],
): readonly AttributedMemory[] {
  if (typeof event !== 'object' || event === null || Array.isArray(event)) {
    return [];
  }
  const fields = event as Record<string, unknown>;
  const payload = fields['payload'];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return [];
  }
  const named = (payload as Record<string, unknown>)['commander'];
  if (typeof named === 'string') {
    const candidate = {
      seq: fields['seq'],
      revision: fields['revision'],
      kind: fields['type'],
      subject: named,
    };
    return isCommanderMemory(candidate) ? [{ to: named, memory: candidate }] : [];
  }
  return ambient(fields, payload as Record<string, unknown>, caller, records);
}

function ambient(
  fields: Record<string, unknown>,
  payload: Record<string, unknown>,
  caller: PlayerId,
  records: readonly CommanderRecord[],
): readonly AttributedMemory[] {
  if (!isAmbientKind(fields['type'])) {
    return [];
  }
  if (payload['player'] !== caller) {
    return [];
  }
  const unit = payload['unit'];
  if (typeof unit !== 'string') {
    return [];
  }
  const candidate = {
    seq: fields['seq'],
    revision: fields['revision'],
    kind: fields['type'],
    subject: unit,
  };
  if (!isCommanderMemory(candidate)) {
    return [];
  }
  return records
    .filter((record) => record.active && record.owner === caller)
    .map((record) => ({ to: record.id, memory: candidate }));
}
