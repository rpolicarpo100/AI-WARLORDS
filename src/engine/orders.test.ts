/**
 * M043 — Commander orders data tests: orderable verb vocabulary (voted
 * engine-verbs), total kind/params/order guards, exported bounds.
 * Data-first: no transitions, no events, no readers until M044+.
 */
import { describe, expect, it } from 'vitest';
import {
  ACTIVATE_TRANSITION,
  COMMISSION_TRANSITION,
  DEACTIVATE_TRANSITION,
} from './commander-state.js';
import { BUILD_TRANSITION, GATHER_TRANSITION, UPGRADE_TRANSITION } from './economy.js';
import {
  isCommanderOrder,
  isOrderKind,
  isOrderParams,
  isOrderQueue,
  MAX_ORDER_PARAM_CHARS,
  MAX_ORDER_PARAM_KEY_CHARS,
  MAX_ORDER_PARAMS,
  MAX_ORDERS_PER_COMMANDER,
  ORDER_IDS,
  type OrderKind,
} from './orders.js';
import { ATTACK_TRANSITION, MOVE_TRANSITION, TRAIN_TRANSITION } from './warfare.js';

describe('ORDER_IDS (orderable vocabulary)', () => {
  it('locks the five orderables, alphabetical', () => {
    expect([...ORDER_IDS]).toEqual([
      'city.build',
      'economy.gather',
      'unit.attack',
      'unit.move',
      'unit.train',
    ]);
  });

  it('every id names a real dispatched transition (voted engine-verbs)', () => {
    expect([...ORDER_IDS].sort()).toEqual(
      [
        BUILD_TRANSITION,
        GATHER_TRANSITION,
        ATTACK_TRANSITION,
        MOVE_TRANSITION,
        TRAIN_TRANSITION,
      ].sort(),
    );
  });
});

describe('isOrderKind (total)', () => {
  it.each([...ORDER_IDS])('accepts orderable %s', (kind) => {
    expect(isOrderKind(kind)).toBe(true);
  });

  it('rejects cut verbs, lookalikes, and non-strings', () => {
    const bad = [
      COMMISSION_TRANSITION,
      ACTIVATE_TRANSITION,
      DEACTIVATE_TRANSITION,
      UPGRADE_TRANSITION,
      'world.noop',
      '',
      'UNIT.MOVE',
      'unit.move ',
      ' unit.move',
      'unit.dance',
      7,
      null,
      undefined,
      [],
      {},
      true,
    ];
    for (const value of bad) {
      expect(isOrderKind(value)).toBe(false);
    }
  });
});

describe('isOrderParams (flat scalar record)', () => {
  it('accepts the five grounded wire-shapes', () => {
    expect(isOrderParams({ type: 'house' })).toBe(true);
    expect(isOrderParams({ col: 3, row: 4 })).toBe(true);
    expect(isOrderParams({ id: 'u1', target: 'u9' })).toBe(true);
    expect(isOrderParams({ id: 'u1', col: 3, row: 4 })).toBe(true);
    expect(isOrderParams({ type: 'archer', col: 0, row: 0 })).toBe(true);
  });

  it('accepts empty params (presence is not content)', () => {
    expect(isOrderParams({})).toBe(true);
  });

  it('rejects non-objects', () => {
    for (const bad of [null, undefined, [], 'x', 7, true]) {
      expect(isOrderParams(bad)).toBe(false);
    }
  });

  it('bounds key count at eight (boundary pinned)', () => {
    const eight: Record<string, number> = {};
    for (let i = 0; i < 8; i += 1) {
      eight[`k${i}`] = i;
    }
    expect(isOrderParams(eight)).toBe(true);
    expect(isOrderParams({ ...eight, ninth: 9 })).toBe(false);
  });

  it('bounds keys: non-empty, at most 32 chars (boundary pinned)', () => {
    expect(isOrderParams({ '': 1 })).toBe(false);
    expect(isOrderParams({ ['k'.repeat(32)]: 1 })).toBe(true);
    expect(isOrderParams({ ['k'.repeat(33)]: 1 })).toBe(false);
  });

  it('bounds string values at 64 chars (boundary pinned)', () => {
    expect(isOrderParams({ id: '' })).toBe(true);
    expect(isOrderParams({ id: 'u'.repeat(64) })).toBe(true);
    expect(isOrderParams({ id: 'u'.repeat(65) })).toBe(false);
  });

  it('rejects non-finite numbers and nested values', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(isOrderParams({ n: bad })).toBe(false);
    }
    for (const bad of [{}, [], null, undefined]) {
      expect(isOrderParams({ nested: bad })).toBe(false);
    }
  });

  it('accepts booleans and finite numbers (kind-agnostic envelope)', () => {
    expect(isOrderParams({ flag: true, off: false })).toBe(true);
    expect(isOrderParams({ zero: 0, neg: -5, float: 1.5, big: 4294967295 })).toBe(true);
  });
});

