/**
 * M053 — Memory recall queries (LAYER L2).
 *
 * Read path over the M051 log (D-047, voted attribute-recall +
 * sides-caller): recallMemories validates one commander's memories
 * against the stream (injected lookup, M045 mold — the stream is
 * truth, the log is pointers). A memory is FRESH when its seq
 * resolves and revision + kind agree; anything else (missing seq,
 * revision drift, kind mismatch — the forgery signature) is STALE.
 * The split is the fail-closed seam: consumers take `.fresh`
 * blindly; `.stale` stays visible for audit (recall never hides a
 * forgery, it flags it). Optional subject filter answers "what
 * happened about X". LAYER L2 (imports commanders/memories L0
 * type-only, all downward).
 */

import type { CommanderMemory, CommanderRecord } from './commanders.js';

/** Stream truth at one seq: the stamped revision + kind, when present. */
export interface StreamEntry {
  readonly revision: number;
  readonly kind: string;
}

/** Injected stream read (Match binds it over its event stream). */
export type StreamLookup = (seq: number) => StreamEntry | undefined;

/** Validated recollection: safe memories plus flagged ones. */
export interface Recollection {
  readonly fresh: readonly CommanderMemory[];
  readonly stale: readonly CommanderMemory[];
}

/**
 * "What does this commander remember" (fail-soft: missing record
 * yields undefined — queries never throw). Subject narrows to one
 * entity; absent subject recalls the whole log.
 */
export function recallMemories(
  record: CommanderRecord | undefined,
  lookup: StreamLookup,
  subject?: string,
): Recollection | undefined {
  if (record === undefined) {
    return undefined;
  }
  const fresh: CommanderMemory[] = [];
  const stale: CommanderMemory[] = [];
  for (const memory of record.memories ?? []) {
    if (subject !== undefined && memory.subject !== subject) {
      continue;
    }
    const entry = lookup(memory.seq);
    if (entry !== undefined && entry.revision === memory.revision && entry.kind === memory.kind) {
      fresh.push(memory);
    } else {
      stale.push(memory);
    }
  }
  return { fresh, stale };
}
