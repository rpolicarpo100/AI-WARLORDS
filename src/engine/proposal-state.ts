/**
 * M058 — Proposal propose/approve/decline transitions (LAYER L2).
 *
 * Closes the Player ↔ Commander block (M055–M058): the M057 pending
 * slot becomes playable (D-052; no vote — D-051 declared this
 * contract). proposal.propose files one standing commander
 * suggestion (rejected when a proposal already pends — the slot
 * holds attention, verdicts are never silently overwritten);
 * proposal.approve executes the payload (order proposals append to
 * the queue, cap 8 fail-closed; stance and autonomy proposals write
 * the directive) then clears the slot; proposal.decline drops the
 * slot, nothing executes. Owner-only (M044/M047/M056 mold); unknown
 * commanders and empty slots fail closed. Emptied slots drop the
 * key whole (never an explicit undefined — M047 law). Structural
 * producers emit proposed/approved/declined facts (audit on the
 * stream; NOT memorable — M056 precedent). propose is
 * owner-dispatched today (training wheels until M059+ AI writers;
 * no auto-propose). LAYER L2 (imports authority/commanders/
 * proposals L0 + world-state L1 type-only, all downward;
 * replaceRecord is local — directive-state sits at L2 too, L2↛L2).
 */
import type { PlayerId, TransitionHandler } from './authority.js';
import {
  commanderById,
  type CommanderAutonomy,
  type CommanderDirectiveStance,
  type CommanderDirectives,
  type CommanderRecord,
  type CommandersData,
} from './commanders.js';
import { isCommanderProposal, type CommanderProposal } from './proposals.js';
import type { WorldState } from './world-state.js';

export const PROPOSE_TRANSITION = 'proposal.propose';
export const APPROVE_TRANSITION = 'proposal.approve';
export const DECLINE_TRANSITION = 'proposal.decline';

/** Validated propose parameters: target commander, full suggestion. */
export interface ProposeParams {
  readonly id: string;
  readonly proposal: CommanderProposal;
}

function replaceRecord(data: CommandersData, id: string, next: CommanderRecord): CommandersData {
  return {
    ...data,
    commanders: data.commanders.map((record) => (record.id === id ? next : record)),
  };
}

/** Drop the proposal key whole (M047 law — never an explicit undefined). */
function dropProposal(record: CommanderRecord): CommanderRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== 'proposal'),
  ) as CommanderRecord;
}

/** Wire-shape pre-rule (game rules live in the handler, not here). */
export function proposeParamsRule(
  _caller: PlayerId,
  params: unknown,
): { readonly rule: string; readonly detail: string } | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return { rule: 'proposal-params', detail: 'propose takes { id, proposal }' };
  }
  const fields = params as Record<string, unknown>;
  if (typeof fields['id'] !== 'string') {
    return { rule: 'proposal-params', detail: 'propose takes { id string }' };
  }
  if (!isCommanderProposal(fields['proposal'])) {
    return { rule: 'proposal-params', detail: 'propose takes a valid proposal' };
  }
  return null;
}

export function createProposeHandler(): TransitionHandler<WorldState> {
  return (ctx) => {
    // The wire pre-rule validated { id, proposal } on the dispatch
    // path; this cast documents the seam (match.ts precedent).
    const { id, proposal } = ctx.params as ProposeParams;
    const data = ctx.state.commanders;
    const record = commanderById(data, id);
    if (data === undefined || record === undefined) {
      return { applied: false, reason: 'proposal.propose: unknown commander.' };
    }
    if (record.owner !== ctx.caller) {
      return { applied: false, reason: 'proposal.propose: not owner.' };
    }
    if (record.proposal !== undefined) {
      return { applied: false, reason: 'proposal.propose: pending.' };
    }
    return {
      applied: true,
      state: {
        ...ctx.state,
        commanders: replaceRecord(data, id, { ...record, proposal }),
      },
      summary: `proposed ${proposal.kind} on ${id}`,
    };
  };
}