describe('isCommanderOrder (total)', () => {
  it('accepts minimal, full, and future-proofed shapes', () => {
    const kinds: readonly OrderKind[] = ORDER_IDS;
    for (const kind of kinds) {
      expect(isCommanderOrder({ kind })).toBe(true);
      expect(isCommanderOrder({ kind, params: { id: 'u1', col: 1, row: 2 } })).toBe(true);
      expect(isCommanderOrder({ kind, params: {}, future: 'ignored' })).toBe(true);
    }
  });

  it('rejects missing, unknown, and mistyped kinds', () => {
    for (const bad of [
      {},
      { kind: undefined },
      { kind: 'city.upgrade' },
      { kind: 7 },
      { kind: null },
    ]) {
      expect(isCommanderOrder(bad)).toBe(false);
    }
  });

  it('rejects malformed params', () => {
    for (const params of [[], 5, 'x', { nested: {} }, { n: Number.NaN }]) {
      expect(isCommanderOrder({ kind: 'unit.move', params })).toBe(false);
    }
  });

  it('rejects non-objects', () => {
    for (const bad of [null, undefined, [], 'unit.move', 7, true]) {
      expect(isCommanderOrder(bad)).toBe(false);
    }
  });
});

describe('isOrderQueue (total, M044)', () => {
  it('accepts empty and populated queues in FIFO order', () => {
    expect(isOrderQueue([])).toBe(true);
    expect(
      isOrderQueue([
        { kind: 'unit.move', params: { id: 'u1', col: 1, row: 2 } },
        { kind: 'city.build' },
      ]),
    ).toBe(true);
  });

  it('rejects non-arrays', () => {
    for (const bad of [null, undefined, {}, 'x', 7, { kind: 'unit.move' }]) {
      expect(isOrderQueue(bad)).toBe(false);
    }
  });

  it('bounds length at eight (boundary pinned)', () => {
    const move = { kind: 'unit.move' };
    const full = [move, move, move, move, move, move, move, move];
    expect(isOrderQueue(full)).toBe(true);
    expect(isOrderQueue([...full, move])).toBe(false);
  });

  it('rejects queues with invalid elements', () => {
    expect(isOrderQueue([{ kind: 'unit.move' }, { kind: 'city.upgrade' }])).toBe(false);
    expect(isOrderQueue([{ kind: 'unit.move', params: { nested: {} } }])).toBe(false);
    expect(isOrderQueue([7])).toBe(false);
  });
});

describe('order bounds (locked)', () => {
  it('exports the validated ceilings', () => {
    expect(MAX_ORDER_PARAMS).toBe(8);
    expect(MAX_ORDER_PARAM_KEY_CHARS).toBe(32);
    expect(MAX_ORDER_PARAM_CHARS).toBe(64);
    expect(MAX_ORDERS_PER_COMMANDER).toBe(8);
  });
});
