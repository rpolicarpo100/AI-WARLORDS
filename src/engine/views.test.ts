/**
 * M015 — Perception tests: membership enforcement, knowledge assembly
 * (sight + memory), builder envelopes, F-09 key tripwire, no-leak scan.
 */
import { describe, expect, it } from 'vitest';
import type { PlayerId } from './authority.js';
import { computeVisibility } from './fog.js';
import type { MapData, MapId, TerrainId } from './map.js';
import { createWorldState, type WorldState } from './world-state.js';
import { perceive, toAiPerception, toClientView, toWorldView } from './views.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

function makeMap(rows: readonly (readonly TerrainId[])[]): MapData {
  const first = rows[0];
  if (first === undefined) {
    throw new Error('test setup: empty map');
  }
  return {
    schemaVersion: 1,
    id: 't' as MapId,
    width: first.length,
    height: rows.length,
    stagger: 'odd',
    cells: rows.flatMap((cols, row) => cols.map((terrain, col) => ({ col, row, terrain }))),
    spawns: [],
  };
}

function mixedMap(): MapData {
  return makeMap([
    ['field', 'field', 'field'],
    ['field', 'forest', 'field'],
    ['field', 'field', 'mountain'],
  ]);
}

function makeState(): WorldState {
  return createWorldState({
    players: [P1, P2],
    tick: 4,
    map: mixedMap(),
    explored: { schemaVersion: 1, viewers: { p1: [0, 4], p2: [8] } },
  });
}

describe('toWorldView (server-only)', () => {
  it('returns the canonical reference unchanged (identity)', () => {
    const state = makeState();
    expect(toWorldView(state)).toBe(state);
  });
});

describe('perceive (unit: membership + validation)', () => {
  it('rejects unknown viewers loud (L-27 closes here, at consumption)', () => {
    expect(() => perceive(makeState(), 'zx' as PlayerId)).toThrow(/unknown viewer/);
  });

  it('rejects malformed visibility loud (structural)', () => {
    const state = makeState();
    expect(() => perceive(state, P1, 'x' as never)).toThrow(/invalid visibility/);
    expect(() => perceive(state, P1, null as never)).toThrow(/invalid visibility/);
    expect(() => perceive(state, P1, [] as never)).toThrow(/invalid visibility/);
    expect(() => perceive(state, P1, { p1: 'x' } as never)).toThrow(/invalid visibility/);
    expect(() => perceive(state, P1, { p1: [-1] })).toThrow(/invalid visibility/);
  });

  it('OOB visibility skipped soft (stale positions, D-006 context level)', () => {
    expect(perceive(makeState(), P1, { p1: [4, 99] }).visibleCells).toEqual([4]);
  });
});

