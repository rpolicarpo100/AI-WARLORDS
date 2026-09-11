/**
 * PROMPTS — Prompt-budget data tests: guard, fail-closed reads, seeding,
 * pure spend, leaf-mirror cross-checks (test-only imports).
 */
import { describe, expect, it } from 'vitest';
import { MAX_ID_LENGTH } from './authority.js';
import {
  isPromptsData,
  MAX_HOLDER_ID_CHARS,
  PROMPTS_SCHEMA_VERSION,
  promptsOf,
  seedPrompts,
  spendPrompt,
  type PromptsData,
} from './prompts.js';
import { MAX_HOLDER_ID_CHARS as STOCKPILE_HOLDER_CAP } from './stockpiles.js';

describe('isPromptsData (unit)', () => {
  it('accepts populated and empty budgets', () => {
    expect(isPromptsData({ schemaVersion: 1, remaining: { p1: 10, p2: 0 } })).toBe(true);
    expect(isPromptsData({ schemaVersion: 1, remaining: {} })).toBe(true);
  });

  it.each([[null], [[]], ['x']] as Array<[unknown]>)('rejects non-object %j', (value) => {
    expect(isPromptsData(value)).toBe(false);
  });

  it.each([[0], [2], ['1']] as Array<[unknown]>)('rejects schemaVersion %j', (value) => {
    expect(isPromptsData({ schemaVersion: value, remaining: {} })).toBe(false);
  });

  it.each([[42], [null], [[]]] as Array<[unknown]>)('rejects non-object remaining %j', (value) => {
    expect(isPromptsData({ schemaVersion: 1, remaining: value })).toBe(false);
  });

  it.each([[['', 10]], [['x'.repeat(65), 10]]] as Array<[[unknown, unknown]]>)(
    'rejects bad holder %j',
    ([holder, count]) => {
      expect(isPromptsData({ schemaVersion: 1, remaining: { [holder as string]: count } })).toBe(
        false,
      );
    },
  );

  it.each([[-1], [1.5], [0x100000000], ['10']] as Array<[unknown]>)(
    'rejects non-uint count %j',
    (value) => {
      expect(isPromptsData({ schemaVersion: 1, remaining: { p1: value } })).toBe(false);
    },
  );
});

describe('promptsOf (unit)', () => {
  it('reads the count, fail-closed 0 when unknown or absent', () => {
    const data: PromptsData = { schemaVersion: 1, remaining: { p1: 7 } };
    expect(promptsOf(data, 'p1')).toBe(7);
    expect(promptsOf(data, 'zx')).toBe(0);
    expect(promptsOf(undefined, 'p1')).toBe(0);
  });
});

describe('seedPrompts (unit)', () => {
  it('seeds every holder with the budget', () => {
    expect(seedPrompts(['p1', 'p2'], 10)).toEqual({
      schemaVersion: 1,
      remaining: { p1: 10, p2: 10 },
    });
  });

  it.each([[42], [[]], [['p1', '']], [[42]]] as Array<[unknown]>)(
    'throws on invalid holders %j',
    (holders) => {
      expect(() => seedPrompts(holders as never, 10)).toThrow(/invalid holders/);
    },
  );

  it.each([[0], [-1], [1.5], [0x100000000], ['10']] as Array<[unknown]>)(
    'throws on invalid budget %j',
    (perPlayer) => {
      expect(() => seedPrompts(['p1'], perPlayer as never)).toThrow(/invalid budget/);
    },
  );
});

describe('spendPrompt (unit)', () => {
  it('decrements one holder, others intact, input untouched', () => {
    const data: PromptsData = { schemaVersion: 1, remaining: { p1: 10, p2: 3 } };
    const spent = spendPrompt(data, 'p1');
    expect(spent).toEqual({ schemaVersion: 1, remaining: { p1: 9, p2: 3 } });
    expect(spent).not.toBe(data);
    expect(data).toEqual({ schemaVersion: 1, remaining: { p1: 10, p2: 3 } });
  });

  it('throws loud when the slot is absent', () => {
    expect(() => spendPrompt(undefined, 'p1')).toThrow(/no prompts data/);
  });

  it('throws loud at zero or unknown (wrapper pre-checks)', () => {
    expect(() => spendPrompt({ schemaVersion: 1, remaining: { p1: 0 } }, 'p1')).toThrow(
      /no prompts left/,
    );
    expect(() => spendPrompt({ schemaVersion: 1, remaining: {} }, 'p1')).toThrow(/no prompts left/);
  });
});

describe('leaf mirrors (unit)', () => {
  it('holder bound matches stockpiles + authority (all 64)', () => {
    expect(MAX_HOLDER_ID_CHARS).toBe(64);
    expect(MAX_HOLDER_ID_CHARS).toBe(STOCKPILE_HOLDER_CAP);
    expect(MAX_HOLDER_ID_CHARS).toBe(MAX_ID_LENGTH);
  });

  it('schema version is 1', () => {
    expect(PROMPTS_SCHEMA_VERSION).toBe(1);
  });
});
