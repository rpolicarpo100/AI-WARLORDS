/**
 * M014 — Explored guard tests: canonical form, rejection battery,
 * leaf-mirror cross-check (authority import is test-only).
 */
import { describe, expect, it } from 'vitest';
import { MAX_ID_LENGTH } from './authority.js';
import {
  EXPLORED_SCHEMA_VERSION,
  isCellIndex,
  isExploredData,
  MAX_VIEWER_ID_CHARS,
} from './explored.js';

describe('isCellIndex (unit)', () => {
  it.each([[0], [4095], [4294967295]] as Array<[unknown]>)('accepts %j', (value) => {
    expect(isCellIndex(value)).toBe(true);
  });

  it.each([[-1], [1.5], [4294967296], ['x'], [null]] as Array<[unknown]>)('rejects %j', (value) => {
    expect(isCellIndex(value)).toBe(false);
  });
});

describe('isExploredData (unit)', () => {
  it('accepts empty and populated canonical data', () => {
    expect(isExploredData({ schemaVersion: 1, viewers: {} })).toBe(true);
    expect(isExploredData({ schemaVersion: 1, viewers: { p1: [0, 4, 9], p2: [] } })).toBe(true);
  });

  it.each([[0], [2], ['1'], [null]] as Array<[unknown]>)('rejects version %j', (schemaVersion) => {
    expect(isExploredData({ schemaVersion, viewers: {} })).toBe(false);
  });

  it('rejects missing version', () => {
    expect(isExploredData({ viewers: {} })).toBe(false);
  });

  it.each([[null], [[]], ['x']] as Array<[unknown]>)('rejects viewers %j', (viewers) => {
    expect(isExploredData({ schemaVersion: 1, viewers })).toBe(false);
  });

  it.each([[''], ['x'.repeat(65)]] as Array<[unknown]>)('rejects viewer id %j', (viewer) => {
    expect(isExploredData({ schemaVersion: 1, viewers: { [viewer as string]: [] } })).toBe(false);
  });

  it.each([['x'], [7], [null], [{}]] as Array<[unknown]>)('rejects non-array set %j', (indices) => {
    expect(isExploredData({ schemaVersion: 1, viewers: { p1: indices } })).toBe(false);
  });

  it.each([[[0, -1]], [[1.5]], [[4294967296]], [[0, 'x']]] as Array<[unknown]>)(
    'rejects bad index %j',
    (indices) => {
      expect(isExploredData({ schemaVersion: 1, viewers: { p1: indices } })).toBe(false);
    },
  );

  it.each([[[1, 0]], [[2, 2]], [[0, 3, 2]]] as Array<[unknown]>)(
    'rejects non-canonical order %j',
    (indices) => {
      expect(isExploredData({ schemaVersion: 1, viewers: { p1: indices } })).toBe(false);
    },
  );

  it.each([[null], [[]], [7], ['x']] as Array<[unknown]>)('rejects non-object %j', (value) => {
    expect(isExploredData(value)).toBe(false);
  });

  it('uses schema version 1', () => {
    expect(EXPLORED_SCHEMA_VERSION).toBe(1);
  });
});

describe('leaf mirror cross-check (unit)', () => {
  it('viewer cap mirrors authority MAX_ID_LENGTH (divergence fails loud)', () => {
    expect(MAX_VIEWER_ID_CHARS).toBe(MAX_ID_LENGTH);
  });
});
