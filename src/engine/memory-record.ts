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
 * system transition cannot bloat revisions). Battle and sighting
 * events carry no commander — SKIPPED whole (attribution deferred
 * to M053, vocabulary already shipped). LAYER L2 (imports
 * authority/commanders/memories L0 + world-state L1 type-only, all
 * downward; the wire rule mirrors overrideParamsRule — validation
 * sits at L2 too, L2↛L2).
 */

import type { PlayerId, TransitionHandler } from './authority.js';
import type { CommanderMemory } from './commanders.js';
import { isCommanderMemory, MAX_MEMORIES_PER_COMMANDER } from './memories.js';
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
    const wanted = new Map<string, CommanderMemory[]>();
    for (const event of readRecordEvents(ctx.params)) {
      const memory = toMemory(event);
      if (memory === undefined) {
        continue;
      }
      const known = wanted.get(memory.subject);
      if (known === undefined) {
        wanted.set(memory.subject, [memory]);
      } else {
        known.push(memory);
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

/**
 * One stamped event → one memory, or undefined (fail-closed).
 * GameEvents carry the kind in `type`; only payloads naming a
 * commander attribute (battle/sighting skip whole — M053 owns).
 */
function toMemory(event: unknown): CommanderMemory | undefined {
  if (typeof event !== 'object' || event === null || Array.isArray(event)) {
    return undefined;
  }
  const fields = event as Record<string, unknown>;
  const payload = fields['payload'];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return undefined;
  }
  const commander = (payload as Record<string, unknown>)['commander'];
  if (typeof commander !== 'string') {
    return undefined;
  }
  const candidate = {
    seq: fields['seq'],
    revision: fields['revision'],
    kind: fields['type'],
    subject: commander,
  };
  return isCommanderMemory(candidate) ? candidate : undefined;
}
