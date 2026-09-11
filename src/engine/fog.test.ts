/**
 * M013 — Fog of War tests: source/config guards, flood computation
 * (goldens), queries, viewer isolation. Map fixtures are built locally
 * and self-validated (test scaffolding, no dedup with production).
 */
import { describe, expect, it } from 'vitest';
import type { PlayerId } from './authority.js';
import {
  computeVisibility,
  DEFAULT_FOG_CONFIG,
  isFogConfig,
  isVisibleCell,
  isVisionSource,
  sourcesOf,
  visibleCells,
  VISION_RANGE,
  type FogConfig,
  type VisionSource,
} from './fog.js';
import { isMapData, type MapData, type MapId, type TerrainId } from './map.js';
import type { UnitsData } from './units.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

function makeMap(rows: readonly (readonly TerrainId[])[]): MapData {
  const first = rows[0];
  if (first === undefined) {
    throw new Error('test setup: empty map');
  }
  const map: MapData = {
    schemaVersion: 1,
    id: 't' as MapId,
    width: first.length,
    height: rows.length,
    stagger: 'odd',
    cells: rows.flatMap((cols, row) => cols.map((terrain, col) => ({ col, row, terrain }))),
    spawns: [],
  };
  if (!isMapData(map)) {
    throw new Error('test setup: invalid map');
  }
  return map;
}

function openMap(size: number): MapData {
  const row = Array<TerrainId>(size).fill('field');
  return makeMap(Array<readonly TerrainId[]>(size).fill(row));
}

function source(viewer: PlayerId, col: number, row: number, range: number): VisionSource {
  return { viewer, col, row, range };
}

function validConfig(): Record<string, { blocksVision: boolean }> {
  return {
    field: { blocksVision: false },
    forest: { blocksVision: true },
    mountain: { blocksVision: true },
    river: { blocksVision: false },
    road: { blocksVision: false },
    bridge: { blocksVision: false },
    resource: { blocksVision: false },
    village: { blocksVision: false },
    city: { blocksVision: false },
  };
}

describe('vision source guard (unit)', () => {
  it('accepts minimal and maximal valid sources', () => {
    expect(isVisionSource(source(P1, 0, 0, 0))).toBe(true);
    expect(isVisionSource(source(P1, 999, 999, 4294967295))).toBe(true);
  });

  it.each([[''], ['x'.repeat(65)], [[123]], [[null]], [[undefined]]] as Array<[unknown]>)(
    'rejects bad viewer: %j',
    (viewer) => {
      expect(isVisionSource({ viewer, col: 0, row: 0, range: 1 })).toBe(false);
    },
  );

  it.each([[-1], [1.5], ['x']] as Array<[unknown]>)('rejects bad col: %j', (col) => {
    expect(isVisionSource({ viewer: P1, col, row: 0, range: 1 })).toBe(false);
  });

  it.each([[-1], [0.5]] as Array<[unknown]>)('rejects bad row: %j', (row) => {
    expect(isVisionSource({ viewer: P1, col: 0, row, range: 1 })).toBe(false);
  });

  it.each([[-1], [1.5], [4294967296], ['x']] as Array<[unknown]>)(
    'rejects bad range: %j',
    (range) => {
      expect(isVisionSource({ viewer: P1, col: 0, row: 0, range })).toBe(false);
    },
  );

  it.each([[null], [[]], [[7]], ['x']] as Array<[unknown]>)(
    'rejects non-object source: %j',
    (value) => {
      expect(isVisionSource(value)).toBe(false);
    },
  );
});

