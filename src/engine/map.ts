/**
 * M010 — Map System: hex-grid topology, canonical MapData, and the Tiled
 * hexagonal loader (strict documented subset).
 *
 * LEAF module: zero imports — topology and validation are self-contained by
 * design (`world-state.ts` imports FROM here). Literals that mirror other
 * modules' constants are marked; hoist if a third use appears.
 *
 * Geometry: hex grid with axis=y stagger (Tiled semantics, verified against
 * the Tiled 1.12.2 docs). Cells are STORED in dense row-major offset coords
 * (O(1) lookup, stagger-independent coherence); axial coords are the pure
 * math layer (neighbors, distance). Render orientation (pointy/flat-top) is
 * presentational — there is no renderer, so it stays out of the engine.
 */

export const MAP_SCHEMA_VERSION = 1;
export const MAX_MAP_DIM = 64;
export const MAX_SPAWNS = 16;

/** Mirrors MAX_ID_LENGTH (authority.js). Leaf: deliberately not imported. */
const MAX_ID_CHARS = 64;
/** Mirrors MAX_UINT32 (authority.js). Leaf: deliberately not imported. */
const MAX_INDEX = 0xffffffff;
/**
 * Top 4 GID bits are presentational flip/rotation flags (Tiled
 * global-tile-ids reference); the engine clears them via modulo.
 */
const GID_FLAG_MODULO = 0x10000000;

declare const mapBrand: unique symbol;
export type MapId = string & { readonly [mapBrand]: 'map' };

export function isMapId(value: unknown): value is MapId {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_ID_CHARS;
}

/**
 * Closed terrain vocabulary: the 9 map elements of master-doc #13.
 * M010 defines WHAT a map can contain; gameplay VALUES arrive in M011.
 */
export const TERRAIN_IDS: readonly string[] = Object.freeze([
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

export type TerrainId =
  'field' | 'forest' | 'mountain' | 'river' | 'road' | 'bridge' | 'resource' | 'village' | 'city';

export function isTerrainId(value: unknown): value is TerrainId {
  return typeof value === 'string' && TERRAIN_IDS.includes(value);
}

export interface AxialCoord {
  readonly q: number;
  readonly r: number;
}

function axial(q: number, r: number): AxialCoord {
  return Object.freeze({ q, r });
}

const NEIGHBOR_OFFSETS: readonly AxialCoord[] = Object.freeze([
  axial(1, 0),
  axial(1, -1),
  axial(0, -1),
  axial(-1, 0),
  axial(-1, 1),
  axial(0, 1),
]);

export function axialNeighbors(center: AxialCoord): AxialCoord[] {
  return NEIGHBOR_OFFSETS.map((offset) => ({ q: center.q + offset.q, r: center.r + offset.r }));
}

export function axialDistance(a: AxialCoord, b: AxialCoord): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Which rows are shifted (Tiled staggerindex, axis=y). */
export type HexStagger = 'odd' | 'even';

export function offsetToAxial(col: number, row: number, stagger: HexStagger): AxialCoord {
  // odd-r / even-r (redblobgames), matching Tiled axis=y semantics.
  const shift = stagger === 'odd' ? (row - (row & 1)) / 2 : (row + (row & 1)) / 2;
  return { q: col - shift, r: row };
}

export function axialToOffset(
  q: number,
  r: number,
  stagger: HexStagger,
): { readonly col: number; readonly row: number } {
  const shift = stagger === 'odd' ? (r - (r & 1)) / 2 : (r + (r & 1)) / 2;
  return { col: q + shift, row: r };
}

export interface MapCell {
  readonly col: number;
  readonly row: number;
  readonly terrain: TerrainId;
}

export interface SpawnPoint {
  readonly playerIndex: number;
  readonly col: number;
  readonly row: number;
}

export interface MapData {
  readonly schemaVersion: typeof MAP_SCHEMA_VERSION;
  readonly id: MapId;
  readonly width: number;
  readonly height: number;
  readonly stagger: HexStagger;
  readonly cells: readonly MapCell[];
  readonly spawns: readonly SpawnPoint[];
}

function isDim(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_MAP_DIM;
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_INDEX;
}

export function isMapData(value: unknown): value is MapData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  if (fields['schemaVersion'] !== MAP_SCHEMA_VERSION) {
    return false;
  }
  if (!isMapId(fields['id'])) {
    return false;
  }
  const width = fields['width'];
  const height = fields['height'];
  if (!isDim(width) || !isDim(height)) {
    return false;
  }
  // 64x64 = 4096 cells max: dims bound implies the cell-count bound.
  if (fields['stagger'] !== 'odd' && fields['stagger'] !== 'even') {
    return false;
  }
  const cells = fields['cells'];
  if (!Array.isArray(cells) || cells.length !== width * height) {
    return false;
  }
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index] as Record<string, unknown> | undefined;
    if (typeof cell !== 'object' || cell === null || Array.isArray(cell)) {
      return false;
    }
    if (cell['col'] !== index % width || cell['row'] !== Math.floor(index / width)) {
      return false;
    }
    if (!isTerrainId(cell['terrain'])) {
      return false;
    }
  }
  const spawns = fields['spawns'];
  if (!Array.isArray(spawns) || spawns.length > MAX_SPAWNS) {
    return false;
  }
  const seenCells = new Set<string>();
  const seenPlayers = new Set<number>();
  for (const entry of spawns) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return false;
    }
    const spawn = entry as Record<string, unknown>;
    const playerIndex = spawn['playerIndex'];
    const col = spawn['col'];
    const row = spawn['row'];
    if (!isIndex(playerIndex)) {
      return false;
    }
    if (
      typeof col !== 'number' ||
      !Number.isInteger(col) ||
      col < 0 ||
      col >= width ||
      typeof row !== 'number' ||
      !Number.isInteger(row) ||
      row < 0 ||
      row >= height
    ) {
      return false;
    }
    if (seenPlayers.has(playerIndex)) {
      return false;
    }
    seenPlayers.add(playerIndex);
    const key = `${col},${row}`;
    if (seenCells.has(key)) {
      return false;
    }
    seenCells.add(key);
  }
  return true;
}

