/**
 * M011 — Terrain tests: config guard, default values, query API.
 */
import { describe, expect, it } from 'vitest';
import { isMapData, type MapData, type MapId } from './map.js';
import {
  cellModifiers,
  DEFAULT_TERRAIN_CONFIG,
  isPassable,
  isTerrainConfig,
  modifiersFor,
  type TerrainConfig,
} from './terrain.js';

const TEST_MAP: MapData = {
  schemaVersion: 1,
  id: 't1' as MapId,
  width: 2,
  height: 2,
  stagger: 'odd',
  cells: [
    { col: 0, row: 0, terrain: 'field' },
    { col: 1, row: 0, terrain: 'forest' },
    { col: 0, row: 1, terrain: 'mountain' },
    { col: 1, row: 1, terrain: 'river' },
  ],
  spawns: [],
};

function configWith(terrain: string, patch: Record<string, unknown>): TerrainConfig {
  const clone = structuredClone(DEFAULT_TERRAIN_CONFIG) as unknown as Record<string, unknown>;
  clone[terrain] = { ...(clone[terrain] as Record<string, unknown>), ...patch };
  return clone as unknown as TerrainConfig;
}

describe('isTerrainConfig (unit)', () => {
  it('accepts the default config', () => {
    expect(isTerrainConfig(DEFAULT_TERRAIN_CONFIG)).toBe(true);
  });

  it.each([
    ['number', 42],
    ['null', null],
    ['array', []],
  ] as Array<[string, unknown]>)('rejects %s', (_label, value) => {
    expect(isTerrainConfig(value)).toBe(false);
  });

  it('rejects a config missing one terrain', () => {
    const clone = structuredClone(DEFAULT_TERRAIN_CONFIG) as unknown as Record<string, unknown>;
    delete clone['city'];
    expect(isTerrainConfig(clone)).toBe(false);
  });

  it('rejects a config with an extra terrain', () => {
    const clone = structuredClone(DEFAULT_TERRAIN_CONFIG) as unknown as Record<string, unknown>;
    clone['lava'] = { move: 1, defense: 0, stealth: 0, ranged: 0 };
    expect(isTerrainConfig(clone)).toBe(false);
  });

  it('rejects an unknown terrain key', () => {
    const clone = structuredClone(DEFAULT_TERRAIN_CONFIG) as unknown as Record<string, unknown>;
    clone['lava'] = clone['field'];
    delete clone['field'];
    expect(isTerrainConfig(clone)).toBe(false);
  });

  it.each([
    ['negative move', 'field', { move: -1 }],
    ['NaN move', 'field', { move: NaN }],
    ['text move', 'field', { move: 'fast' }],
    ['NaN defense', 'forest', { defense: NaN }],
    ['infinite defense', 'forest', { defense: Infinity }],
    ['text stealth', 'forest', { stealth: 'high' }],
    ['missing ranged', 'road', { ranged: undefined }],
    ['null modifiers', 'road', null],
    ['array modifiers', 'road', []],
  ] as Array<[string, string, unknown]>)('rejects %s', (_label, terrain, patch) => {
    if (patch === null || Array.isArray(patch)) {
      const clone = structuredClone(DEFAULT_TERRAIN_CONFIG) as unknown as Record<string, unknown>;
      clone[terrain] = patch;
      expect(isTerrainConfig(clone)).toBe(false);
    } else {
      expect(isTerrainConfig(configWith(terrain, patch as Record<string, unknown>))).toBe(false);
    }
  });
});

describe('DEFAULT_TERRAIN_CONFIG (unit)', () => {
  it('locks the #17-directed values (rest neutral)', () => {
    expect(DEFAULT_TERRAIN_CONFIG).toEqual({
      field: { move: 1, defense: 0, stealth: 0, ranged: 0 },
      forest: { move: 2, defense: 1, stealth: 2, ranged: 0 },
      mountain: { move: 3, defense: 2, stealth: 0, ranged: 1 },
      river: { move: Infinity, defense: 0, stealth: 0, ranged: 0 },
      road: { move: 0.5, defense: 0, stealth: 0, ranged: 0 },
      bridge: { move: 1, defense: 0, stealth: 0, ranged: 0 },
      resource: { move: 1, defense: 0, stealth: 0, ranged: 0 },
      village: { move: 1, defense: 0, stealth: 0, ranged: 0 },
      city: { move: 1, defense: 0, stealth: 0, ranged: 0 },
    });
  });

  it('is deep-frozen', () => {
    expect(Object.isFrozen(DEFAULT_TERRAIN_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_TERRAIN_CONFIG.forest)).toBe(true);
  });
});

describe('terrain queries (unit)', () => {
  it('fixture map is valid', () => {
    expect(isMapData(TEST_MAP)).toBe(true);
  });

  it('modifiersFor reads exact values', () => {
    expect(modifiersFor(DEFAULT_TERRAIN_CONFIG, 'forest')).toEqual({
      move: 2,
      defense: 1,
      stealth: 2,
      ranged: 0,
    });
  });

  it('modifiersFor throws on unknown terrain (fail-stop)', () => {
    expect(() => modifiersFor(DEFAULT_TERRAIN_CONFIG, 'lava' as never)).toThrow(/unknown terrain/);
  });

  it('cellModifiers resolves through the map', () => {
    expect(cellModifiers(DEFAULT_TERRAIN_CONFIG, TEST_MAP, 1, 0)).toEqual(
      modifiersFor(DEFAULT_TERRAIN_CONFIG, 'forest'),
    );
    expect(cellModifiers(DEFAULT_TERRAIN_CONFIG, TEST_MAP, 0, 1)).toEqual(
      modifiersFor(DEFAULT_TERRAIN_CONFIG, 'mountain'),
    );
  });

  it('cellModifiers is undefined out of bounds', () => {
    expect(cellModifiers(DEFAULT_TERRAIN_CONFIG, TEST_MAP, 9, 9)).toBeUndefined();
  });

  it.each([
    ['road', true],
    ['river', false],
    ['mountain', true],
  ] as Array<[string, boolean]>)('isPassable(%s) === %j', (terrain, expected) => {
    expect(isPassable(DEFAULT_TERRAIN_CONFIG, terrain as never)).toBe(expected);
  });

  it('isPassable throws on unknown terrain', () => {
    expect(() => isPassable(DEFAULT_TERRAIN_CONFIG, 'lava' as never)).toThrow(/unknown terrain/);
  });
});
