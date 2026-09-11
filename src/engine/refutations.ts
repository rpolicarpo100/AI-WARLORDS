/**
 * M046 — Refutation records data (LEAF L0, zero imports).
 *
 * AI Refutation foundation (data-first, M043 mold): a refutation
 * challenges one queued commander order (M043–M045 target) with an
 * auditable reason. The reference is self-validating: `orderIndex`
 * locates the order in the holder's queue while `kind` confirms it —
 * a kind/index mismatch means the queue moved under the challenge
 * (stale), and resolution (M047+) must fail closed on stale.
 * Reasons stay a closed vocabulary: every code names a condition
 * the engine can eventually check against live state (map
 * passability/adjacency, state equality, force comparison,
 * stockpile costs). Whether `by` may equal the holder (self) or
 * must be a peer is UNRESTRICTED at data level (M047 decides).
 * Zero transitions, zero events, zero readers until M047+.
 */

export const REFUTATION_REASONS = [
  'blocked',
  'out-of-range',
  'redundant',
  'suicidal',
  'unaffordable',
] as const;

/** Closed challenge vocabulary (REFUTATION_REASONS canonical). */
export type RefutationReason = (typeof REFUTATION_REASONS)[number];

/** Mirrors ORDER_IDS (orders.js). Leaf: deliberately not imported. */
const ORDERABLE_KINDS: readonly string[] = [
  'city.build',
  'economy.gather',
  'unit.attack',
  'unit.move',
  'unit.train',
];

/** M046 mirror of OrderKind (orders.ts canonical; L0↛L0: deliberately not imported). */
export type RefutationOrderKind =
  'city.build' | 'economy.gather' | 'unit.attack' | 'unit.move' | 'unit.train';

/** A challenge against one queued order: where, what, why, by whom. */
export interface CommanderRefutation {
  readonly orderIndex: number;
  readonly kind: RefutationOrderKind;
  readonly reason: RefutationReason;
  readonly by: string;
}

/** Challenger-id ceiling (symmetric with the commander-id bound). */
export const MAX_REFUTATION_BY_CHARS = 64;

/** Queue-index ceiling (uint32; queue positions never approach it). */
const MAX_WORD = 0xffffffff;

export function isRefutationReason(value: unknown): value is RefutationReason {
  return typeof value === 'string' && (REFUTATION_REASONS as readonly string[]).includes(value);
}

function isRefutationOrderKind(value: unknown): value is RefutationOrderKind {
  return typeof value === 'string' && ORDERABLE_KINDS.includes(value);
}

function isOrderIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_WORD;
}

function isChallengerId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_REFUTATION_BY_CHARS;
}

/** Total refutation check: index/kind/reason/by valid, extras ignored (M015). */
export function isCommanderRefutation(value: unknown): value is CommanderRefutation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  return (
    isOrderIndex(fields['orderIndex']) &&
    isRefutationOrderKind(fields['kind']) &&
    isRefutationReason(fields['reason']) &&
    isChallengerId(fields['by'])
  );
}
