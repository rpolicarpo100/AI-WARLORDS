/**
 * Tiled (.tmj) scenario loader — DESIGN TOOLING, not engine code.
 * Reads the hand-authored Tiled hexagonal map (assets/vale.tmj) and builds
 * the engine's MapData + UnitsData. Single source of truth for the scenario:
 * edit the map in Tiled, regenerate state, done.
 *
 * Validation follows the Tiled JSON/TMX spec: orientation/stagger fields,
 * tileset firstgid arithmetic, the four high GID flag bits, GID 0 = empty,
 * layer sizes, and typed custom properties.
 */
import { readFileSync } from 'node:fs';
import type { MapCell, MapData, ResourceType, TerrainId } from '../src/engine/map.js';
import type { UnitsData } from '../src/engine/units.js';

// Tiled flips tiles with the four HIGH bits of the 32-bit GID.
const FLIP_BITS = 0xf0000000;
const GID_MASK = 0x0fffffff;

interface TiledProperty {
  name: string;
  type: string;
  value: unknown;
}
interface TiledObject {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  point?: boolean;
  properties?: TiledProperty[];
}
interface TiledLayer {
  id: number;
  name: string;
  type: string;
  width?: number;
  height?: number;
  data?: number[];
  objects?: TiledObject[];
}
interface TiledTileset {
  firstgid: number;
  name: string;
  tilecount: number;
  columns: number;
  tiles?: Array<{ id: number; properties?: TiledProperty[] }>;
}
interface TiledMap {
  type: string;
  version: string;
  orientation: string;
  staggeraxis?: string;
  staggerindex?: string;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  hexsidelength?: number;
  tilesets: TiledTileset[];
  layers: TiledLayer[];
}

function fail(what: string): never {
  throw new Error(`tiled-map: invalid ${what} in vale.tmj`);
}

function propsOf(obj: { properties?: TiledProperty[]; name: string }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of obj.properties ?? []) out[p.name] = p.value;
  return out;
}

function asInt(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(`${what} (expected int)`);
  return v as number;
}

function asTerrain(v: unknown): TerrainId {
  const ok: TerrainId[] = [
    'field',
    'forest',
    'mountain',
    'river',
    'road',
    'bridge',
    'village',
    'city',
    'resource',
  ];
  if (typeof v !== 'string' || !ok.includes(v as TerrainId)) fail(`terrain '${String(v)}'`);
  return v as TerrainId;
}

function asResource(v: unknown): ResourceType {
  const ok: ResourceType[] = ['food', 'wood', 'stone', 'gold'];
  if (typeof v !== 'string' || !ok.includes(v as ResourceType)) fail(`resource '${String(v)}'`);
  return v as ResourceType;
}

export interface TiledScenario {
  map: MapData;
  units: UnitsData;
}

