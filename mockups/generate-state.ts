/**
 * Mockup scenario generator (DESIGN ARTIFACT — not engine code).
 * Boots a real deterministic Match (seed 7), plays scripted dispatches,
 * and exports genuine snapshots/events/perception for the mockup pages.
 * Run: npx tsx mockups/generate-state.ts
 */
import { writeFileSync } from 'node:fs';
import {
  markUntrusted,
  type ClientRequest,
  type PlayerId,
  type Untrusted,
} from '../src/engine/authority.js';
import {
  DEFAULT_ECONOMY_CONFIG,
  type BuildingsConfig,
  type EconomyConfig,
} from '../src/engine/economy.js';
import { computeVisibility } from '../src/engine/fog.js';
import { markExplored } from '../src/engine/exploration.js';
import { Match, STANDARD_RULESET } from '../src/engine/match.js';
import type { MapCell, MapData, ResourceType, TerrainId } from '../src/engine/map.js';
import type { UnitsData } from '../src/engine/units.js';
import { DEFAULT_UNITS_CONFIG, type UnitsConfig } from '../src/engine/warfare.js';
import { createWorldState } from '../src/engine/world-state.js';
import { perceive } from '../src/engine/views.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

function raw(value: unknown): Untrusted<ClientRequest> {
  return markUntrusted(value as ClientRequest);
}

// 8x6 scenario map. F field, T forest, M mountain, R river, D road,
// B bridge, V village, C city, G/O/W/S resource nodes (gold/food/wood/stone).
const ROWS = [
  'TFFMMFTF',
  'FDDDBRFT',
  'FDCGWRVF',
  'FDFSF RFM'.replace(' ', ''),
  'TFFDDBRF',
  'FTOFMFTF',
];
const NODE_OF: Record<string, { type: ResourceType; amount: number }> = {
  G: { type: 'gold', amount: 30 },
  O: { type: 'food', amount: 40 },
  W: { type: 'wood', amount: 25 },
  S: { type: 'stone', amount: 20 },
};
const TERRAIN_OF: Record<string, TerrainId> = {
  F: 'field',
  T: 'forest',
  M: 'mountain',
  R: 'river',
  D: 'road',
  B: 'bridge',
  V: 'village',
  C: 'city',
  G: 'resource',
  O: 'resource',
  W: 'resource',
  S: 'resource',
};

function scenarioMap(): MapData {
  const cells: MapCell[] = [];
  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const glyph = ROWS[row]![col]!;
      const terrain = TERRAIN_OF[glyph]!;
      const node = NODE_OF[glyph];
      cells.push(
        node === undefined
          ? { col, row, terrain }
          : { col, row, terrain, resource: { type: node.type, amount: node.amount } },
      );
    }
  }
  return {
    schemaVersion: 1,
    id: 'mockup-vale' as MapData['id'],
    width: 8,
    height: 6,
    stagger: 'odd',
    cells,
    spawns: [
      { playerIndex: 0, col: 1, row: 2 },
      { playerIndex: 1, col: 6, row: 3 },
    ],
  };
}

function scenarioBuildings(): BuildingsConfig {
  return {
    'town-center': { cost: {}, buildTime: 0 },
    house: { cost: { wood: 5 }, buildTime: 2 },
    storage: { cost: { wood: 8 }, buildTime: 2 },
    barracks: { cost: { wood: 20, stone: 10 }, buildTime: 4 },
    wall: { cost: { stone: 5 }, buildTime: 2 },
    tower: { cost: { wood: 2, stone: 1 }, buildTime: 3 },
    caps: { base: 100, perStorage: 50 },
  };
}

function scenarioEconomy(): EconomyConfig {
  return { ...DEFAULT_ECONOMY_CONFIG, gold: { value: 5, gatherYield: 3 } };
}

/** Scenario fixture (NOT engine default): stats matching placed HP. */
function scenarioUnitStats(): UnitsConfig {
  return {
    worker: { cost: { food: 10 }, maxHp: 5, damage: 1 },
    warrior: { cost: { food: 20, gold: 5 }, maxHp: 12, damage: 4 },
    archer: { cost: { wood: 15, gold: 10 }, maxHp: 8, damage: 3 },
  };
}

