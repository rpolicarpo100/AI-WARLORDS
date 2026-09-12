/**
 * M094 — Economy drill: the M016–M020 economy stack living through real
 * deterministic Matches under an injected PRESSURE economy (real yields,
 * costs, build times, tight caps — the DEFAULTS are trivial: yield 1,
 * cost {}, time 0, cap MAX_UINT32). Bots gather/build/upgrade/train/move/
 * noop; the engine outcome is the legality oracle. After every applied
 * dispatch the harness asserts the 7 economy invariants against the LIVE
 * snapshot. Outputs sim/economy-report.json (deterministic except `ms`).
 * Run: npm run sim:economy  (or: npx tsx sim/economy-drill.ts [games] [steps])
 */
import { writeFileSync } from 'node:fs';
import {
  markUntrusted,
  type ClientRequest,
  type PlayerId,
  type Untrusted,
} from '../src/engine/authority.js';
import { BUILDING_IDS, countsOf, isBuildingId, type BuildingId } from '../src/engine/buildings.js';
import { cityOf, type QueueItem } from '../src/engine/city.js';
import {
  buildTimeOf,
  capOf,
  costOf,
  type BuildingsConfig,
  type EconomyConfig,
} from '../src/engine/economy.js';
import { RESOURCE_TYPES, type ResourceType } from '../src/engine/map.js';
import { Match, STANDARD_RULESET } from '../src/engine/match.js';
import { stockpileOf } from '../src/engine/stockpiles.js';
import type { UnitsConfig } from '../src/engine/warfare.js';
import { createWorldState } from '../src/engine/world-state.js';

const GAMES = Number(process.argv[2] ?? 20);
const STEPS = Number(process.argv[3] ?? 60);

/** Pressure economy: yields, costs, times and caps all bite. */
const DRILL_ECONOMY: EconomyConfig = {
  food: { value: 1, gatherYield: 3 },
  wood: { value: 2, gatherYield: 2 },
  stone: { value: 3, gatherYield: 2 },
  gold: { value: 5, gatherYield: 1 },
};

const DRILL_BUILDINGS: BuildingsConfig = {
  'town-center': { cost: {}, buildTime: 1 },
  house: { cost: { food: 10 }, buildTime: 2 },
  storage: { cost: { wood: 8 }, buildTime: 2 },
  barracks: { cost: { wood: 20, stone: 10 }, buildTime: 4 },
  wall: { cost: { stone: 15 }, buildTime: 3 },
  tower: { cost: { stone: 25, gold: 10 }, buildTime: 5 },
  caps: { base: 40, perStorage: 25 },
};

/** Drill stats (the Match runs on these; assertions use live snapshots). */
const DRILL_UNITS: UnitsConfig = {
  worker: { cost: { food: 10 }, maxHp: 5, damage: 1 },
  warrior: { cost: { food: 20, gold: 5 }, maxHp: 12, damage: 4 },
  archer: { cost: { wood: 15, gold: 10 }, maxHp: 8, damage: 3 },
};

const UNIT_TYPES = ['worker', 'warrior', 'archer'] as const;

const NODES: ReadonlyArray<{ col: number; row: number; type: ResourceType }> = [
  { col: 0, row: 0, type: 'food' },
  { col: 2, row: 0, type: 'wood' },
  { col: 0, row: 2, type: 'stone' },
  { col: 2, row: 2, type: 'gold' },
];

const SIDES: readonly PlayerId[] = ['p1' as PlayerId, 'p2' as PlayerId];

/** Riders excluded from domain-fact deltas (ride every transition). */
const RIDERS = new Set(['build.completed', 'cell.discovered', 'unit.spotted', 'ai.assessment']);

interface Candidate {
  type: string;
  payload: unknown;
}

interface GameStats {
  seed: number;
  applied: number;
  rejected: number;
  appliedByType: Record<string, number>;
  gathered: number;
  spent: Record<ResourceType, number>;
  completed: number;
}

type Snapshot = ReturnType<Match['getSnapshot']>;

