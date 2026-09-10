import { describe, expect, it } from 'vitest';
import type { PlayerId } from './authority.js';
import { createWorldState } from './world-state.js';
import { toAiPerception, toClientView, toWorldView } from './views.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;
const P3 = 'p3' as PlayerId;

function makeState() {
  return createWorldState({
    players: [P1, P2, P3],
    tick: 4,
    secrets: { p1: ['p1-plan-alpha'], p2: ['p2-plan-omega'] },
  });
}

describe('toWorldView (server-only)', () => {
  it('returns the canonical reference unchanged (identity)', () => {
    const state = makeState();
    expect(toWorldView(state)).toBe(state);
  });
});

describe('toClientView (redaction)', () => {
  it('shows own secrets and nobody elses (p1)', () => {
    const view = toClientView(makeState(), P1);

    expect(view).toEqual({
      kind: 'client-view',
      forPlayer: 'p1',
      state: {
        schemaVersion: 1,
        tick: 4,
        players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
        secrets: { p1: ['p1-plan-alpha'] },
      },
    });
  });

  it('shows own secrets and nobody elses (p2, mirror)', () => {
    const view = toClientView(makeState(), P2);
    expect(view.state.secrets).toEqual({ p2: ['p2-plan-omega'] });
  });

  it('yields empty secrets for players without any (p3)', () => {
    const view = toClientView(makeState(), P3);
    expect(view.state.secrets).toEqual({});
  });

  it('deep-freezes the whole view: wrapper, state, secrets and lists', () => {
    const view = toClientView(makeState(), P1);

    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.state)).toBe(true);
    expect(Object.isFrozen(view.state.secrets)).toBe(true);
    const list = view.state.secrets['p1'];
    if (list === undefined) {
      throw new Error('test setup: expected p1 secrets');
    }
    expect(Object.isFrozen(list)).toBe(true);
    expect(() => {
      (view as { kind: string }).kind = 'server';
    }).toThrow(TypeError);
    expect(() => {
      (list as string[]).push('x');
    }).toThrow(TypeError);
  });

  it('never mutates or aliases the source state', () => {
    const state = makeState();
    const before = JSON.parse(JSON.stringify(state)) as unknown;

    toClientView(state, P1);

    expect(state).toEqual(before);
    expect(Object.isFrozen(state)).toBe(false);
  });

  it('leaks nothing: serialized view contains own secrets only (no-leak scan)', () => {
    const serialized = JSON.stringify(toClientView(makeState(), P1));
    expect(serialized).toContain('p1-plan-alpha');
    expect(serialized).not.toContain('p2-plan-omega');
  });
});

describe('toAiPerception (M004: known == player-visible)', () => {
  it('wraps the redacted world as known, distinctly kinded', () => {
    const view = toAiPerception(makeState(), P1);

    expect(view.kind).toBe('ai-perception');
    expect(view.forPlayer).toBe('p1');
    expect(view.known).toEqual({
      schemaVersion: 1,
      tick: 4,
      players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
      secrets: { p1: ['p1-plan-alpha'] },
    });
    expect(Object.isFrozen(view)).toBe(true);
  });

  it('leaks nothing: serialized perception contains own secrets only', () => {
    const serialized = JSON.stringify(toAiPerception(makeState(), P2));
    expect(serialized).toContain('p2-plan-omega');
    expect(serialized).not.toContain('p1-plan-alpha');
  });

  it('is nominally distinct from the client view (kind separation)', () => {
    const state = makeState();
    expect(toClientView(state, P1).kind).toBe('client-view');
    expect(toAiPerception(state, P1).kind).toBe('ai-perception');
  });
});
