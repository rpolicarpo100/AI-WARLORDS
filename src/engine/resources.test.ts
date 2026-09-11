/**
 * M012 — Resources tests: vocabulary, node guard/coherence, loader paths,
 * queries, node integrity (map-preserved), view blindness inheritance.
 */
import { describe, expect, it } from 'vitest';
import type { PlayerId } from './authority.js';
import { isMapData, isResourceType, loadMapData, RESOURCE_TYPES, type MapData } from './map.js';
import { Match, STANDARD_RULESET } from './match.js';
import { resourceAt, resourceNodes, totalResource } from './resources.js';
import { createWorldValidator, wrapWithValidation } from './validation.js';
import { toAiPerception, toClientView } from './views.js';
import { createWorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

interface RDocOpts {
  readonly root?: Record<string, unknown>;
  readonly terrainData?: unknown[];
  readonly tiles?: unknown[];
  readonly tilecount?: number;
}

function rTile(id: number, terrain: unknown, extra: Record<string, unknown> = {}): unknown {
  const props: unknown[] = [{ name: 'terrain', type: 'string', value: terrain }];
  for (const [name, value] of Object.entries(extra)) {
    props.push({ name, type: typeof value === 'number' ? 'int' : 'string', value });
  }
  return { id, properties: props };
}

/** M012-owned 2x2 fixture builder (test scaffolding locality over dedup). */
function rmakeDoc(opts: RDocOpts = {}): unknown {
  return {
    type: 'map',
    orientation: 'hexagonal',
    staggeraxis: 'y',
    staggerindex: 'odd',
    width: 2,
    height: 2,
    infinite: false,
    layers: [
      {
        type: 'tilelayer',
        name: 'terrain',
        width: 2,
        height: 2,
        x: 0,
        y: 0,
        data: opts.terrainData ?? [1, 2, 3, 1],
      },
    ],
    tilesets: [
      {
        firstgid: 1,
        tilecount: opts.tilecount ?? 3,
        columns: 3,
        name: 'res',
        tiles: opts.tiles ?? [
          rTile(0, 'field'),
          rTile(1, 'forest'),
          rTile(2, 'resource', { resourceType: 'gold', resourceAmount: 500 }),
        ],
      },
    ],
    ...opts.root,
  };
}

function nodeMap(): MapData {
  return loadMapData(rmakeDoc(), 'gold-map');
}

describe('resource vocabulary (unit)', () => {
  it.each([
    ['food', true],
    ['wood', true],
    ['stone', true],
    ['gold', true],
    ['lava', false],
    ['', false],
    [42, false],
    [undefined, false],
  ] as Array<[unknown, boolean]>)('isResourceType(%j) === %j', (value, expected) => {
    expect(isResourceType(value)).toBe(expected);
  });

  it('locks the 4-element #14 vocabulary', () => {
    expect([...RESOURCE_TYPES]).toEqual(['food', 'wood', 'stone', 'gold']);
  });
});

describe('node guard + coherence (unit)', () => {
  it('accepts a map with a valid node', () => {
    expect(isMapData(nodeMap())).toBe(true);
  });

  it.each([
    ['detail on field', 'field', { type: 'gold', amount: 10 }],
    ['Detail null on resource', 'resource', null],
    ['Detail array on resource', 'resource', []],
    ['Detail primitive on resource', 'resource', 42],
    ['Bad node type', 'resource', { type: 'lava', amount: 10 }],
    ['Float amount', 'resource', { type: 'gold', amount: 1.5 }],
    ['Negative amount', 'resource', { type: 'gold', amount: -1 }],
    ['Overflow amount', 'resource', { type: 'gold', amount: 0x100000000 }],
    ['Text amount', 'resource', { type: 'gold', amount: 'lots' }],
  ] as Array<[string, string, unknown]>)('rejects %s', (_label, terrain, detail) => {
    const base = nodeMap() as unknown as Record<string, unknown>;
    const cells = (base['cells'] as Array<Record<string, unknown>>).map((cell, i) =>
      i === 0 ? { ...cell, terrain, resource: detail } : cell,
    );
    expect(isMapData({ ...base, cells })).toBe(false);
  });

  it('rejects resource terrain without detail', () => {
    const base = nodeMap() as unknown as Record<string, unknown>;
    const cells = (base['cells'] as Array<Record<string, unknown>>).map((cell, i) =>
      i === 2 ? { col: 0, row: 1, terrain: 'resource' } : cell,
    );
    expect(isMapData({ ...base, cells })).toBe(false);
  });

  it('accepts zero amount (depleted is valid)', () => {
    const base = nodeMap() as unknown as Record<string, unknown>;
    const cells = (base['cells'] as Array<Record<string, unknown>>).map((cell, i) =>
      i === 2 ? { ...cell, resource: { type: 'gold', amount: 0 } } : cell,
    );
    expect(isMapData({ ...base, cells })).toBe(true);
  });
});

describe('resource loader paths (integration)', () => {
  it('loads nodes exactly (structural golden)', () => {
    const loaded = nodeMap();
    expect(isMapData(loaded)).toBe(true);
    expect(loaded.cells).toEqual([
      { col: 0, row: 0, terrain: 'field' },
      { col: 1, row: 0, terrain: 'forest' },
      { col: 0, row: 1, terrain: 'resource', resource: { type: 'gold', amount: 500 } },
      { col: 1, row: 1, terrain: 'field' },
    ]);
  });

  it('omits resource keys when absent (M010 bytes intact)', () => {
    for (const cell of nodeMap().cells) {
      if (cell.terrain !== 'resource') {
        expect('resource' in cell).toBe(false);
      }
    }
  });

  it.each([
    [
      'props on field rejected',
      [
        rTile(0, 'field', { resourceType: 'gold' }),
        rTile(1, 'forest'),
        rTile(2, 'resource', { resourceType: 'gold', resourceAmount: 5 }),
      ],
    ],
    [
      'amount-only props on field rejected',
      [
        rTile(0, 'field', { resourceAmount: 5 }),
        rTile(1, 'forest'),
        rTile(2, 'resource', { resourceType: 'gold', resourceAmount: 5 }),
      ],
    ],
    [
      'missing type rejected',
      [rTile(0, 'field'), rTile(1, 'forest'), rTile(2, 'resource', { resourceAmount: 5 })],
    ],
    [
      'missing amount rejected',
      [rTile(0, 'field'), rTile(1, 'forest'), rTile(2, 'resource', { resourceType: 'gold' })],
    ],
    [
      'bad node type rejected',
      [
        rTile(0, 'field'),
        rTile(1, 'forest'),
        rTile(2, 'resource', { resourceType: 'lava', resourceAmount: 5 }),
      ],
    ],
    [
      'float amount rejected',
      [
        rTile(0, 'field'),
        rTile(1, 'forest'),
        rTile(2, 'resource', { resourceType: 'gold', resourceAmount: 1.5 }),
      ],
    ],
    [
      'negative amount rejected',
      [
        rTile(0, 'field'),
        rTile(1, 'forest'),
        rTile(2, 'resource', { resourceType: 'gold', resourceAmount: -1 }),
      ],
    ],
    [
      'overflow amount rejected',
      [
        rTile(0, 'field'),
        rTile(1, 'forest'),
        rTile(2, 'resource', { resourceType: 'gold', resourceAmount: 0x100000000 }),
      ],
    ],
  ] as Array<[string, unknown[]]>)('%s', (_label, tiles) => {
    expect(() => loadMapData(rmakeDoc({ tiles }), 'm1')).toThrow(/loadMapData/);
  });
});

describe('resource queries (unit)', () => {
  it('resourceAt hits, misses and bounds-checks', () => {
    const map = nodeMap();
    expect(resourceAt(map, 0, 1)).toEqual({ type: 'gold', amount: 500 });
    expect(resourceAt(map, 0, 0)).toBeUndefined();
    expect(resourceAt(map, 9, 9)).toBeUndefined();
  });

  it('resourceNodes lists nodes in cell order', () => {
    expect(resourceNodes(nodeMap())).toEqual([
      { col: 0, row: 1, terrain: 'resource', resource: { type: 'gold', amount: 500 } },
    ]);
  });

  it('totalResource sums per type (0 for absent)', () => {
    const map = nodeMap();
    expect(totalResource(map, 'gold')).toBe(500);
    expect(totalResource(map, 'wood')).toBe(0);
  });

  it('totalResource sums an unknown type to 0 (aggregation, not lookup)', () => {
    expect(totalResource(nodeMap(), 'lava' as never)).toBe(0);
  });
});

describe('node integrity + blindness (security)', () => {
  it('node forgery (increase) still faults map-preserved', () => {
    const state = createWorldState({ players: [P1], map: nodeMap() });
    const map = state.map;
    if (map === undefined) {
      throw new Error('test setup: expected a map');
    }
    const cells = map.cells.map((cell, i) =>
      i === 2 ? { ...cell, resource: { type: 'gold' as const, amount: 501 } } : cell,
    );
    const wrapped = wrapWithValidation(
      () => ({ applied: true, state: { ...state, map: { ...map, cells } }, summary: 'mut' }),
      createWorldValidator(),
      7,
      () => 1,
    );
    expect(() => wrapped({ state, caller: P1, params: {} })).toThrow(/map-preserved/);
  });

  it('pure depletion passes map-preserved (M017 writer)', () => {
    const state = createWorldState({ players: [P1], map: nodeMap() });
    const map = state.map;
    if (map === undefined) {
      throw new Error('test setup: expected a map');
    }
    const cells = map.cells.map((cell, i) =>
      i === 2 ? { ...cell, resource: { type: 'gold' as const, amount: 499 } } : cell,
    );
    const wrapped = wrapWithValidation(
      () => ({ applied: true, state: { ...state, map: { ...map, cells } }, summary: 'mut' }),
      createWorldValidator(),
      7,
      () => 1,
    );
    const result = wrapped({ state, caller: P1, params: {} });
    if (result.applied !== true) {
      throw new Error('test setup: depletion declined');
    }
    expect(resourceAt(result.state.map ?? nodeMap(), 0, 1)).toEqual({
      type: 'gold',
      amount: 499,
    });
  });

  it('AI perception exposes no node details on a node-bearing map', () => {
    const state = createWorldState({ players: [P1, P2], map: nodeMap() });
    const known = toAiPerception(state, P1, { p1: [0] }).known;
    expect(Object.keys(known.map ?? {}).sort()).toEqual(['explored', 'height', 'visible', 'width']);
    expect(JSON.stringify(known)).not.toContain('amount');
    expect(JSON.stringify(known)).not.toContain('resource');
  });

  it('CLIENT view exposes no node details on a node-bearing map', () => {
    const state = createWorldState({ players: [P1, P2], map: nodeMap() });
    const view = toClientView(state, P1, { p1: [0] }).state;
    expect(Object.keys(view.map ?? {}).sort()).toEqual(['explored', 'height', 'visible', 'width']);
    expect(JSON.stringify(view)).not.toContain('amount');
    expect(JSON.stringify(view)).not.toContain('resource');
  });

  it('started summary still carries only map identity', () => {
    const match = new Match({
      seed: 5,
      ruleset: STANDARD_RULESET,
      players: [P1, P2],
      initialState: createWorldState({ players: [P1, P2], map: nodeMap() }),
    });
    expect(match.getEvents()[0]?.payload).toEqual({
      seed: 5,
      players: [P1, P2],
      ruleset: STANDARD_RULESET,
      map: { id: 'gold-map', version: 1 },
    });
  });
});