function scenarioFor(seed: number): Match {
  const cells = [
    { col: 0, row: 0, terrain: 'resource', resource: { type: 'food', amount: 60 } },
    { col: 1, row: 0, terrain: 'field' },
    { col: 2, row: 0, terrain: 'resource', resource: { type: 'wood', amount: 60 } },
    { col: 0, row: 1, terrain: 'field' },
    { col: 1, row: 1, terrain: 'field' },
    { col: 2, row: 1, terrain: 'field' },
    { col: 0, row: 2, terrain: 'resource', resource: { type: 'stone', amount: 60 } },
    { col: 1, row: 2, terrain: 'field' },
    { col: 2, row: 2, terrain: 'resource', resource: { type: 'gold', amount: 60 } },
  ] as const;
  return new Match({
    seed,
    ruleset: STANDARD_RULESET,
    players: [...SIDES],
    initialState: createWorldState({
      players: [...SIDES],
      map: {
        schemaVersion: 1,
        id: 'drill-economy',
        width: 3,
        height: 3,
        stagger: 'odd',
        cells: [...cells],
        spawns: [],
      },
      units: {
        schemaVersion: 1,
        nextId: 4,
        units: [
          { id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 },
          { id: 'u1', owner: 'p1', type: 'worker', hp: 5, col: 2, row: 0 },
          { id: 'u2', owner: 'p2', type: 'worker', hp: 5, col: 0, row: 2 },
          { id: 'u3', owner: 'p2', type: 'worker', hp: 5, col: 2, row: 2 },
        ],
      },
      stockpiles: {
        schemaVersion: 1,
        stockpiles: {
          p1: { food: 30, wood: 20, stone: 15, gold: 10 },
          p2: { food: 20, wood: 15, stone: 10, gold: 5 },
        },
      },
      buildings: {
        schemaVersion: 1,
        buildings: {
          p1: { 'town-center': 1, house: 0, storage: 1, barracks: 0, wall: 0, tower: 0 },
          p2: { 'town-center': 1, house: 0, storage: 0, barracks: 0, wall: 0, tower: 0 },
        },
      },
      cities: {
        schemaVersion: 1,
        cities: {
          p1: { level: 1, queue: [] },
          p2: { level: 1, queue: [] },
        },
      },
    }),
    economyConfig: DRILL_ECONOMY,
    buildingsConfig: DRILL_BUILDINGS,
    unitsConfig: DRILL_UNITS,
    promptsPerPlayer: 200,
  });
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: ReadonlyArray<T>, rnd: () => number): T {
  return items[Math.floor(rnd() * items.length)]!;
}

function randomCell(rnd: () => number): { col: number; row: number } {
  return { col: Math.floor(rnd() * 3), row: Math.floor(rnd() * 3) };
}

