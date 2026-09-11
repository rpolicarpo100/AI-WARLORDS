/**
 * M010 — Map System tests: hex topology, MapData guard, Tiled loader,
 * WorldState extension, map-preserved rule, started summary, view blindness.
 */
import { describe, expect, it } from 'vitest';
import type { PlayerId } from './authority.js';
import {
  axialDistance,
  axialNeighbors,
  axialToOffset,
  cellAt,
  cellAtAxial,
  isMapData,
  isMapId,
  isTerrainId,
  loadMapData,
  neighborsOf,
  offsetToAxial,
  spawnFor,
  TERRAIN_IDS,
  type HexStagger,
  type MapData,
} from './map.js';
import { Match, STANDARD_RULESET } from './match.js';
import { createWorldValidator, wrapWithValidation } from './validation.js';
import { toAiPerception, toClientView, toWorldView } from './views.js';
import { createWorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

describe('isMapId (unit)', () => {
  it.each([
    ['m1', true],
    ['x'.repeat(64), true],
    ['', false],
    ['x'.repeat(65), false],
    [42, false],
    [undefined, false],
  ] as Array<[unknown, boolean]>)('isMapId(%j) === %j', (value, expected) => {
    expect(isMapId(value)).toBe(expected);
  });
});

describe('isTerrainId (unit)', () => {
  it.each([
    ['field', true],
    ['city', true],
    ['lava', false],
    ['', false],
    [42, false],
    [undefined, false],
  ] as Array<[unknown, boolean]>)('isTerrainId(%j) === %j', (value, expected) => {
    expect(isTerrainId(value)).toBe(expected);
  });

  it('locks the 9-element #13 vocabulary', () => {
    expect([...TERRAIN_IDS]).toEqual([
      'field',
      'forest',
      'mountain',
      'river',
      'road',
      'bridge',
      'resource',
      'village',
      'city',
    ]);
  });
});

describe('axial math (unit)', () => {
  it.each([
    [0, 0, 'odd', 0, 0],
    [1, 0, 'odd', 1, 0],
    [0, 1, 'odd', 0, 1],
    [1, 1, 'odd', 1, 1],
    [0, 1, 'even', -1, 1],
    [2, 3, 'even', 0, 3],
    [2, 3, 'odd', 1, 3],
  ] as Array<[number, number, HexStagger, number, number]>)(
    'offsetToAxial(%i,%i,%s) === (%i,%i)',
    (col, row, stagger, q, r) => {
      expect(offsetToAxial(col, row, stagger)).toEqual({ q, r });
    },
  );

  it('offset<->axial round-trips on 4x4 both staggers', () => {
    for (const stagger of ['odd', 'even'] as const) {
      for (let row = 0; row < 4; row += 1) {
        for (let col = 0; col < 4; col += 1) {
          const { q, r } = offsetToAxial(col, row, stagger);
          expect(axialToOffset(q, r, stagger)).toEqual({ col, row });
        }
      }
    }
  });

  it.each([
    [0, 0, 0, 0, 0],
    [0, 0, 1, 0, 1],
    [0, 0, 2, -1, 2],
    [1, 1, -1, 2, 2],
  ] as Array<[number, number, number, number, number]>)(
    'axialDistance((%i,%i),(%i,%i)) === %i',
    (q1, r1, q2, r2, expected) => {
      expect(axialDistance({ q: q1, r: r1 }, { q: q2, r: r2 })).toBe(expected);
    },
  );

  it('axialNeighbors yields the 6 cube-adjacent coords', () => {
    const found = axialNeighbors({ q: 5, r: -2 });
    expect(found).toHaveLength(6);
    for (const coord of found) {
      expect(axialDistance({ q: 5, r: -2 }, coord)).toBe(1);
    }
  });
});

// ─── Tiled doc fixtures ────────────────────────────────────────────────

interface DocOpts {
  readonly root?: Record<string, unknown>;
  readonly width?: number;
  readonly height?: number;
  readonly layers?: unknown[];
  readonly terrainData?: unknown[];
  readonly spawnData?: unknown[] | null;
  readonly tilesets?: unknown[];
  readonly tiles?: unknown;
  readonly tilecount?: number;
}

function terrainTile(id: number, terrain: unknown): unknown {
  return { id, properties: [{ name: 'terrain', type: 'string', value: terrain }] };
}

function spawnTile(id: number, playerIndex: unknown): unknown {
  return { id, properties: [{ name: 'playerIndex', type: 'int', value: playerIndex }] };
}

/** Fresh valid 2x2 odd-stagger doc; options override slices of it. */
function makeDoc(opts: DocOpts = {}): unknown {
  const width = opts.width ?? 2;
  const height = opts.height ?? 2;
  const terrainData = opts.terrainData ?? [1, 2, 2, 1];
  const spawnData = opts.spawnData === undefined ? [0, 0, 3, 4] : opts.spawnData;
  const layers = opts.layers ?? [
    { type: 'tilelayer', name: 'terrain', width, height, x: 0, y: 0, data: terrainData },
    ...(spawnData === null
      ? []
      : [{ type: 'tilelayer', name: 'spawns', width, height, x: 0, y: 0, data: spawnData }]),
  ];
  return {
    type: 'map',
    orientation: 'hexagonal',
    staggeraxis: 'y',
    staggerindex: 'odd',
    width,
    height,
    infinite: false,
    layers,
    tilesets: opts.tilesets ?? [
      {
        firstgid: 1,
        tilecount: opts.tilecount ?? 4,
        columns: 4,
        name: 'test',
        tiles: opts.tiles ?? [
          terrainTile(0, 'field'),
          terrainTile(1, 'forest'),
          spawnTile(2, 0),
          spawnTile(3, 1),
        ],
      },
    ],
    ...opts.root,
  };
}

function validMap(): MapData {
  return loadMapData(makeDoc(), 'test-map');
}

describe('isMapData (unit)', () => {
  it('accepts a hand-built minimal map', () => {
    expect(
      isMapData({
        schemaVersion: 1,
        id: 'm1',
        width: 1,
        height: 1,
        stagger: 'odd',
        cells: [{ col: 0, row: 0, terrain: 'field' }],
        spawns: [],
      }),
    ).toBe(true);
  });

  it.each([
    ['not an object', 42],
    ['null', null],
    ['array', []],
    ['bad version', { schemaVersion: 2 }],
    ['bad id', { id: '' }],
    ['zero width', { width: 0 }],
    ['wide width', { width: 65 }],
    ['float height', { height: 1.5 }],
    ['string height', { height: '2' }],
    ['bad stagger', { stagger: 'middle' }],
    ['cells not array', { cells: {} }],
    ['cells short', { cells: [{ col: 0, row: 0, terrain: 'field' }] }],
    ['cell not object', { cells: [null, null, null, null] }],
    [
      'cell col drift',
      {
        cells: [
          { col: 7, row: 0, terrain: 'field' },
          { col: 1, row: 0, terrain: 'forest' },
          { col: 0, row: 1, terrain: 'forest' },
          { col: 1, row: 1, terrain: 'field' },
        ],
      },
    ],
    [
      'cell row drift',
      {
        cells: [
          { col: 0, row: 7, terrain: 'field' },
          { col: 1, row: 0, terrain: 'forest' },
          { col: 0, row: 1, terrain: 'forest' },
          { col: 1, row: 1, terrain: 'field' },
        ],
      },
    ],
    [
      'bad terrain',
      {
        cells: [
          { col: 0, row: 0, terrain: 'field' },
          { col: 1, row: 0, terrain: 'forest' },
          { col: 0, row: 1, terrain: 'lava' },
          { col: 1, row: 1, terrain: 'field' },
        ],
      },
    ],
    ['spawns not array', { spawns: {} }],
    ['spawn not object', { spawns: [null] }],
    ['spawn bad player', { spawns: [{ playerIndex: -1, col: 0, row: 0 }] }],
    ['spawn player overflow', { spawns: [{ playerIndex: 0x100000000, col: 0, row: 0 }] }],
    ['spawn col text', { spawns: [{ playerIndex: 0, col: 'x', row: 0 }] }],
    ['spawn col float', { spawns: [{ playerIndex: 0, col: 0.5, row: 0 }] }],
    ['spawn col negative', { spawns: [{ playerIndex: 0, col: -1, row: 0 }] }],
    ['spawn col past edge', { spawns: [{ playerIndex: 0, col: 2, row: 0 }] }],
    ['spawn row text', { spawns: [{ playerIndex: 0, col: 0, row: 'y' }] }],
    ['spawn row float', { spawns: [{ playerIndex: 0, col: 0, row: 1.5 }] }],
    ['spawn row negative', { spawns: [{ playerIndex: 0, col: 0, row: -1 }] }],
    ['spawn row past edge', { spawns: [{ playerIndex: 0, col: 0, row: 2 }] }],
    [
      'spawn player twice',
      {
        spawns: [
          { playerIndex: 0, col: 0, row: 0 },
          { playerIndex: 0, col: 1, row: 1 },
        ],
      },
    ],
    [
      'spawn cell twice',
      {
        spawns: [
          { playerIndex: 0, col: 1, row: 1 },
          { playerIndex: 1, col: 1, row: 1 },
        ],
      },
    ],
  ] as Array<[string, unknown]>)('rejects %s', (_label, patch) => {
    const base = validMap() as unknown as Record<string, unknown>;
    if (typeof patch === 'object' && patch !== null && !Array.isArray(patch)) {
      expect(isMapData({ ...base, ...patch })).toBe(false);
    } else {
      expect(isMapData(patch)).toBe(false);
    }
  });

  it('rejects 17 spawns (max 16)', () => {
    const spawns = Array.from({ length: 17 }, (_, i) => ({ playerIndex: i, col: 0, row: 0 }));
    const base = validMap() as unknown as Record<string, unknown>;
    expect(isMapData({ ...base, spawns })).toBe(false);
  });
});

describe('cell lookup + neighbors (unit)', () => {
  it.each([
    [0, 0, true],
    [1, 1, true],
    [2, 0, false],
    [0, -1, false],
    [0.5, 0, false],
  ] as Array<[number, number, boolean]>)('cellAt(col=%j,row=%j) hit === %j', (col, row, hit) => {
    const found = cellAt(validMap(), col, row);
    expect(found !== undefined).toBe(hit);
    if (hit) {
      expect([found?.col, found?.row]).toEqual([col, row]);
    }
  });

  it('cellAtAxial resolves through the stagger', () => {
    const map = validMap();
    expect(cellAtAxial(map, 0, 1)).toEqual({ col: 0, row: 1, terrain: 'forest' });
    expect(cellAtAxial(map, 9, 9)).toBeUndefined();
  });

  it('neighborsOf center yields 6 in-bounds cells', () => {
    const map = loadMapData(
      makeDoc({ width: 3, height: 3, terrainData: Array(9).fill(1), spawnData: null }),
      'm3',
    );
    const found = neighborsOf(map, 1, 1).map((cell) => `${cell.col},${cell.row}`);
    expect(found.sort()).toEqual(['0,1', '1,0', '1,2', '2,0', '2,1', '2,2']);
  });

  it('neighborsOf corner yields 2 cells', () => {
    const map = loadMapData(
      makeDoc({ width: 3, height: 3, terrainData: Array(9).fill(1), spawnData: null }),
      'm3',
    );
    const found = neighborsOf(map, 0, 0).map((cell) => `${cell.col},${cell.row}`);
    expect(found.sort()).toEqual(['0,1', '1,0']);
  });

  it('neighborsOf out-of-bounds yields nothing', () => {
    expect(neighborsOf(validMap(), 5, 5)).toEqual([]);
  });

  it('spawnFor finds by playerIndex', () => {
    expect(spawnFor(validMap(), 1)).toEqual({ playerIndex: 1, col: 1, row: 1 });
    expect(spawnFor(validMap(), 7)).toBeUndefined();
  });
});

describe('loadMapData (integration)', () => {
  it('loads the full 2x2 doc exactly', () => {
    const loaded = validMap();
    expect(isMapData(loaded)).toBe(true);
    expect(loaded).toEqual({
      schemaVersion: 1,
      id: 'test-map',
      width: 2,
      height: 2,
      stagger: 'odd',
      cells: [
        { col: 0, row: 0, terrain: 'field' },
        { col: 1, row: 0, terrain: 'forest' },
        { col: 0, row: 1, terrain: 'forest' },
        { col: 1, row: 1, terrain: 'field' },
      ],
      spawns: [
        { playerIndex: 0, col: 0, row: 1 },
        { playerIndex: 1, col: 1, row: 1 },
      ],
    });
  });

  it('loads without a spawns layer (empty spawns)', () => {
    const map = loadMapData(makeDoc({ spawnData: null }), 'm1');
    expect(map.spawns).toEqual([]);
    expect(map.cells).toHaveLength(4);
  });

  it('records even stagger (axial differs from odd)', () => {
    const map = loadMapData(makeDoc({ root: { staggerindex: 'even' }, spawnData: null }), 'm1');
    expect(map.stagger).toBe('even');
    expect(cellAtAxial(map, -1, 1)).toEqual({ col: 0, row: 1, terrain: 'forest' });
  });

  it('honors firstgid arithmetically', () => {
    const tilesets = [
      {
        firstgid: 10,
        tilecount: 1,
        columns: 1,
        name: 'shifted',
        tiles: [terrainTile(0, 'river')],
      },
    ];
    const map = loadMapData(
      makeDoc({ tilesets, terrainData: [10, 10, 10, 10], spawnData: null }),
      'm1',
    );
    expect(map.cells.map((cell) => cell.terrain)).toEqual(['river', 'river', 'river', 'river']);
  });

  it('masks presentational flip bits (0x80000001 reads as gid 1)', () => {
    const map = loadMapData(makeDoc({ terrainData: [0x80000001, 2, 2, 1], spawnData: null }), 'm1');
    expect(map.cells[0]).toEqual({ col: 0, row: 0, terrain: 'field' });
  });

  it.each([
    ['bad id', makeDoc(), ''],
    ['doc not object', 42, 'm1'],
    ['doc array', [], 'm1'],
    ['wrong type', makeDoc({ root: { type: 'tileset' } }), 'm1'],
    ['orthogonal rejected', makeDoc({ root: { orientation: 'orthogonal' } }), 'm1'],
    ['stagger x rejected', makeDoc({ root: { staggeraxis: 'x' } }), 'm1'],
    ['stagger middle rejected', makeDoc({ root: { staggerindex: 'middle' } }), 'm1'],
    ['infinite rejected', makeDoc({ root: { infinite: true } }), 'm1'],
    ['zero width', makeDoc({ root: { width: 0 } }), 'm1'],
    ['wide height', makeDoc({ root: { height: 65 } }), 'm1'],
    ['layers not array', makeDoc({ root: { layers: {} } }), 'm1'],
    ['layer not object', makeDoc({ layers: [null] }), 'm1'],
    ['object layer rejected', makeDoc({ layers: [{ type: 'objectgroup', name: 'things' }] }), 'm1'],
    ['unknown layer rejected', makeDoc({ layers: [{ type: 'tilelayer', name: 'sketch' }] }), 'm1'],
    [
      'offset layer rejected',
      makeDoc({
        layers: [
          {
            type: 'tilelayer',
            name: 'terrain',
            width: 2,
            height: 2,
            x: 1,
            y: 0,
            data: [1, 1, 1, 1],
          },
        ],
      }),
      'm1',
    ],
    [
      'dim-drift layer rejected',
      makeDoc({
        layers: [
          {
            type: 'tilelayer',
            name: 'terrain',
            width: 3,
            height: 2,
            x: 0,
            y: 0,
            data: [1, 1, 1, 1],
          },
        ],
      }),
      'm1',
    ],
    [
      'chunked layer rejected',
      makeDoc({
        layers: [
          {
            type: 'tilelayer',
            name: 'terrain',
            width: 2,
            height: 2,
            data: [1, 1, 1, 1],
            chunks: [],
          },
        ],
      }),
      'm1',
    ],
    [
      'base64 layer rejected',
      makeDoc({
        layers: [{ type: 'tilelayer', name: 'terrain', width: 2, height: 2, data: 'AQID' }],
      }),
      'm1',
    ],
    [
      'short data rejected',
      makeDoc({
        layers: [{ type: 'tilelayer', name: 'terrain', width: 2, height: 2, data: [1, 1] }],
      }),
      'm1',
    ],
    ['missing terrain rejected', makeDoc({ layers: [] }), 'm1'],
    [
      'duplicate terrain rejected',
      makeDoc({
        layers: [
          { type: 'tilelayer', name: 'terrain', width: 2, height: 2, data: [1, 1, 1, 1] },
          { type: 'tilelayer', name: 'terrain', width: 2, height: 2, data: [1, 1, 1, 1] },
        ],
      }),
      'm1',
    ],
    [
      'duplicate spawns rejected',
      makeDoc({
        layers: [
          { type: 'tilelayer', name: 'terrain', width: 2, height: 2, data: [1, 1, 1, 1] },
          { type: 'tilelayer', name: 'spawns', width: 2, height: 2, data: [0, 0, 0, 0] },
          { type: 'tilelayer', name: 'spawns', width: 2, height: 2, data: [0, 0, 0, 0] },
        ],
      }),
      'm1',
    ],
    ['tilesets not array', makeDoc({ root: { tilesets: {} } }), 'm1'],
    ['zero tilesets rejected', makeDoc({ tilesets: [] }), 'm1'],
    ['tileset not object', makeDoc({ tilesets: [null] }), 'm1'],
    ['external tileset rejected', makeDoc({ tilesets: [{ source: 'a.tsj', firstgid: 1 }] }), 'm1'],
    ['firstgid zero rejected', makeDoc({ tilesets: [{ firstgid: 0, tilecount: 1 }] }), 'm1'],
    ['tilecount zero rejected', makeDoc({ tilesets: [{ firstgid: 1, tilecount: 0 }] }), 'm1'],
    ['tiles not array', makeDoc({ tiles: {} }), 'm1'],
    ['tiles array absent', makeDoc({ tilesets: [{ firstgid: 1, tilecount: 4 }] }), 'm1'],
    ['tile not object', makeDoc({ tiles: [null] }), 'm1'],
    ['tile id out of range', makeDoc({ tiles: [{ id: 9 }] }), 'm1'],
    ['duplicate tile id', makeDoc({ tiles: [{ id: 0 }, { id: 0 }] }), 'm1'],
    ['unnamed property', makeDoc({ tiles: [{ id: 0, properties: [{ value: 1 }] }] }), 'm1'],
    [
      'duplicate property',
      makeDoc({
        tiles: [
          {
            id: 0,
            properties: [
              { name: 'a', value: 1 },
              { name: 'a', value: 2 },
            ],
          },
        ],
      }),
      'm1',
    ],
    ['properties not array', makeDoc({ tiles: [{ id: 0, properties: {} }] }), 'm1'],
    ['gid float rejected', makeDoc({ terrainData: [1.5, 2, 2, 1] }), 'm1'],
    ['gid negative rejected', makeDoc({ terrainData: [-1, 2, 2, 1] }), 'm1'],
    ['gid overflow rejected', makeDoc({ terrainData: [0x100000000, 2, 2, 1] }), 'm1'],
    ['terrain hole rejected', makeDoc({ terrainData: [0, 2, 2, 1] }), 'm1'],
    ['gid past tileset rejected', makeDoc({ terrainData: [99, 2, 2, 1] }), 'm1'],
    [
      'gid below firstgid rejected',
      makeDoc({ terrainData: [1, 2, 2, 1], tilesets: [{ firstgid: 5, tilecount: 4, tiles: [] }] }),
      'm1',
    ],
    ['terrain prop missing', makeDoc({ tiles: [{ id: 0 }, terrainTile(1, 'forest')] }), 'm1'],
    [
      'terrain prop invalid',
      makeDoc({ tiles: [terrainTile(0, 'lava'), terrainTile(1, 'forest')] }),
      'm1',
    ],
    ['spawn prop missing', makeDoc({ terrainData: [1, 1, 1, 1], spawnData: [2, 0, 0, 0] }), 'm1'],
    [
      'spawn prop invalid',
      makeDoc({
        tiles: [
          terrainTile(0, 'field'),
          terrainTile(1, 'forest'),
          spawnTile(2, -1),
          spawnTile(3, 1),
        ],
      }),
      'm1',
    ],
    [
      'duplicate spawn player',
      makeDoc({
        tiles: [terrainTile(0, 'field'), spawnTile(1, 0), spawnTile(2, 0)],
        tilecount: 3,
        terrainData: [1, 1, 1, 1],
        spawnData: [2, 3, 0, 0],
      }),
      'm1',
    ],
  ] as Array<[string, unknown, unknown]>)('rejects %s', (_label, doc, id) => {
    expect(() => loadMapData(doc, id)).toThrow(/loadMapData/);
  });

  it('rejects 17 spawns from a doc (max 16)', () => {
    const tiles: unknown[] = [terrainTile(0, 'field')];
    for (let i = 0; i < 17; i += 1) {
      tiles.push(spawnTile(1 + i, i));
    }
    const spawnData = Array.from({ length: 64 }, (_, i) => (i < 17 ? 2 + i : 0));
    const doc = makeDoc({
      width: 8,
      height: 8,
      tiles,
      tilecount: 18,
      terrainData: Array(64).fill(1),
      spawnData,
    });
    expect(() => loadMapData(doc, 'm1')).toThrow(/too many spawns/);
  });
});

describe('WorldState map extension (integration)', () => {
  it('createWorldState carries a map', () => {
    const map = validMap();
    const state = createWorldState({ players: [P1, P2], map });
    expect(state.map).toEqual(map);
  });

  it('guard rejects a state with a bad map', () => {
    const map = validMap() as unknown as Record<string, unknown>;
    const cells = [{ col: 0, row: 0, terrain: 'lava' }];
    expect(() =>
      createWorldState({ players: [P1], map: { ...map, cells } as unknown as MapData }),
    ).toThrow(/invalid initial world/);
  });

  it('map key omitted when absent (PROMPTS bytes: no map, no prompts until seeded)', () => {
    const state = createWorldState({ players: [P1] });
    expect('map' in state).toBe(false);
    expect('prompts' in state).toBe(false);
    expect(state).toEqual({ schemaVersion: 1, players: [{ id: P1 }] });
  });
});

describe('map-preserved post-rule (security)', () => {
  function wrappedMutator(mutated: MapData): () => unknown {
    const state = createWorldState({ players: [P1], map: validMap() });
    const wrapped = wrapWithValidation(
      () => ({ applied: true, state: { ...state, map: mutated }, summary: 'mut' }),
      createWorldValidator(),
      7,
      () => 1,
    );
    return () => wrapped({ state, caller: P1, params: {} });
  }

  it('rejects a terrain swap', () => {
    const base = validMap();
    const cells = base.cells.map((cell, i) =>
      i === 0 ? { ...cell, terrain: 'city' as const } : cell,
    );
    expect(wrappedMutator({ ...base, cells })).toThrow(/map-preserved/);
  });

  it('rejects a spawn edit', () => {
    const base = validMap();
    const spawns = [{ playerIndex: 0, col: 1, row: 0 }];
    expect(wrappedMutator({ ...base, spawns })).toThrow(/map-preserved/);
  });

  it('rejects a map id swap', () => {
    const base = validMap();
    expect(wrappedMutator({ ...base, id: 'other' as never })).toThrow(/map-preserved/);
  });
});

describe('match.started map summary (integration)', () => {
  it('carries map id + version when present', () => {
    const match = new Match({
      seed: 5,
      ruleset: STANDARD_RULESET,
      players: [P1, P2],
      initialState: createWorldState({ players: [P1, P2], map: validMap() }),
    });
    const started = match.getEvents()[0];
    expect(started?.type).toBe('match.started');
    expect(started?.payload).toEqual({
      seed: 5,
      players: [P1, P2],
      ruleset: STANDARD_RULESET,
      map: { id: 'test-map', version: 1 },
    });
  });

  it('omits map when absent', () => {
    const match = new Match({
      seed: 5,
      ruleset: STANDARD_RULESET,
      players: [P1, P2],
      initialState: createWorldState({ players: [P1, P2] }),
    });
    const started = match.getEvents()[0];
    expect(started?.type).toBe('match.started');
    expect('map' in (started?.payload as Record<string, unknown>)).toBe(false);
  });
});

describe('view map-filtering (security)', () => {
  it('WORLD view carries the map (identity)', () => {
    const state = createWorldState({ players: [P1], map: validMap() });
    expect(toWorldView(state)).toBe(state);
    expect(toWorldView(state).map).toEqual(validMap());
  });

  it('AI perception carries a filtered map (M015: blindness lifted selectively)', () => {
    const state = createWorldState({ players: [P1], map: validMap() });
    const cell0 = state.map?.cells[0];
    if (cell0 === undefined) {
      throw new Error('test setup: expected cell 0');
    }
    const map = toAiPerception(state, P1, { p1: [0] }).known.map;
    if (map === undefined) {
      throw new Error('test setup: expected perceived map');
    }
    expect(Object.keys(map).sort()).toEqual(['explored', 'height', 'inferred', 'visible', 'width']);
    expect(map.visible).toEqual({ 0: cell0.terrain });
    expect(map.explored).toEqual([]);
    expect(map.inferred).toEqual({});
  });

  it('CLIENT view carries the same filtered map', () => {
    const state = createWorldState({ players: [P1], map: validMap() });
    const map = toClientView(state, P1, { p1: [0] }).state.map;
    if (map === undefined) {
      throw new Error('test setup: expected perceived map');
    }
    expect(Object.keys(map).sort()).toEqual(['explored', 'height', 'inferred', 'visible', 'width']);
    expect(map.visible).toEqual(toAiPerception(state, P1, { p1: [0] }).known.map?.visible);
    expect(map.inferred).toEqual({});
  });
});