describe('fog config guard + default (unit)', () => {
  it('accepts DEFAULT and the exact 9/9 literal', () => {
    expect(isFogConfig(DEFAULT_FOG_CONFIG)).toBe(true);
    expect(DEFAULT_FOG_CONFIG).toEqual(validConfig());
  });

  it('freezes DEFAULT top + nested', () => {
    expect(Object.isFrozen(DEFAULT_FOG_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_FOG_CONFIG.forest)).toBe(true);
    expect(() => {
      (DEFAULT_FOG_CONFIG as { forest: { blocksVision: boolean } }).forest.blocksVision = false;
    }).toThrow(TypeError);
  });

  it.each([
    ['8 entries', (c: Record<string, unknown>): void => void delete c['city']],
    [
      '10 entries',
      (c: Record<string, unknown>): void => void (c['lava'] = { blocksVision: false }),
    ],
    [
      'bad key',
      (c: Record<string, unknown>): void => {
        c['lava'] = c['field'];
        delete c['field'];
      },
    ],
    ['non-boolean rule', (c: Record<string, unknown>): void => void (c['field'] = 'yes')],
    ['null rule', (c: Record<string, unknown>): void => void (c['field'] = null)],
    ['array rule', (c: Record<string, unknown>): void => void (c['field'] = [])],
  ] as Array<[string, (c: Record<string, unknown>) => void]>)(
    'rejects malformed table: %s',
    (_name, mutate) => {
      const config = validConfig() as unknown as Record<string, unknown>;
      mutate(config);
      expect(isFogConfig(config)).toBe(false);
    },
  );

  it.each([[null], [[]], ['x']] as Array<[unknown]>)('rejects non-object config: %j', (value) => {
    expect(isFogConfig(value)).toBe(false);
  });
});

