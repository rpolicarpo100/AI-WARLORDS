/**
 * Deterministic RNG primitive (M005). Mulberry32 with unsigned state kept —
 * outputs identical to the reference algorithm. Deterministic-by-test (same
 * seed → same sequence, golden-locked); NOT certified against external
 * vectors — compatibility is not required, reproducibility is.
 *
 * M006 wires streams into dispatch: `deriveSeed(seed, seq)` yields each
 * dispatch's independent stream, injected into every handler context by the
 * validation wrapper. No domain handler consumes randomness yet. No `fork`:
 * added when a second independent stream exists (no speculative streams).
 */
export const MAX_UINT32 = 0xffffffff;

export class SeededRng {
  private state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed > MAX_UINT32) {
      throw new Error('SeededRng: seed must be a uint32.');
    }
    this.state = seed;
  }

  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  nextInt(bound: number): number {
    if (!Number.isInteger(bound) || bound < 1) {
      throw new Error('SeededRng.nextInt: bound must be a positive integer.');
    }
    return Math.floor((this.nextUint32() / 4294967296) * bound);
  }

  nextFloat(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Current state as a seed: `new SeededRng(rng.getState())` continues identically. */
  getState(): number {
    return this.state;
  }
}

/**
 * Derives an independent per-dispatch stream seed from (match seed,
 * wrapper-invocation ordinal — pre-rejections consume ordinals without
 * logging, so this is NOT the kernel log seq). Deterministic mixing (NOT
 * cryptographic: streams need
 * separation, not secrecy — anti-cheat secrecy is a future module's job).
 * Any dispatch's randomness is reconstructible from (seed, seq) alone.
 */
export function deriveSeed(seed: number, seq: number): number {
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_UINT32) {
    throw new Error('deriveSeed: seed must be a uint32.');
  }
  if (!Number.isInteger(seq) || seq < 1 || seq > MAX_UINT32) {
    throw new Error('deriveSeed: seq must be a positive uint32.');
  }
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ seq, 0xc2b2ae35);
  h ^= h >>> 13;
  return h >>> 0;
}