function scenarioUnits(): UnitsData {
  return {
    schemaVersion: 1,
    nextId: 6,
    units: [
      { id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 2, row: 2 },
      // M022 L-32: the scripted gather at (3,2) needs a worker on the node.
      { id: 'u5', owner: 'p1', type: 'worker', hp: 5, col: 3, row: 2 },
      { id: 'u1', owner: 'p1', type: 'warrior', hp: 12, col: 3, row: 3 },
      { id: 'u2', owner: 'p1', type: 'archer', hp: 8, col: 1, row: 1 },
      { id: 'u3', owner: 'p2', type: 'worker', hp: 5, col: 6, row: 3 },
      { id: 'u4', owner: 'p2', type: 'warrior', hp: 12, col: 5, row: 2 },
    ],
  };
}

function main(): void {
  const match = new Match({
    seed: 7,
    ruleset: STANDARD_RULESET,
    players: [P1, P2],
    initialState: createWorldState({
      players: [P1, P2],
      map: scenarioMap(),
      stockpiles: {
        schemaVersion: 1,
        stockpiles: {
          p1: { food: 60, wood: 45, stone: 30, gold: 25 },
          p2: { food: 40, wood: 30, stone: 20, gold: 15 },
        },
      },
      buildings: {
        schemaVersion: 1,
        buildings: {
          p1: { 'town-center': 1, house: 2, storage: 1, barracks: 0, wall: 0, tower: 0 },
          p2: { 'town-center': 1, house: 1, storage: 0, barracks: 0, wall: 0, tower: 0 },
        },
      },
      cities: {
        schemaVersion: 1,
        cities: {
          p1: { level: 2, queue: [{ type: 'house', remaining: 2 }] },
          p2: { level: 1, queue: [] },
        },
      },
      units: scenarioUnits(),
    }),
    economyConfig: scenarioEconomy(),
    buildingsConfig: scenarioBuildings(),
  });

  const snapshots = [match.getSnapshot()];
  const outcomes = [];
  const s1 = match.join(P1);
  const script: Array<[string, string, unknown]> = [
    ['r1', 'economy.gather', { col: 3, row: 2 }],
    ['r2', 'city.build', { type: 'house' }],
    ['r3', 'match.advance', {}],
    ['r4', 'city.build', { type: 'tower' }],
    ['r5', 'match.advance', {}],
  ];
  for (const [rid, type, payload] of script) {
    outcomes.push(match.dispatch(s1, raw({ requestId: rid, playerId: 'p1', type, payload })));
    snapshots.push(match.getSnapshot());
  }

  const final = match.getSnapshot();
  const p1Units = (final.units?.units ?? []).filter((u) => u.owner === 'p1');
  const visibility = computeVisibility(
    final.map!,
    p1Units.map((u) => ({ viewer: P1, col: u.col, row: u.row, range: 2 })),
  );
  const explored = markExplored({ schemaVersion: 1, viewers: {} }, visibility);
  const perception = perceive(final, P1, { p1: visibility['p1'] ?? [] });

  const out = {
    meta: {
      kind: 'mockup-scenario',
      seed: 7,
      ruleset: { id: 'standard', version: 1 },
      generatedBy: 'mockups/generate-state.ts (real engine dispatches)',
      note: 'All snapshots/events/perception below are genuine engine outputs. Page chrome, art and layout are placeholder mockups.',
    },
    configs: {
      buildings: scenarioBuildings(),
      economy: scenarioEconomy(),
      unitsDefault: DEFAULT_UNITS_CONFIG,
      unitsScenario: scenarioUnitStats(),
    },
    snapshots,
    outcomes,
    events: match.getEvents(),
    timeline: match.getTimeline(),
    visibility,
    explored,
    perception,
  };
  writeFileSync(new URL('./state.json', import.meta.url), JSON.stringify(out, null, 1));
  console.log(
    `scenario ok: ${snapshots.length} snapshots, ${out.events.length} events, tick=${final.tick}`,
  );
}

main();
