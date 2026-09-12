/**
 * M056 — Directive set/clear transitions (LAYER L2).
 *
 * Mechanics over the M055 set (D-050, voted directive-set-stance):
 * directive.set writes one standing player instruction (overwrite);
 * directive.clear drops one kind (the set shrinks; an emptied set
 * drops the key whole — M047 mutable-spread law). Owner-only
 * (M044/M047 mold); unknown commanders and clearing unset kinds
 * fail closed ('not set' mirrors 'cancel: no orders'). Structural
 * producers emit set/cleared facts (audit on the stream; NOT
 * memorable — memory of directives is future). LAYER L2 (imports
 * authority/commanders/directives L0 + world-state L1 type-only,
 * all downward; replaceRecord is local — order-state sits at L2
 * too, L2↛L2).
 */

import type { PlayerId, TransitionHandler } from './authority.js';
import {
  commanderById,
  type CommanderDirectives,
  type CommanderRecord,
  type CommandersData,
} from './commanders.js';
import {
  isAutonomyLevel,
  isDirectiveKind,
  isDirectiveStance,
  type AutonomyLevel,
  type DirectiveKind,
  type DirectiveStance,
} from './directives.js';
import type { WorldState } from './world-state.js';

export const SET_TRANSITION = 'directive.set';
export const CLEAR_TRANSITION = 'directive.clear';

/** Validated set parameters: target commander, kind, per-kind value. */
export interface SetDirectiveParams {
  readonly id: string;
  readonly kind: string;
  readonly value: string;
}

/** Validated clear parameters: target commander, kind. */
export interface ClearDirectiveParams {
  readonly id: string;
  readonly kind: string;
}

function replaceRecord(data: CommandersData, id: string, next: CommanderRecord): CommandersData {
  return {
    ...data,
    commanders: data.commanders.map((record) => (record.id === id ? next : record)),
  };
}

/** Wire-shape pre-rule (game rules live in the handler, not here). */
export function setParamsRule(
  _caller: PlayerId,
  params: unknown,
): { readonly rule: string; readonly detail: string } | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return { rule: 'directive-params', detail: 'set takes { id, kind, value }' };
  }
  const fields = params as Record<string, unknown>;
  if (typeof fields['id'] !== 'string') {
    return { rule: 'directive-params', detail: 'set takes { id string }' };
  }
  if (!isDirectiveKind(fields['kind'])) {
    return { rule: 'directive-params', detail: 'set takes kind autonomy|stance' };
  }
  const kind: DirectiveKind = fields['kind'];
  const value = fields['value'];
  const valid = kind === 'autonomy' ? isAutonomyLevel(value) : isDirectiveStance(value);
  if (!valid) {
    return { rule: 'directive-params', detail: `set takes a valid ${kind} value` };
  }
  return null;
}

/** Wire-shape pre-rule (game rules live in the handler, not here). */
export function clearParamsRule(
  _caller: PlayerId,
  params: unknown,
): { readonly rule: string; readonly detail: string } | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return { rule: 'directive-params', detail: 'clear takes { id, kind }' };
  }
  const fields = params as Record<string, unknown>;
  if (typeof fields['id'] !== 'string') {
    return { rule: 'directive-params', detail: 'clear takes { id string }' };
  }
  if (!isDirectiveKind(fields['kind'])) {
    return { rule: 'directive-params', detail: 'clear takes kind autonomy|stance' };
  }
  return null;
}

export function createSetHandler(): TransitionHandler<WorldState> {
  return (ctx) => {
    // The wire pre-rule validated { id, kind, value } on the dispatch
    // path; this cast documents the seam (match.ts precedent).
    const { id, kind, value } = ctx.params as SetDirectiveParams;
    const data = ctx.state.commanders;
    const record = commanderById(data, id);
    if (data === undefined || record === undefined) {
      return { applied: false, reason: 'directive.set: unknown commander.' };
    }
    if (record.owner !== ctx.caller) {
      return { applied: false, reason: 'directive.set: not owner.' };
    }
    const next: CommanderDirectives = { ...(record.directives ?? {}), [kind]: value } as {
      readonly autonomy?: AutonomyLevel;
      readonly stance?: DirectiveStance;
    };
    return {
      applied: true,
      state: { ...ctx.state, commanders: replaceRecord(data, id, { ...record, directives: next }) },
      summary: `set ${kind} on ${id}`,
    };
  };
}