describe('computeVisibility (integration)', () => {
  it('rejects invalid config loud', () => {
    expect(() => computeVisibility(openMap(3), [], {} as FogConfig)).toThrow(/invalid fog config/);
  });

  it('rejects non-array sources and malformed sources loud', () => {
    const map = openMap(3);
    expect(() => computeVisibility(map, 'x' as unknown as readonly VisionSource[])).toThrow(
      /invalid sources/,
    );
    expect(() => computeVisibility(map, [{ viewer: P1, col: 0, row: 0, range: -1 }])).toThrow(
      /invalid vision source/,
    );
  });

  it('empty sources yield frozen {}', () => {
    const result = computeVisibility(openMap(3), []);
    expect(result).toEqual({});
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('range 0 sees only the origin', () => {
    const result = computeVisibility(openMap(3), [source(P1, 1, 1, 0)]);
    expect(result).toEqual({ p1: [4] });
  });

  it('range 1 on open ground sees 7 (golden: 1+6, odd-r)', () => {
    const result = computeVisibility(openMap(3), [source(P1, 1, 1, 1)]);
    expect(result['p1']).toHaveLength(7);
    expect(result).toEqual({ p1: [1, 2, 3, 4, 5, 7, 8] });
  });

  it('range 2 on open ground sees 19 (golden count 1+6+12)', () => {
    const result = computeVisibility(openMap(5), [source(P1, 2, 2, 2)]);
    const cells = result['p1'] ?? [];
    expect(cells).toHaveLength(19);
    expect(cells).toContain(12);
    expect(cells).not.toContain(0);
    expect(computeVisibility(openMap(5), [source(P1, 2, 2, 2)])).toEqual(result);
  });

  it('wall: blocked cells visible, nothing beyond (golden, default config)', () => {
    const wall = makeMap([
      ['field', 'forest', 'field'],
      ['field', 'forest', 'field'],
      ['field', 'forest', 'field'],
    ]);
    const expected = { p1: [0, 1, 3, 4, 6, 7] };
    expect(computeVisibility(wall, [source(P1, 0, 1, 5)])).toEqual(expected);
    expect(computeVisibility(wall, [source(P1, 0, 1, 5)], DEFAULT_FOG_CONFIG)).toEqual(expected);
  });

  it('custom all-pass config sees through the wall (config is effective)', () => {
    const wall = makeMap([
      ['field', 'forest', 'field'],
      ['field', 'mountain', 'field'],
      ['field', 'forest', 'field'],
    ]);
    const open: FogConfig = {
      field: { blocksVision: false },
      forest: { blocksVision: false },
      mountain: { blocksVision: false },
      river: { blocksVision: false },
      road: { blocksVision: false },
      bridge: { blocksVision: false },
      resource: { blocksVision: false },
      village: { blocksVision: false },
      city: { blocksVision: false },
    };
    expect(isFogConfig(open)).toBe(true);
    expect(computeVisibility(wall, [source(P1, 0, 1, 5)], open)).toEqual({
      p1: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    });
  });

  it('origin on blocking terrain still expands (observer sees out)', () => {
    const map = makeMap([
      ['field', 'field', 'field'],
      ['field', 'forest', 'field'],
      ['field', 'field', 'field'],
    ]);
    const result = computeVisibility(map, [source(P1, 1, 1, 1)]);
    expect(result).toEqual({ p1: [1, 2, 3, 4, 5, 7, 8] });
  });

  it('multi-source union for one viewer (golden)', () => {
    const result = computeVisibility(openMap(3), [source(P1, 0, 0, 1), source(P1, 2, 2, 1)]);
    expect(result).toEqual({ p1: [0, 1, 3, 4, 5, 7, 8] });
  });

  it('OOB sources skipped soft; OOB-only viewer gets []', () => {
    expect(computeVisibility(openMap(3), [source(P1, 99, 99, 5)])).toEqual({ p1: [] });
    expect(computeVisibility(openMap(3), [source(P1, 99, 99, 5), source(P1, 0, 0, 0)])).toEqual({
      p1: [0],
    });
  });
});

describe('queries (unit)', () => {
  const result = { p1: [0, 4] as const };

  it('visibleCells returns the set, or [] for unknown viewers', () => {
    expect(visibleCells(result, P1)).toEqual([0, 4]);
    expect(visibleCells(result, P2)).toEqual([]);
  });

  it('isVisibleCell answers membership, fail-soft false', () => {
    expect(isVisibleCell(result, P1, 4)).toBe(true);
    expect(isVisibleCell(result, P1, 3)).toBe(false);
    expect(isVisibleCell(result, P1, 999)).toBe(false);
    expect(isVisibleCell(result, P2, 0)).toBe(false);
  });
});

describe('viewer isolation + output integrity (security)', () => {
  it('viewers never contaminate each other', () => {
    const map = openMap(5);
    const p1 = [source(P1, 0, 0, 2)];
    const p2 = [source(P2, 4, 4, 2)];
    const together = computeVisibility(map, [...p1, ...p2]);
    expect(together['p1']).toEqual(computeVisibility(map, p1)['p1']);
    expect(together['p2']).toEqual(computeVisibility(map, p2)['p2']);
  });

  it('viewer keys ascending regardless of source order', () => {
    const a = 'a' as PlayerId;
    const b = 'b' as PlayerId;
    const result = computeVisibility(openMap(3), [source(b, 2, 2, 0), source(a, 0, 0, 0)]);
    expect(Object.keys(result)).toEqual(['a', 'b']);
  });

  it('result frozen top + nested; mutation throws', () => {
    const result = computeVisibility(openMap(3), [source(P1, 1, 1, 1)]);
    expect(Object.isFrozen(result)).toBe(true);
    const cells = result['p1'];
    expect(cells).toBeDefined();
    expect(Object.isFrozen(cells)).toBe(true);
    expect(() => {
      (result as Record<string, number[]>)[P1]?.push(0);
    }).toThrow(TypeError);
  });
});

describe('sourcesOf (M030)', () => {
  function crewed(units: UnitsData['units']): UnitsData {
    return { schemaVersion: 1, nextId: units.length, units };
  }

  it('absent units see nothing', () => {
    expect(sourcesOf(undefined)).toEqual([]);
  });

  it('golden: living units become range-2 sources for their owners, roster order kept', () => {
    const units = crewed([
      { id: 'u0', owner: 'p1', type: 'worker', hp: 10, col: 1, row: 2 },
      { id: 'u1', owner: 'p2', type: 'warrior', hp: 5, col: 0, row: 0 },
    ]);
    expect(sourcesOf(units)).toEqual([
      { viewer: 'p1', col: 1, row: 2, range: 2 },
      { viewer: 'p2', col: 0, row: 0, range: 2 },
    ]);
  });

  it('skips the dead (0hp sees nothing)', () => {
    const units = crewed([
      { id: 'u0', owner: 'p1', type: 'worker', hp: 0, col: 1, row: 1 },
      { id: 'u1', owner: 'p1', type: 'worker', hp: 1, col: 2, row: 2 },
    ]);
    expect(sourcesOf(units)).toEqual([{ viewer: 'p1', col: 2, row: 2, range: 2 }]);
  });

  it('skips malformed owners (fail-soft, never a fault)', () => {
    const units = crewed([
      { id: 'u0', owner: '', type: 'worker', hp: 10, col: 1, row: 1 },
      { id: 'u1', owner: 'p2', type: 'worker', hp: 10, col: 1, row: 1 },
    ]);
    expect(sourcesOf(units)).toEqual([{ viewer: 'p2', col: 1, row: 1, range: 2 }]);
  });

  it('VISION_RANGE is stable (wire contract)', () => {
    expect(VISION_RANGE).toBe(2);
  });
});
