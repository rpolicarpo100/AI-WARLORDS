/**
 * M051 — Commander memory records data (LEAF L0, zero imports).
 *
 * AI Memory foundation (data-first, M046 mold): a memory references
 * one emitted stream event (M040 mold) the commander lived through.
 * The reference is self-validating: `seq` locates the event in the
 * stream while `revision` + `kind` confirm it — a mismatch means the
 * stream moved under the memory (stale), and recall (M052+) must
 * fail closed on stale. Kinds stay a closed vocabulary: every code
 * names a REAL emitted event type (grounded against producers),
 * AI-relevant (own command experience + battle + sightings).
 * Memories ride a bounded per-commander log (absent means empty,
 * symmetric with the M044 order queue). Zero transitions, zero
 * readers until M052+.
 */

export const MEMORABLE_KINDS = [
  'order.canceled',
  'order.executed',
  'order.overridden',
  'unit.attacked',
  'unit.slain',
  'unit.spotted',
] as const;

/** Closed memorable vocabulary (MEMORABLE_KINDS canonical). */
export type MemorableKind = (typeof MEMORABLE_KINDS)[number];

/**
 * M053 — ambient subset: battle and sighting facts name no commander
 * (attribution is caller-bound fan-out, memory-record.ts). Order
 * kinds always name their commander (payload.commander).
 */
export const AMBIENT_KINDS = ['unit.attacked', 'unit.slain', 'unit.spotted'] as const;

/** Closed ambient vocabulary (AMBIENT_KINDS canonical). */
export type AmbientKind = (typeof AMBIENT_KINDS)[number];

/** A remembered stream event: where, when, what, about whom. */
export interface CommanderMemory {
  readonly seq: number;
  readonly revision: number;
  readonly kind: MemorableKind;
  readonly subject: string;
}

/** Per-commander log ceiling (symmetric with the order queue bound). */
export const MAX_MEMORIES_PER_COMMANDER = 8;

/** Subject-id ceiling (symmetric with the commander-id bound). */
export const MAX_MEMORY_SUBJECT_CHARS = 64;

/** Stream-position ceiling (uint32; seqs never approach it). */
const MAX_WORD = 0xffffffff;

export function isMemorableKind(value: unknown): value is MemorableKind {
  return typeof value === 'string' && (MEMORABLE_KINDS as readonly string[]).includes(value);
}

/** M053: true for the ambient (commander-less) memorable kinds. */
export function isAmbientKind(value: unknown): value is AmbientKind {
  return typeof value === 'string' && (AMBIENT_KINDS as readonly string[]).includes(value);
}

function isStreamWord(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_WORD;
}

function isSubjectId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_MEMORY_SUBJECT_CHARS;
}

/** Total memory check: seq/revision/kind/subject valid, extras ignored (M015). */
export function isCommanderMemory(value: unknown): value is CommanderMemory {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  return (
    isStreamWord(fields['seq']) &&
    isStreamWord(fields['revision']) &&
    isMemorableKind(fields['kind']) &&
    isSubjectId(fields['subject'])
  );
}

/** Capped log of valid memories (absent means empty at the record; M044 mold). */
export function isMemoryLog(value: unknown): value is CommanderMemory[] {
  if (!Array.isArray(value)) {
    return false;
  }
  if (value.length > MAX_MEMORIES_PER_COMMANDER) {
    return false;
  }
  for (const entry of value) {
    if (!isCommanderMemory(entry)) {
      return false;
    }
  }
  return true;
}