describe('perceive (integration: knowledge assembly)', () => {
  it('assembles sight + memory + sparse terrain (golden)', () => {
    expect(perceive(makeState(), P1, { p1: [4, 8] })).toEqual({
      tick: 4,
      players: [{ id: 'p1' }, { id: 'p2' }],
      viewer: 'p1',
      visibleCells: [4, 8],
      exploredCells: [0, 4],
      stockpile: { food: 0, wood: 0, stone: 0, gold: 0 },
      buildings: { 'town-center': 0, house: 0, storage: 0, barracks: 0, wall: 0, tower: 0 },
      city: { level: 1, queue: [] },
      units: [],
      commanders: [],
      map: { width: 3, height: 3, visible: { 4: 'forest', 8: 'mountain' }, explored: [0] },
    });
  });

  it('viewer absent from visibility sees nothing but remembers', () => {
    const known = perceive(makeState(), P1, { p2: [8] });
    expect(known.visibleCells).toEqual([]);
    expect(known.exploredCells).toEqual([0, 4]);
    expect(known.map?.visible).toEqual({});
    expect(known.map?.explored).toEqual([0, 4]);
  });

  it('default visibility = memory only', () => {
    const known = perceive(makeState(), P2);
    expect(known.visibleCells).toEqual([]);
    expect(known.exploredCells).toEqual([8]);
    expect(known.map?.explored).toEqual([8]);
  });

  it('map without explored: sight without memory', () => {
    const state = createWorldState({ players: [P1, P2], map: mixedMap() });
    const known = perceive(state, P1, { p1: [0] });
    expect(known.visibleCells).toEqual([0]);
    expect(known.exploredCells).toEqual([]);
    expect(known.map?.visible).toEqual({ 0: 'field' });
    expect(known.map?.explored).toEqual([]);
  });

  it('viewer with no memory entry sees sight-only (others remember)', () => {
    const state = createWorldState({
      players: [P1, P2],
      map: mixedMap(),
      explored: { schemaVersion: 1, viewers: { p1: [0] } },
    });
    const known = perceive(state, P2, { p2: [1] });
    expect(known.visibleCells).toEqual([1]);
    expect(known.exploredCells).toEqual([]);
    expect(known.map?.explored).toEqual([]);
  });

  it('mapless: roster + tick only, visibility ignored', () => {
    const state = createWorldState({ players: [P1, P2], tick: 4 });
    const known = perceive(state, P1, { p1: [0] });
    expect(known).toEqual({
      tick: 4,
      players: [{ id: 'p1' }, { id: 'p2' }],
      viewer: 'p1',
      visibleCells: [],
      exploredCells: [],
      stockpile: { food: 0, wood: 0, stone: 0, gold: 0 },
      buildings: { 'town-center': 0, house: 0, storage: 0, barracks: 0, wall: 0, tower: 0 },
      city: { level: 1, queue: [] },
      units: [],
      commanders: [],
    });
    expect('map' in known).toBe(false);
  });

  it('feeds computeVisibility output (no-L2-edge compatibility proof)', () => {
    const seen = computeVisibility(mixedMap(), [{ viewer: P1, col: 1, row: 1, range: 0 }]);
    const known = perceive(makeState(), P1, seen);
    expect(known.visibleCells).toEqual([4]);
    expect(known.map?.visible).toEqual({ 4: 'forest' });
  });

  it('frozen output, source untouched and unfrozen', () => {
    const state = makeState();
    const before = JSON.parse(JSON.stringify(state)) as unknown;
    const known = perceive(state, P1, { p1: [4] });
    const map = known.map;
    if (map === undefined) {
      throw new Error('test setup: expected map');
    }
    expect(Object.isFrozen(known)).toBe(true);
    expect(Object.isFrozen(known.players)).toBe(true);
    expect(Object.isFrozen(known.visibleCells)).toBe(true);
    expect(Object.isFrozen(known.exploredCells)).toBe(true);
    expect(Object.isFrozen(known.stockpile)).toBe(true);
    expect(Object.isFrozen(map)).toBe(true);
    expect(Object.isFrozen(map.visible)).toBe(true);
    expect(Object.isFrozen(map.explored)).toBe(true);
    expect(() => {
      (known.visibleCells as number[]).push(0);
    }).toThrow(TypeError);
    expect(state).toEqual(before);
    expect(Object.isFrozen(state)).toBe(false);
  });

  it('deterministic run×2', () => {
    const run = () => perceive(makeState(), P1, { p1: [8, 4] });
    expect(run()).toEqual(run());
  });
});

describe('builders (envelopes)', () => {
  it('client view wraps perceived state, distinctly kinded, frozen', () => {
    const view = toClientView(makeState(), P1, { p1: [4] });
    expect(view.kind).toBe('client-view');
    expect(view.forPlayer).toBe('p1');
    expect(view.state.viewer).toBe('p1');
    expect(view.state.visibleCells).toEqual([4]);
    expect(view.state.exploredCells).toEqual([0, 4]);
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.state)).toBe(true);
  });

  it('AI perception wraps knowledge as known', () => {
    const view = toAiPerception(makeState(), P1, { p1: [4] });
    expect(view.kind).toBe('ai-perception');
    expect(view.forPlayer).toBe('p1');
    expect(view.known.visibleCells).toEqual([4]);
    expect(view.known.exploredCells).toEqual([0, 4]);
    expect(Object.isFrozen(view)).toBe(true);
  });

  it('is nominally distinct from the client view (kind separation)', () => {
    const state = makeState();
    expect(toClientView(state, P1).kind).toBe('client-view');
    expect(toAiPerception(state, P1).kind).toBe('ai-perception');
  });
});

describe('F-09 key tripwire (updated M015: perception keys)', () => {
  it('locks the exact perceived keys (new knowledge fields update perceive)', () => {
    const state = makeState();
    expect(Object.keys(perceive(state, P1, { p1: [4] })).sort()).toEqual([
      'buildings',
      'city',
      'commanders',
      'exploredCells',
      'map',
      'players',
      'stockpile',
      'tick',
      'units',
      'viewer',
      'visibleCells',
    ]);
    const mapless = createWorldState({ players: [P1, P2] });
    expect(Object.keys(perceive(mapless, P1)).sort()).toEqual([
      'buildings',
      'city',
      'commanders',
      'exploredCells',
      'players',
      'stockpile',
      'tick',
      'units',
      'viewer',
      'visibleCells',
    ]);
  });

  it('locks the view envelope keys', () => {
    const state = makeState();
    expect(Object.keys(toClientView(state, P1)).sort()).toEqual(['forPlayer', 'kind', 'state']);
    expect(Object.keys(toAiPerception(state, P1)).sort()).toEqual(['forPlayer', 'kind', 'known']);
  });

  it('leaks nothing: hidden terrain and others memory stay out (no-leak scan)', () => {
    const serialized = JSON.stringify(toAiPerception(makeState(), P1, { p1: [4] }));
    expect(serialized).toContain('forest');
    expect(serialized).not.toContain('mountain');
    expect(toAiPerception(makeState(), P1, { p1: [4] }).known.map?.explored).toEqual([0]);
  });
});
