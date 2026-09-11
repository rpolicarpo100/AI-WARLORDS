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
import type { MapData } from '../src/engine/map.js';
import type { UnitsData } from '../src/engine/units.js';
import { loadTiledMap } from '../tools/tiled-map.js';
import { DEFAULT_UNITS_CONFIG, type UnitsConfig } from '../src/engine/warfare.js';
import { createWorldState } from '../src/engine/world-state.js';
import { perceive } from '../src/engine/views.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

function raw(value: unknown): Untrusted<ClientRequest> {
  return markUntrusted(value as ClientRequest);
}

// Scenario map + units come from the Tiled source of truth (assets/vale.tmj).
// Edit the map in Tiled, re-run this script, done. Strictly validated.
const TILED_URL = new URL('../assets/vale.tmj', import.meta.url);

function scenarioMap(): MapData {
  return loadTiledMap(TILED_URL).map;
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
  return {
    ...DEFAULT_ECONOMY_CONFIG,
    wood: { value: 1, gatherYield: 2 },
    gold: { value: 5, gatherYield: 3 },
  };
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
  return loadTiledMap(TILED_URL).units;
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
    unitsConfig: scenarioUnitStats(),
    // Scenario fixture: the 16-keyframe chronicle spends 14 p1 prompts.
    promptsPerPlayer: 20,
  });

  const snapshots = [match.getSnapshot()];
  const outcomes = [];
  const s1 = match.join(P1);
  const s2 = match.join(P2);
  const sessions = { p1: s1, p2: s2 };
  // Animated-chronicle script (all dispatches must stay engine-legal).
  const script: Array<[string, 'p1' | 'p2', string, unknown]> = [
    ['r1', 'p1', 'economy.gather', { col: 3, row: 2 }],
    ['r2', 'p1', 'unit.move', { id: 'u0', col: 3, row: 2 }],
    ['r3', 'p1', 'unit.move', { id: 'u0', col: 4, row: 2 }],
    ['r4', 'p1', 'economy.gather', { col: 4, row: 2 }],
    ['r5', 'p1', 'city.build', { type: 'house' }],
    ['r6', 'p1', 'world.noop', {}],
    ['r7', 'p1', 'unit.move', { id: 'u1', col: 4, row: 3 }],
    ['r8', 'p1', 'city.build', { type: 'tower' }],
    ['r9', 'p1', 'world.noop', {}],
    ['r10', 'p2', 'unit.move', { id: 'u3', col: 7, row: 3 }],
    ['r11', 'p1', 'unit.move', { id: 'u2', col: 2, row: 1 }],
    ['r12', 'p1', 'world.noop', {}],
    ['r13', 'p1', 'city.upgrade', {}],
    ['r14', 'p1', 'world.noop', {}],
    ['r15', 'p1', 'economy.gather', { col: 3, row: 2 }],
  ];
  for (const [rid, who, type, payload] of script) {
    outcomes.push(
      match.dispatch(sessions[who], raw({ requestId: rid, playerId: who, type, payload })),
    );
    snapshots.push(match.getSnapshot());
  }
  for (const [index, outcome] of outcomes.entries()) {
    if (outcome.status !== 'applied') {
      throw new Error(`scenario script broke at r${index + 1}: ${JSON.stringify(outcome)}`);
    }
  }

  // Real fog + memory per keyframe (units roam, so sight changes genuinely).
  const visibilityBySnap: number[][] = [];
  const exploredBySnap: number[][] = [];
  let memory = { schemaVersion: 1 as const, viewers: {} as Record<string, number[]> };
  for (const snap of snapshots) {
    const seen = computeVisibility(
      snap.map!,
      (snap.units?.units ?? [])
        .filter((u) => u.owner === 'p1')
        .map((u) => ({ viewer: P1, col: u.col, row: u.row, range: 2 })),
    );
    memory = markExplored(memory, seen) as typeof memory;
    visibilityBySnap.push([...(seen['p1'] ?? [])]);
    exploredBySnap.push([...(memory.viewers['p1'] ?? [])]);
  }

  const final = match.getSnapshot();
  const visibility = { p1: visibilityBySnap[visibilityBySnap.length - 1]! };
  const explored = {
    schemaVersion: 1,
    viewers: { p1: exploredBySnap[exploredBySnap.length - 1]! },
  };
  const perception = perceive(final, P1, { p1: visibility.p1 });

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
    visibilityBySnap,
    exploredBySnap,
    perception,
  };
  writeFileSync(new URL('./state.json', import.meta.url), JSON.stringify(out, null, 1));
  console.log(
    `scenario ok: ${snapshots.length} snapshots, ${out.events.length} events, prompts=${JSON.stringify(final.prompts?.remaining)}`,
  );
}

main();