export function createApproveHandler(): TransitionHandler<WorldState> {
  return (ctx) => {
    // The wire pre-rule (commanderIdParamsRule) validated { id } on
    // the dispatch path; this cast documents the seam.
    const { id } = ctx.params as { readonly id: string };
    const data = ctx.state.commanders;
    const record = commanderById(data, id);
    if (data === undefined || record === undefined) {
      return { applied: false, reason: 'proposal.approve: unknown commander.' };
    }
    if (record.owner !== ctx.caller) {
      return { applied: false, reason: 'proposal.approve: not owner.' };
    }
    const proposal = record.proposal;
    if (proposal === undefined) {
      return { applied: false, reason: 'proposal.approve: no proposal.' };
    }
    if (proposal.kind === 'order') {
      const order = proposal.order;
      if (order === undefined) {
        return { applied: false, reason: 'proposal.approve: no proposal.' };
      }
      const orders = record.orders ?? [];
      if (orders.length >= 8) {
        return { applied: false, reason: 'proposal.approve: queue full.' };
      }
      const cleared = dropProposal(record);
      return {
        applied: true,
        state: {
          ...ctx.state,
          commanders: replaceRecord(data, id, { ...cleared, orders: [...orders, order] }),
        },
        summary: `approved order on ${id}`,
      };
    }
    const grant: {
      readonly stance?: CommanderDirectiveStance;
      readonly autonomy?: CommanderAutonomy;
    } = proposal.kind === 'stance' ? { stance: proposal.stance } : { autonomy: proposal.autonomy };
    if (grant.stance === undefined && grant.autonomy === undefined) {
      return { applied: false, reason: 'proposal.approve: no proposal.' };
    }
    const next: CommanderDirectives = { ...record.directives, ...grant };
    const cleared = dropProposal(record);
    return {
      applied: true,
      state: {
        ...ctx.state,
        commanders: replaceRecord(data, id, { ...cleared, directives: next }),
      },
      summary: `approved ${proposal.kind} on ${id}`,
    };
  };
}

export function createDeclineHandler(): TransitionHandler<WorldState> {
  return (ctx) => {
    // The wire pre-rule (commanderIdParamsRule) validated { id } on
    // the dispatch path; this cast documents the seam.
    const { id } = ctx.params as { readonly id: string };
    const data = ctx.state.commanders;
    const record = commanderById(data, id);
    if (data === undefined || record === undefined) {
      return { applied: false, reason: 'proposal.decline: unknown commander.' };
    }
    if (record.owner !== ctx.caller) {
      return { applied: false, reason: 'proposal.decline: not owner.' };
    }
    if (record.proposal === undefined) {
      return { applied: false, reason: 'proposal.decline: no proposal.' };
    }
    return {
      applied: true,
      state: { ...ctx.state, commanders: replaceRecord(data, id, dropProposal(record)) },
      summary: `declined ${record.proposal.kind} on ${id}`,
    };
  };
}

export function proposalStateHandlers(): Map<string, TransitionHandler<WorldState>> {
  return new Map([
    [PROPOSE_TRANSITION, createProposeHandler()],
    [APPROVE_TRANSITION, createApproveHandler()],
    [DECLINE_TRANSITION, createDeclineHandler()],
  ]);
}

type ProposalFact = {
  readonly type: string;
  readonly priority: 'normal';
  readonly payload: unknown;
};

export interface ProposalProducerInput {
  readonly before: WorldState;
  readonly after: WorldState;
}

/** Structural proposed facts: slots that filled. */
export function proposalProposedProducer(
  input: ProposalProducerInput,
): ReadonlyArray<ProposalFact> {
  const facts: ProposalFact[] = [];
  const before = new Map(
    (input.before.commanders?.commanders ?? []).map((record) => [record.id, record] as const),
  );
  for (const record of input.after.commanders?.commanders ?? []) {
    const proposal = record.proposal;
    if (proposal !== undefined && before.get(record.id)?.proposal === undefined) {
      facts.push({
        type: 'proposal.proposed',
        priority: 'normal',
        payload: { player: record.owner, commander: record.id, kind: proposal.kind },
      });
    }
  }
  return facts;
}

/** Structural approved facts: slots that emptied (routing decides approve). */
export function proposalApprovedProducer(
  input: ProposalProducerInput,
): ReadonlyArray<ProposalFact> {
  const facts: ProposalFact[] = [];
  const after = new Map(
    (input.after.commanders?.commanders ?? []).map((record) => [record.id, record] as const),
  );
  for (const record of input.before.commanders?.commanders ?? []) {
    const proposal = record.proposal;
    if (proposal !== undefined && after.get(record.id)?.proposal === undefined) {
      facts.push({
        type: 'proposal.approved',
        priority: 'normal',
        payload: { player: record.owner, commander: record.id, kind: proposal.kind },
      });
    }
  }
  return facts;
}

/** Structural declined facts: slots that emptied (routing decides decline). */
export function proposalDeclinedProducer(
  input: ProposalProducerInput,
): ReadonlyArray<ProposalFact> {
  const facts: ProposalFact[] = [];
  const after = new Map(
    (input.after.commanders?.commanders ?? []).map((record) => [record.id, record] as const),
  );
  for (const record of input.before.commanders?.commanders ?? []) {
    const proposal = record.proposal;
    if (proposal !== undefined && after.get(record.id)?.proposal === undefined) {
      facts.push({
        type: 'proposal.declined',
        priority: 'normal',
        payload: { player: record.owner, commander: record.id, kind: proposal.kind },
      });
    }
  }
  return facts;
}