function candidates(snap: Snapshot, who: PlayerId, rnd: () => number): Candidate[] {
  const out: Candidate[] = [];
  const ownUnits = (snap.units?.units ?? []).filter((u) => u.owner === who);
  for (const node of NODES) {
    out.push({ type: 'economy.gather', payload: { col: node.col, row: node.row } });
  }
  out.push({ type: 'economy.gather', payload: randomCell(rnd) });
  out.push({ type: 'city.build', payload: { type: pick([...BUILDING_IDS], rnd) } });
  out.push({ type: 'city.build', payload: { type: pick([...BUILDING_IDS], rnd) } });
  out.push({ type: 'city.upgrade', payload: {} });
  out.push({
    type: 'unit.train',
    payload: { type: pick([...UNIT_TYPES], rnd), ...randomCell(rnd) },
  });
  out.push({
    type: 'unit.train',
    payload: { type: pick([...UNIT_TYPES], rnd), ...randomCell(rnd) },
  });
  if (ownUnits.length > 0) {
    out.push({
      type: 'unit.move',
      payload: { id: pick(ownUnits, rnd)!.id, ...randomCell(rnd) },
    });
    out.push({
      type: 'unit.move',
      payload: { id: pick(ownUnits, rnd)!.id, ...randomCell(rnd) },
    });
  }
  out.push({ type: 'world.noop', payload: {} });
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nodeAmount(snap: Snapshot, col: number, row: number): number | undefined {
  return snap.map?.cells.find((cell) => cell.col === col && cell.row === row)?.resource?.amount;
}

/** Owner-only post-step tick, recomputed drill-side (M041 inv.2 precedent). */
function tick(queue: ReadonlyArray<QueueItem>): { queue: QueueItem[]; completed: BuildingId[] } {
  const next: QueueItem[] = [];
  const completed: BuildingId[] = [];
  for (const item of queue) {
    const remaining = item.remaining - 1;
    if (remaining <= 0) {
      completed.push(item.type);
    } else {
      next.push({ type: item.type, remaining });
    }
  }
  return { queue: next, completed };
}

interface Ledger {
  spent: Record<ResourceType, number>;
  initial: Record<ResourceType, number>;
  gathered: number;
  completed: number;
}

function freshLedger(match: Match): Ledger {
  const snap = match.getSnapshot();
  const initial = { food: 0, wood: 0, stone: 0, gold: 0 };
  for (const holder of SIDES) {
    const pile = stockpileOf(snap.stockpiles, holder);
    for (const kind of RESOURCE_TYPES) {
      initial[kind] += pile[kind];
    }
  }
  for (const node of NODES) {
    initial[node.type] += nodeAmount(snap, node.col, node.row) ?? 0;
  }
  return {
    spent: { food: 0, wood: 0, stone: 0, gold: 0 },
    initial,
    gathered: 0,
    completed: 0,
  };
}

function checkInvariants(
  match: Match,
  before: Snapshot,
  beforeEvents: number,
  appliedType: string,
  payload: unknown,
  caller: PlayerId,
  ledger: Ledger,
  violations: string[],
  where: string,
): void {
  const snap = match.getSnapshot();
  const fields = isRecord(payload) ? payload : {};
  // 1–3. Exact flow per applied type (gather moves node→pile; build/train
  // destroy piles into queue/units — the ledger in 6 tracks the sinks).
  if (appliedType === 'economy.gather') {
    const col = fields['col'];
    const row = fields['row'];
    if (typeof col !== 'number' || typeof row !== 'number') {
      violations.push(`${where}: gather payload not a cell`);
    } else {
      const node = before.map?.cells.find((cell) => cell.col === col && cell.row === row);
      const kind = node?.resource?.type;
      if (kind === undefined) {
        violations.push(`${where}: gather on resourceless cell applied`);
      } else {
        const taken = Math.min(DRILL_ECONOMY[kind].gatherYield, node.resource?.amount ?? 0);
        ledger.gathered += taken;
        const wantNode = (node.resource?.amount ?? 0) - taken;
        if (nodeAmount(snap, col, row) !== wantNode) {
          violations.push(
            `${where}: node ${col},${row} ${nodeAmount(snap, col, row)} != ${wantNode}`,
          );
        }
        for (const holder of SIDES) {
          const was = stockpileOf(before.stockpiles, holder);
          const now = stockpileOf(snap.stockpiles, holder);
          for (const type of RESOURCE_TYPES) {
            const want = was[type] + (holder === caller && type === kind ? taken : 0);
            if (now[type] !== want) {
              violations.push(`${where}: pile ${holder}.${type} ${now[type]} != ${want}`);
            }
          }
        }
        for (const other of NODES) {
          if (other.col !== col || other.row !== row) {
            if (
              nodeAmount(snap, other.col, other.row) !== nodeAmount(before, other.col, other.row)
            ) {
              violations.push(`${where}: bystander node ${other.col},${other.row} mutated`);
            }
          }
        }
      }
    }
  }
  if (appliedType === 'city.build' || appliedType === 'unit.train') {
    const type = fields['type'];
    if (typeof type !== 'string') {
      violations.push(`${where}: ${appliedType} payload without type`);
    } else {
      const cost: Record<ResourceType, number> =
        appliedType === 'city.build'
          ? isBuildingId(type)
            ? costOf(DRILL_BUILDINGS, type)
            : { food: -1, wood: -1, stone: -1, gold: -1 }
          : {
              food: 0,
              wood: 0,
              stone: 0,
              gold: 0,
              ...(DRILL_UNITS as Record<string, { cost: Partial<Record<ResourceType, number>> }>)[
                type
              ]?.cost,
            };
      if (appliedType === 'city.build' && !isBuildingId(type)) {
        violations.push(`${where}: build of unknown type applied`);
      }
      for (const kind of RESOURCE_TYPES) {
        ledger.spent[kind] += cost[kind] ?? 0;
      }
      for (const holder of SIDES) {
        const was = stockpileOf(before.stockpiles, holder);
        const now = stockpileOf(snap.stockpiles, holder);
        for (const kind of RESOURCE_TYPES) {
          const want = was[kind] - (holder === caller ? (cost[kind] ?? 0) : 0);
          if (now[kind] !== want) {
            violations.push(`${where}: pile ${holder}.${kind} ${now[kind]} != ${want}`);
          }
        }
      }
      for (const node of NODES) {
        if (nodeAmount(snap, node.col, node.row) !== nodeAmount(before, node.col, node.row)) {
          violations.push(`${where}: ${appliedType} mutated node ${node.col},${node.row}`);
        }
      }
    }
  }
  if (appliedType === 'unit.train' && typeof fields['type'] === 'string') {
    const beforeUnits = before.units?.units ?? [];
    const afterUnits = snap.units?.units ?? [];
    const wantId = `u${before.units?.nextId ?? 0}`;
    const born = afterUnits.find((unit) => unit.id === wantId);
    const maxHp = (DRILL_UNITS as Record<string, { maxHp: number }>)[fields['type']]?.maxHp;
    if (
      afterUnits.length !== beforeUnits.length + 1 ||
      born === undefined ||
      born.owner !== caller ||
      born.type !== fields['type'] ||
      born.hp !== maxHp ||
      born.col !== fields['col'] ||
      born.row !== fields['row'] ||
      (snap.units?.nextId ?? 0) !== (before.units?.nextId ?? 0) + 1
    ) {
      violations.push(`${where}: train spawn mismatch (want ${wantId})`);
    }
  }
  if (appliedType === 'unit.move' && typeof fields['id'] === 'string') {
    const beforeUnits = before.units?.units ?? [];
    const afterUnits = snap.units?.units ?? [];
    const was = beforeUnits.find((unit) => unit.id === fields['id']);
    const now = afterUnits.find((unit) => unit.id === fields['id']);
    if (
      afterUnits.length !== beforeUnits.length ||
      was === undefined ||
      now === undefined ||
      now.col !== fields['col'] ||
      now.row !== fields['row'] ||
      now.hp !== was.hp ||
      now.type !== was.type ||
      now.owner !== was.owner
    ) {
      violations.push(`${where}: move teleport mismatch`);
    }
  }
  if (appliedType === 'city.upgrade') {
    const was = cityOf(before.cities, caller).level;
    const now = cityOf(snap.cities, caller).level;
    if (now !== was + 1 || now < 2 || now > 3) {
      violations.push(`${where}: upgrade level ${was} -> ${now}`);
    }
  }
  if (
    appliedType === 'city.upgrade' ||
    appliedType === 'unit.move' ||
    appliedType === 'world.noop'
  ) {
    for (const holder of SIDES) {
      if (
        JSON.stringify(stockpileOf(snap.stockpiles, holder)) !==
        JSON.stringify(stockpileOf(before.stockpiles, holder))
      ) {
        violations.push(`${where}: ${appliedType} touched piles`);
      }
    }
    for (const node of NODES) {
      if (nodeAmount(snap, node.col, node.row) !== nodeAmount(before, node.col, node.row)) {
        violations.push(`${where}: ${appliedType} touched node ${node.col},${node.row}`);
      }
    }
  }
  if (appliedType !== 'unit.train' && appliedType !== 'unit.move') {
    if (JSON.stringify(snap.units ?? null) !== JSON.stringify(before.units ?? null)) {
      violations.push(`${where}: ${appliedType} touched units`);
    }
  }
  // 4. Queue-tick universality: the SAME dispatch ticks the owner's queue
  // (handler appends remaining=time, post-step ticks to time−1); the
  // bystander queue is byte-identical; buildings grow by completions only.
  const appended: QueueItem[] =
    appliedType === 'city.build' &&
    typeof fields['type'] === 'string' &&
    isBuildingId(fields['type'])
      ? [{ type: fields['type'], remaining: buildTimeOf(DRILL_BUILDINGS, fields['type']) }]
      : [];
  const expected = tick([...cityOf(before.cities, caller).queue, ...appended]);
  ledger.completed += expected.completed.length;
  const gotQueue = cityOf(snap.cities, caller).queue;
  if (JSON.stringify(gotQueue) !== JSON.stringify(expected.queue)) {
    violations.push(
      `${where}: owner queue ${JSON.stringify(gotQueue)} != ${JSON.stringify(expected.queue)}`,
    );
  }
  for (const holder of SIDES) {
    if (holder !== caller) {
      if (
        JSON.stringify(cityOf(snap.cities, holder)) !==
        JSON.stringify(cityOf(before.cities, holder))
      ) {
        violations.push(`${where}: bystander city ${holder} mutated`);
      }
    }
    const was = countsOf(before.buildings, holder);
    const now = countsOf(snap.buildings, holder);
    for (const id of BUILDING_IDS) {
      const type = id as BuildingId;
      const fresh = holder === caller ? expected.completed.filter((c) => c === type).length : 0;
      if (now[type] !== was[type] + fresh) {
        violations.push(
          `${where}: buildings ${holder}.${type} ${now[type]} != ${was[type] + fresh}`,
        );
      }
    }
  }
  // 5. Caps hold for both holders under pressure (M020, double-proved).
  for (const holder of SIDES) {
    const cap = capOf(snap.buildings, holder, DRILL_BUILDINGS);
    for (const kind of RESOURCE_TYPES) {
      const pile = stockpileOf(snap.stockpiles, holder)[kind];
      if (pile > cap) {
        violations.push(`${where}: pile ${holder}.${kind} ${pile} over cap ${cap}`);
      }
    }
  }
  // 6. Conservation ledger: piles + nodes + sinks == initial, per resource.
  for (const kind of RESOURCE_TYPES) {
    let piles = 0;
    for (const holder of SIDES) {
      piles += stockpileOf(snap.stockpiles, holder)[kind];
    }
    let nodes = 0;
    for (const node of NODES) {
      if (node.type === kind) {
        nodes += nodeAmount(snap, node.col, node.row) ?? 0;
      }
    }
    const total = piles + nodes + ledger.spent[kind];
    if (total !== ledger.initial[kind]) {
      violations.push(`${where}: ledger ${kind} ${total} != ${ledger.initial[kind]}`);
    }
  }
  // 7. Exact domain fact deltas + zero faults + JSON safety (mold).
  const fresh = match.getEvents().slice(beforeEvents);
  const domain = fresh.filter((e) => !RIDERS.has(e.type));
  const count = (type: string): number => domain.filter((e) => e.type === type).length;
  const completedFacts = fresh.filter((e) => e.type === 'build.completed').length;
  if (completedFacts !== expected.completed.length) {
    violations.push(`${where}: ${completedFacts} build.completed != ${expected.completed.length}`);
  }
  const want: Record<string, [string, number]> = {
    'economy.gather': ['resource.gathered', 1],
    'city.build': ['build.started', 1],
    'unit.train': ['unit.trained', 1],
    'unit.move': ['unit.moved', 1],
    'city.upgrade': ['', 0],
    'world.noop': ['', 0],
  };
  const spec = want[appliedType];
  if (spec === undefined || domain.length !== spec[1]) {
    violations.push(`${where}: ${appliedType} emitted ${domain.length} domain events`);
  } else if (spec[0] !== '' && count(spec[0]) !== 1) {
    violations.push(`${where}: ${appliedType} without its ${spec[0]} fact`);
  }
  for (const e of match.getEvents()) {
    if (e.type === 'system.event-fault') {
      violations.push(`${where}: event-fault ${JSON.stringify(e.payload).slice(0, 120)}`);
      break;
    }
  }
  JSON.parse(JSON.stringify(snap));
}

function playGame(seed: number): { stats: GameStats; violations: string[] } {
  const rnd = mulberry(seed);
  const match = scenarioFor(seed);
  const s1 = match.join('p1' as PlayerId);
  const s2 = match.join('p2' as PlayerId);
  const sessions = { p1: s1, p2: s2 };
  const ledger = freshLedger(match);
  const violations: string[] = [];
  let applied = 0;
  let rejected = 0;
  const byType: Record<string, number> = {};
  let rid = 0;
  for (let step = 0; step < STEPS; step += 1) {
    const who = SIDES[step % 2]!;
    const snap = match.getSnapshot();
    const beforeEvents = match.getEvents().length;
    let done: Candidate | undefined;
    for (const c of candidates(snap, who, rnd)) {
      rid += 1;
      const req = markUntrusted({
        requestId: `g${seed}s${rid}`,
        playerId: who,
        type: c.type,
        payload: c.payload,
      } as ClientRequest) as Untrusted<ClientRequest>;
      const outcome = match.dispatch(sessions[who], req);
      if (outcome.status === 'applied') {
        applied += 1;
        byType[c.type] = (byType[c.type] ?? 0) + 1;
        done = c;
        break;
      }
      rejected += 1;
    }
    if (done === undefined) {
      violations.push(`game ${seed} step ${step}: no legal candidate for ${who}`);
    }
    checkInvariants(
      match,
      snap,
      beforeEvents,
      done?.type ?? '',
      done?.payload,
      who,
      ledger,
      violations,
      `game ${seed} step ${step}`,
    );
  }
  return {
    stats: {
      seed,
      applied,
      rejected,
      appliedByType: byType,
      gathered: ledger.gathered,
      spent: { ...ledger.spent },
      completed: ledger.completed,
    },
    violations,
  };
}

function main(): void {
  const t0 = Date.now();
  const games: GameStats[] = [];
  const violations: string[] = [];
  for (let g = 0; g < GAMES; g += 1) {
    const seed = 3000 + g;
    const { stats, violations: v } = playGame(seed);
    games.push(stats);
    violations.push(...v);
  }
  const applied = games.reduce((a, g) => a + g.applied, 0);
  const rejected = games.reduce((a, g) => a + g.rejected, 0);
  const gathered = games.reduce((a, g) => a + g.gathered, 0);
  const completed = games.reduce((a, g) => a + g.completed, 0);
  const spent = { food: 0, wood: 0, stone: 0, gold: 0 };
  for (const g of games) {
    for (const kind of RESOURCE_TYPES) {
      spent[kind] += g.spent[kind];
    }
  }
  const appliedByType: Record<string, number> = {};
  for (const g of games) {
    for (const [t, n] of Object.entries(g.appliedByType)) {
      appliedByType[t] = (appliedByType[t] ?? 0) + n;
    }
  }
  const report = {
    meta: {
      kind: 'economy-drill',
      games: GAMES,
      stepsPerGame: STEPS,
      seeds: games.map((g) => g.seed),
      ms: Date.now() - t0,
      note: 'Pressure economy (yields/costs/times/caps) checked against live Matches every dispatch. Deterministic per seed.',
    },
    totals: {
      applied,
      rejected,
      violations: violations.length,
      gathered,
      spent,
      completed,
      appliedByType,
    },
    violations: violations.slice(0, 50),
    games,
  };
  writeFileSync(new URL('./economy-report.json', import.meta.url), JSON.stringify(report, null, 1));
  console.log(
    `economy drill ok: ${GAMES} games x ${STEPS} steps, applied=${applied} rejected=${rejected} ` +
      `violations=${violations.length} gathered=${gathered} completed=${completed} (${Date.now() - t0}ms)`,
  );
  if (violations.length > 0) {
    console.error(violations.slice(0, 10).join('\n'));
    process.exitCode = 1;
  }
}

main();
