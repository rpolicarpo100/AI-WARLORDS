import { createHash } from 'node:crypto';

/**
 * Key-order-independent serialization for hashing. Objects sort keys
 * recursively; arrays KEEP order (positional data is order-significant).
 * Strict: functions, symbols, bigints, undefined, non-finite numbers and
 * cycles throw loudly instead of being silently dropped or coerced —
 * hashed state must be exact.
 */
const UNSERIALIZABLE = 'stableStringify: unserializable value.';

export function stableStringify(value: unknown): string {
  return stableValue(value, new Set());
}

function stableValue(value: unknown, active: Set<object>): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(UNSERIALIZABLE);
    }
    let encoded: string | undefined;
    try {
      encoded = JSON.stringify(value);
    } catch {
      throw new Error(UNSERIALIZABLE);
    }
    if (encoded === undefined) {
      throw new Error(UNSERIALIZABLE);
    }
    return encoded;
  }
  const target = value as object;
  if (active.has(target)) {
    throw new Error(UNSERIALIZABLE);
  }
  active.add(target);
  let out: string;
  if (Array.isArray(value)) {
    const items = value.map((item) => stableValue(item, active));
    out = `[${items.join(',')}]`;
  } else {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts = keys.map((key) => `${JSON.stringify(key)}:${stableValue(record[key], active)}`);
    out = `{${parts.join(',')}}`;
  }
  active.delete(target);
  return out;
}

/** Deterministic SHA-256 (hex) over the stable serialization. */
export function hashState(state: unknown): string {
  return createHash('sha256').update(stableStringify(state), 'utf8').digest('hex');
}
