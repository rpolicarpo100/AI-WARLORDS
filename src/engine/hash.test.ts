import { describe, expect, it } from 'vitest';
import { hashState, stableStringify } from './hash.js';

describe('stableStringify', () => {
  it('serializes primitives', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify('x')).toBe('"x"');
    expect(stableStringify(true)).toBe('true');
  });

  it('is key-order independent for objects, order-sensitive for arrays', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
    expect(stableStringify({ n: { z: 1, a: [3] } })).toBe('{"n":{"a":[3],"z":1}}');
  });

  it('handles empty containers', () => {
    expect(stableStringify({})).toBe('{}');
    expect(stableStringify([])).toBe('[]');
  });

  it.each([[() => 0], [undefined], [Symbol('s')], [1n]] as Array<[unknown]>)(
    'throws for unserializable value (#%#)',
    (value) => {
      expect(() => stableStringify(value)).toThrow(/unserializable/);
    },
  );
});

describe('hashState', () => {
  it('is deterministic and 64-hex shaped', () => {
    const first = hashState({ a: 1, b: [2, 3] });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(hashState({ b: [2, 3], a: 1 })).toBe(first);
  });

  it('locks the algorithm end-to-end (generated-then-locked golden)', () => {
    expect(hashState({ a: 1, b: [2, 3] })).toBe(
      'efbd0040190fb0871831e606c581f8a66db79d8e2bb836745a70051306956070',
    );
  });

  it('differs across different inputs', () => {
    expect(hashState({ a: 1 })).not.toBe(hashState({ a: 2 }));
  });
});
