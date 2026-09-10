/**
 * Deterministic RNG primitive (M005). Mulberry32 with unsigned state kept —
 * outputs identical to the reference algorithm. Deterministic-by-test (same
 * seed → same sequence, golden-locked); NOT certified against external
 * vectors — compatibility is not required, reproducibility is.
 *
 * Wiring into handler context is deferred to the first stochastic consumer
 * (a future domain module): until then the seed is provenance, and this
 * primitive is what gives it meaning. No `fork`: added when a second
 * independent stream exists (no speculative streams).
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
