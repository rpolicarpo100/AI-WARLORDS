/**
 * M079 — Elo tests: hand-computed vectors, triple-checked
 * (hand arithmetic + python oracle + node rounding).
 */
import { describe, expect, it } from 'vitest';
import { eloPair, scoreOf } from './ratings.js';

describe('scoreOf (outcome as Elo score)', () => {
  it('splits draws and crowns winners only', () => {
    expect(scoreOf({ kind: 'draw' }, 'p1')).toBe(0.5);
    expect(scoreOf({ kind: 'win', winner: 'p1' }, 'p1')).toBe(1);
    expect(scoreOf({ kind: 'win', winner: 'p1' }, 'p2')).toBe(0);
  });
});

describe('eloPair (standard exchange)', () => {
  it('holds equal draws still', () => {
    expect(eloPair(1200, 1200, 0.5, 32)).toEqual({ a: 1200, b: 1200 });
  });

  it('pays the favourite little for the expected win', () => {
    expect(eloPair(1600, 1200, 1, 32)).toEqual({ a: 1603, b: 1197 });
  });

  it('pays the underdog much for the upset', () => {
    expect(eloPair(1200, 1600, 1, 32)).toEqual({ a: 1229, b: 1571 });
  });

  it('compounds repeat wins with shrinking gains', () => {
    expect(eloPair(1216, 1184, 1, 32)).toEqual({ a: 1231, b: 1169 });
  });
});