/** Parse + strictly validate the .tmj, then build engine data. Throws on any defect. */
export function loadTiledMap(url: URL): TiledScenario {
  const raw: unknown = JSON.parse(readFileSync(url, 'utf8'));
  if (typeof raw !== 'object' || raw === null) fail('root (expected object)');
  const tmj = raw as Partial<TiledMap>;
  if (tmj.type !== 'map') fail('type (expected "map")');
  if (tmj.orientation !== 'hexagonal') fail('orientation (expected "hexagonal")');
  // Engine models odd-q pointy-top: Tiled stagger axis Y + odd index.
  if (tmj.staggeraxis !== 'y' || tmj.staggerindex !== 'odd') {
    fail('stagger (expected axis "y" + index "odd")');
  }
  if (tmj.width !== 8 || tmj.height !== 6) fail('size (expected 8x6)');
  if (!Array.isArray(tmj.tilesets) || tmj.tilesets.length !== 1) fail('tilesets (expected exactly 1)');
  const ts = tmj.tilesets[0]!;
  if (ts.firstgid !== 1) fail('tileset firstgid (expected 1)');
  if (ts.tilecount !== 9) fail('tileset tilecount (expected 9)');

  // GID -> terrain via per-tile custom properties (local id = gid - firstgid).
  const terrainByLocal = new Map<number, TerrainId>();
  for (const t of ts.tiles ?? []) {
    const p = propsOf({ properties: t.properties, name: `tile#${t.id}` });
    terrainByLocal.set(t.id, asTerrain(p['terrain']));
  }
  if (terrainByLocal.size !== 9) fail('tileset (expected terrain on all 9 tiles)');

  const layers = tmj.layers ?? [];
  const terrainLayer = layers.find((l) => l.type === 'tilelayer' && l.name === 'Terrain');
  if (!terrainLayer || !Array.isArray(terrainLayer.data)) fail('Terrain tilelayer');
  if (terrainLayer.data.length !== 48) fail('Terrain data (expected 48 gids)');

  const byName = (name: string): TiledObject[] => {
    const layer = layers.find((l) => l.type === 'objectgroup' && l.name === name);
    if (!layer || !Array.isArray(layer.objects)) fail(`objectgroup "${name}"`);
    return [...(layer.objects as TiledObject[])].sort((a, b) => a.id - b.id);
  };

  const cells: MapCell[] = [];
  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const rawGid = terrainLayer.data[row * 8 + col]!;
      if ((rawGid & FLIP_BITS) !== 0) fail(`gid flags set at (${col},${row})`);
      const gid = rawGid & GID_MASK;
      if (gid === 0) fail(`empty tile at (${col},${row})`);
      const terrain = terrainByLocal.get(gid - ts.firstgid);
      if (terrain === undefined) fail(`gid ${gid} out of tileset range`);
      cells.push({ col, row, terrain });
    }
  }
  const at = (col: number, row: number): MapCell => {
    const cell = cells[row * 8 + col];
    if (cell === undefined) fail(`cell (${col},${row}) out of bounds`);
    return cell;
  };

  for (const o of byName('Resources')) {
    if (o.type !== 'resource') fail(`object "${o.name}" type (expected "resource")`);
    const p = propsOf(o);
    const col = asInt(p['col'], `${o.name}.col`);
    const row = asInt(p['row'], `${o.name}.row`);
    const cell = at(col, row);
    if (cell.terrain !== 'resource') fail(`resource "${o.name}" not on a resource tile`);
    if (cell.resource !== undefined) fail(`duplicate resource at (${col},${row})`);
    cell.resource = { type: asResource(p['resource']), amount: asInt(p['amount'], `${o.name}.amount`) };
  }

  const spawns = byName('Spawns').map((o) => {
    if (o.type !== 'spawn') fail(`object "${o.name}" type (expected "spawn")`);
    const p = propsOf(o);
    return {
      playerIndex: asInt(p['playerIndex'], `${o.name}.playerIndex`),
      col: asInt(p['col'], `${o.name}.col`),
      row: asInt(p['row'], `${o.name}.row`),
    };
  });
  spawns.sort((a, b) => a.playerIndex - b.playerIndex);
  if (spawns.length !== 2 || spawns[0]!.playerIndex !== 0 || spawns[1]!.playerIndex !== 1) {
    fail('Spawns (expected playerIndex 0 and 1)');
  }

  const units = byName('Units').map((o) => {
    if (o.type !== 'unit') fail(`object "${o.name}" type (expected "unit")`);
    const p = propsOf(o);
    const owner = p['owner'];
    if (owner !== 'p1' && owner !== 'p2') fail(`unit "${o.name}" owner`);
    const unitType = p['unitType'];
    if (unitType !== 'worker' && unitType !== 'warrior' && unitType !== 'archer') {
      fail(`unit "${o.name}" unitType`);
    }
    return {
      id: o.name,
      owner,
      type: unitType,
      hp: asInt(p['hp'], `${o.name}.hp`),
      col: asInt(p['col'], `${o.name}.col`),
      row: asInt(p['row'], `${o.name}.row`),
    };
  });
  let nextId = 0;
  for (const u of units) {
    const m = /^u(\d+)$/.exec(u.id);
    if (m) nextId = Math.max(nextId, Number(m[1]) + 1);
    at(u.col, u.row); // bounds check
  }

  return {
    map: {
      schemaVersion: 1,
      id: 'mockup-vale' as MapData['id'],
      width: 8,
      height: 6,
      stagger: 'odd',
      cells,
      spawns,
    },
    units: { schemaVersion: 1, nextId, units },
  };
}