export function cellAt(map: MapData, col: number, row: number): MapCell | undefined {
  if (!Number.isInteger(col) || !Number.isInteger(row)) {
    return undefined;
  }
  if (col < 0 || col >= map.width || row < 0 || row >= map.height) {
    return undefined;
  }
  return map.cells[row * map.width + col];
}

export function cellAtAxial(map: MapData, q: number, r: number): MapCell | undefined {
  const { col, row } = axialToOffset(q, r, map.stagger);
  return cellAt(map, col, row);
}

/** In-bounds neighbors only; empty for out-of-bounds input. */
export function neighborsOf(map: MapData, col: number, row: number): readonly MapCell[] {
  if (cellAt(map, col, row) === undefined) {
    return [];
  }
  const origin = offsetToAxial(col, row, map.stagger);
  const found: MapCell[] = [];
  for (const offset of NEIGHBOR_OFFSETS) {
    const cell = cellAtAxial(map, origin.q + offset.q, origin.r + offset.r);
    if (cell !== undefined) {
      found.push(cell);
    }
  }
  return found;
}

/** Spawn seam for unit placement (M021). */
export function spawnFor(map: MapData, playerIndex: number): SpawnPoint | undefined {
  return map.spawns.find((spawn) => spawn.playerIndex === playerIndex);
}

// ─── Tiled hexagonal loader (strict subset) ─────────────────────────────────
// Accepted: type=map, orientation=hexagonal, staggeraxis=y, staggerindex
// odd|even, finite dims 1..64, tile layers 'terrain' (required, dense) and
// 'spawns' (optional), exactly one EMBEDDED tileset, gid-array data.
// Rejected loud: object/image/group layers, unknown layers, external
// tilesets, chunked/base64 data, layer offsets, non-dense terrain.
// Tile meaning comes from per-tile custom properties: `terrain` (terrain
// layer) and `playerIndex` (spawn layer). Tiled's legacy corner-`terrain`
// array is ignored; flip/rotation GID bits are presentational (cleared).

function reqObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`loadMapData: invalid ${what} (expected object).`);
  }
  return value as Record<string, unknown>;
}

function reqArray(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`loadMapData: invalid ${what} (expected array).`);
  }
  return value;
}

function reqGid(value: unknown, index: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_INDEX) {
    throw new Error(`loadMapData: invalid gid at cell ${index} (expected uint32).`);
  }
  return value;
}

/** Custom properties by name; duplicate names are malformed (fail loud). */
function readProps(value: unknown): Map<string, unknown> {
  const props = new Map<string, unknown>();
  if (value === undefined) {
    return props;
  }
  const entries = reqArray(value, 'tile properties');
  for (const entry of entries) {
    const prop = reqObject(entry, 'tile property');
    const name = prop['name'];
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('loadMapData: tile property without a name.');
    }
    if (props.has(name)) {
      throw new Error(`loadMapData: duplicate tile property "${name}".`);
    }
    props.set(name, prop['value']);
  }
  return props;
}

interface LayerData {
  readonly data: readonly unknown[];
}

export function loadMapData(doc: unknown, id: unknown): MapData {
  if (!isMapId(id)) {
    throw new Error('loadMapData: invalid map id (expected 1..64 chars).');
  }
  const root = reqObject(doc, 'map document');
  if (root['type'] !== 'map') {
    throw new Error('loadMapData: not a Tiled map document (type must be "map").');
  }
  if (root['orientation'] !== 'hexagonal') {
    throw new Error('loadMapData: only hexagonal orientation is supported.');
  }
  if (root['staggeraxis'] !== 'y') {
    throw new Error('loadMapData: only stagger axis "y" is supported.');
  }
  const stagger = root['staggerindex'];
  if (stagger !== 'odd' && stagger !== 'even') {
    throw new Error('loadMapData: staggerindex must be "odd" or "even".');
  }
  if (root['infinite'] === true) {
    throw new Error('loadMapData: infinite maps are unsupported.');
  }
  const width = root['width'];
  const height = root['height'];
  if (!isDim(width) || !isDim(height)) {
    throw new Error('loadMapData: width/height must be integers 1..64.');
  }
  const layers = reqArray(root['layers'], 'layers');

  let terrain: LayerData | undefined;
  let spawnLayer: LayerData | undefined;
  for (const entry of layers) {
    const layer = reqObject(entry, 'layer');
    if (layer['type'] !== 'tilelayer') {
      throw new Error(
        `loadMapData: only tile layers are supported (found "${String(layer['type'])}").`,
      );
    }
    const name = layer['name'];
    if (name !== 'terrain' && name !== 'spawns') {
      throw new Error(`loadMapData: unsupported layer "${String(name)}".`);
    }
    if (
      (layer['x'] !== undefined && layer['x'] !== 0) ||
      (layer['y'] !== undefined && layer['y'] !== 0)
    ) {
      throw new Error(`loadMapData: layer "${String(name)}" has a tile offset (must be 0).`);
    }
    if (layer['width'] !== width || layer['height'] !== height) {
      throw new Error(`loadMapData: layer "${String(name)}" dims differ from map dims.`);
    }
    if ('chunks' in layer) {
      throw new Error(
        `loadMapData: layer "${String(name)}" is chunked (infinite maps unsupported).`,
      );
    }
    const data = layer['data'];
    if (!Array.isArray(data)) {
      throw new Error(
        `loadMapData: layer "${String(name)}" needs a gid array (base64/compressed unsupported).`,
      );
    }
    if (data.length !== width * height) {
      throw new Error(
        `loadMapData: layer "${String(name)}" has ${data.length} cells, expected ${width * height}.`,
      );
    }
    if (name === 'terrain') {
      if (terrain !== undefined) {
        throw new Error('loadMapData: duplicate "terrain" layer.');
      }
      terrain = { data };
    } else {
      if (spawnLayer !== undefined) {
        throw new Error('loadMapData: duplicate "spawns" layer.');
      }
      spawnLayer = { data };
    }
  }
  if (terrain === undefined) {
    throw new Error('loadMapData: missing "terrain" layer.');
  }

  const tilesets = reqArray(root['tilesets'], 'tilesets');
  if (tilesets.length !== 1) {
    throw new Error('loadMapData: exactly one tileset is required.');
  }
  const tileset = reqObject(tilesets[0], 'tileset');
  if ('source' in tileset) {
    throw new Error('loadMapData: external tilesets are unsupported (embed it).');
  }
  const firstgid = tileset['firstgid'];
  if (typeof firstgid !== 'number' || !Number.isInteger(firstgid) || firstgid < 1) {
    throw new Error('loadMapData: tileset firstgid must be a positive integer.');
  }
  const tilecount = tileset['tilecount'];
  if (typeof tilecount !== 'number' || !Number.isInteger(tilecount) || tilecount < 1) {
    throw new Error('loadMapData: tileset tilecount must be a positive integer.');
  }
  const propsByLocal = new Map<number, Map<string, unknown>>();
  const tiles = tileset['tiles'];
  if (tiles !== undefined) {
    for (const entry of reqArray(tiles, 'tileset tiles')) {
      const tile = reqObject(entry, 'tile');
      const local = tile['id'];
      if (
        typeof local !== 'number' ||
        !Number.isInteger(local) ||
        local < 0 ||
        local >= tilecount
      ) {
        throw new Error('loadMapData: tile id out of tileset range.');
      }
      if (propsByLocal.has(local)) {
        throw new Error(`loadMapData: duplicate tile id ${local}.`);
      }
      propsByLocal.set(local, readProps(tile['properties']));
    }
  }

  const localOf = (gid: number, index: number): number => {
    const base = gid % GID_FLAG_MODULO;
    if (base === 0) {
      return -1;
    }
    const local = base - firstgid;
    if (local < 0 || local >= tilecount) {
      throw new Error(`loadMapData: cell ${index} gid ${gid} is outside the tileset.`);
    }
    return local;
  };

  const cells: MapCell[] = [];
  terrain.data.forEach((raw, index) => {
    const gid = reqGid(raw, index);
    const local = localOf(gid, index);
    if (local === -1) {
      throw new Error(`loadMapData: terrain cell ${index} is empty (terrain must be dense).`);
    }
    const terrainProp = propsByLocal.get(local)?.get('terrain');
    if (!isTerrainId(terrainProp)) {
      throw new Error(`loadMapData: tile ${local} lacks a valid "terrain" property.`);
    }
    cells.push({ col: index % width, row: Math.floor(index / width), terrain: terrainProp });
  });

  const spawns: SpawnPoint[] = [];
  if (spawnLayer !== undefined) {
    spawnLayer.data.forEach((raw, index) => {
      const gid = reqGid(raw, index);
      const local = localOf(gid, index);
      if (local === -1) {
        return;
      }
      const playerProp = propsByLocal.get(local)?.get('playerIndex');
      if (!isIndex(playerProp)) {
        throw new Error(`loadMapData: tile ${local} lacks a valid "playerIndex" property.`);
      }
      spawns.push({
        playerIndex: playerProp,
        col: index % width,
        row: Math.floor(index / width),
      });
    });
    if (spawns.length > MAX_SPAWNS) {
      throw new Error(`loadMapData: too many spawns (max ${MAX_SPAWNS}).`);
    }
    const seenPlayers = new Set<number>();
    for (const spawn of spawns) {
      if (seenPlayers.has(spawn.playerIndex)) {
        throw new Error(`loadMapData: duplicate spawn for player ${spawn.playerIndex}.`);
      }
      seenPlayers.add(spawn.playerIndex);
    }
  }

  const map: MapData = {
    schemaVersion: MAP_SCHEMA_VERSION,
    id,
    width,
    height,
    stagger,
    cells,
    spawns,
  };
  // Defensive self-check: unreachable via I/O (every construction step above
  // is individually validated). Kept to guard future edits, not the metric:
  // loader tests assert isMapData(output) directly (see map.test.ts).
  /* v8 ignore next 3 */
  if (!isMapData(map)) {
    throw new Error('loadMapData: internal error (built map failed validation).');
  }
  return map;
}