export function createClearHandler(): TransitionHandler<WorldState> {
  return (ctx) => {
    // The wire pre-rule validated { id, kind } on the dispatch path;
    // this cast documents the seam (match.ts precedent).
    const { id, kind } = ctx.params as ClearDirectiveParams;
    const data = ctx.state.commanders;
    const record = commanderById(data, id);
    if (data === undefined || record === undefined) {
      return { applied: false, reason: 'directive.clear: unknown commander.' };
    }
    if (record.owner !== ctx.caller) {
      return { applied: false, reason: 'directive.clear: not owner.' };
    }
    if (record.directives?.[kind as DirectiveKind] === undefined) {
      return { applied: false, reason: 'directive.clear: not set.' };
    }
    const kept: { autonomy?: AutonomyLevel; stance?: DirectiveStance } = {};
    if (kind !== 'autonomy' && record.directives?.autonomy !== undefined) {
      kept.autonomy = record.directives.autonomy;
    }
    if (kind !== 'stance' && record.directives?.stance !== undefined) {
      kept.stance = record.directives.stance;
    }
    // Emptied sets drop the key whole (never an explicit undefined — M047 law).
    const next: CommanderRecord =
      kept.autonomy === undefined && kept.stance === undefined
        ? (Object.fromEntries(
            Object.entries(record).filter(([key]) => key !== 'directives'),
          ) as CommanderRecord)
        : { ...record, directives: kept };
    return {
      applied: true,
      state: { ...ctx.state, commanders: replaceRecord(data, id, next) },
      summary: `cleared ${kind} on ${id}`,
    };
  };
}

export function directiveStateHandlers(): Map<string, TransitionHandler<WorldState>> {
  return new Map([
    [SET_TRANSITION, createSetHandler()],
    [CLEAR_TRANSITION, createClearHandler()],
  ]);
}

type DirectiveFact = {
  readonly type: string;
  readonly priority: 'normal';
  readonly payload: unknown;
};

export interface DirectiveProducerInput {
  readonly before: WorldState;
  readonly after: WorldState;
}

/** Structural set facts: kinds set or overwritten per commander. */
export function directiveSetProducer(input: DirectiveProducerInput): ReadonlyArray<DirectiveFact> {
  const facts: DirectiveFact[] = [];
  const before = new Map(
    (input.before.commanders?.commanders ?? []).map((record) => [record.id, record] as const),
  );
  for (const record of input.after.commanders?.commanders ?? []) {
    const was = before.get(record.id)?.directives;
    for (const kind of ['autonomy', 'stance'] as const) {
      const now = record.directives?.[kind];
      if (now !== undefined && now !== was?.[kind]) {
        facts.push({
          type: 'directive.set',
          priority: 'normal',
          payload: { player: record.owner, commander: record.id, kind, value: now },
        });
      }
    }
  }
  return facts;
}

/** Structural cleared facts: kinds dropped per commander. */
export function directiveClearedProducer(
  input: DirectiveProducerInput,
): ReadonlyArray<DirectiveFact> {
  const facts: DirectiveFact[] = [];
  const after = new Map(
    (input.after.commanders?.commanders ?? []).map((record) => [record.id, record] as const),
  );
  for (const record of input.before.commanders?.commanders ?? []) {
    const now = after.get(record.id)?.directives;
    for (const kind of ['autonomy', 'stance'] as const) {
      if (record.directives?.[kind] !== undefined && now?.[kind] === undefined) {
        facts.push({
          type: 'directive.cleared',
          priority: 'normal',
          payload: { player: record.owner, commander: record.id, kind },
        });
      }
    }
  }
  return facts;
}
