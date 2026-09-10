import { createHash } from 'node:crypto';

/**
 * Key-order-independent serialization for hashing. Objects sort keys
 * recursively; arrays KEEP order (positional data is order-significant).
 * Strict: functions, symbols, bigints and undefined throw loudly instead
 * of being silently dropped or coerced — hashed state must be exact.
 */
const UNSERIALIZABLE = 'stableStringify: unserializable value.';

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
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
  if (Array.isArray(value)) {
    const items = value.map((item) => stableStringify(item));
    return `[${items.join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${parts.join(',')}}`;
}

/** Deterministic SHA-256 (hex) over the stable serialization. */
export function hashState(state: unknown): string {
  return createHash('sha256').update(stableStringify(state), 'utf8').digest('hex');
}
