/**
 * M095 — Match mode data tests: guard matrix, vocabulary, default.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_MODE, isMatchMode, MATCH_MODES } from './mode.js';

describe('match mode (unit)', () => {
  it.each([
    ['standard', true],
    ['free', true],
    ['endless', false],
    ['sandbox', false],
    ['STANDARD', false],
    ['', false],
    [42, false],
    [null, false],
    [undefined, false],
    [{}, false],
  ] as Array<[unknown, boolean]>)('isMatchMode(%j) === %j', (value, expected) => {
    expect(isMatchMode(value)).toBe(expected);
  });

  it('locks the mode vocabulary + default', () => {
    expect([...MATCH_MODES]).toEqual(['standard', 'free']);
    expect(DEFAULT_MATCH_MODE).toBe('standard');
  });
});
