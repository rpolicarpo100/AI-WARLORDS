/**
 * M045 — Orders drill: the M043–M045 order stack living through real
 * deterministic Matches. Bots issue/cancel/execute/commission/noop; the
 * engine outcome is the legality oracle. After every applied dispatch the
 * harness asserts the 7 queue-coherence invariants against the LIVE
 * snapshot. Outputs sim/orders-report.json (deterministic except `ms`).
 * Run: npm run sim:orders  (or: npx tsx sim/orders-drill.ts [games] [steps])
 */
import { writeFileSync } from 'node:fs';
import {
  markUntrusted,
  type ClientRequest,
  type PlayerId,
  type Untrusted,
} from '../src/engine/authority.js';
import type { CommanderRecord } from '../src/engine/commanders.js';
import { neighborsOf } from '../src/engine/map.js';
import { Match, STANDARD_RULESET } from '../src/engine/match.js';
import { isOrderParams, ORDER_IDS, type OrderKind } from '../src/engine/orders.js';
import type { UnitsConfig } from '../src/engine/warfare.js';
import { createWorldState } from '../src/engine/world-state.js';

const GAMES = Number(process.argv[2] ?? 20);
const STEPS = Number(process.argv[3] ?? 60);

/** Drill stats (the Match runs on these; assertions use live snapshots). */
const DRILL_UNITS: UnitsConfig = {
  worker: { cost: { food: 10 }, maxHp: 5, damage: 1 },
  warrior: { cost: { food: 20, gold: 5 }, maxHp: 12, damage: 4 },
  archer: { cost: { wood: 15, gold: 10 }, maxHp: 8, damage: 3 },
};

const ORDERABLES: readonly OrderKind[] = ORDER_IDS;

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

interface Candidate {
  type: string;
  payload: unknown;
}

interface GameStats {
  seed: number;
  applied: number;
  rejected: number;
  appliedByType: Record<string, number>;
  issued: number;
  executed: number;
  canceled: number;
}

type Snapshot = ReturnType<Match['getSnapshot']>;

function scenarioFor(seed: number): Match {
  const cells = [
    { col: 0, row: 0, terrain: 'resource', resource: { type: 'gold', amount: 40 } },
    { col: 1, row: 0, terrain: 'field' },
    { col: 2, row: 0, terrain: 'field' },
    { col: 0, row: 1, terrain: 'field' },
    { col: 1, row: 1, terrain: 'field' },
    { col: 2, row: 1, terrain: 'field' },
    { col: 0, row: 2, terrain: 'field' },
    { col: 1, row: 2, terrain: 'field' },
    { col: 2, row: 2, terrain: 'field' },
  ] as const;
  const foeSpots = neighborsOf(
    {
      schemaVersion: 1,
      id: 'drill-orders',
      width: 3,
      height: 3,
      stagger: 'odd',
      cells: [...cells],
      spawns: [],
    },
    1,
    0,
  );
  const foe = foeSpots.find((cell) => !(cell.col === 0 && cell.row === 0)) ?? foeSpots[0]!;
  return new Match({
    seed,
    ruleset: STANDARD_RULESET,
    players: ['p1' as PlayerId, 'p2' as PlayerId],
    initialState: createWorldState({
      players: ['p1' as PlayerId, 'p2' as PlayerId],
      map: {
        schemaVersion: 1,
        id: 'drill-orders',
        width: 3,
        height: 3,
        stagger: 'odd',
        cells: [...cells],
        spawns: [],
      },
      units: {
        schemaVersion: 1,
        nextId: 3,
        units: [
          { id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 },
          { id: 'u1', owner: 'p1', type: 'warrior', hp: 12, col: 1, row: 0 },
          { id: 'u2', owner: 'p2', type: 'archer', hp: 8, col: foe.col, row: foe.row },
        ],
      },
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
      commanders: {
        schemaVersion: 1,
        nextId: 2,
        commanders: [
          {
            id: 'c0',
            owner: 'p1',
            active: true,
            personality: 'strategist',
            doctrine: 'turtle',
          },
          { id: 'c1', owner: 'p2', active: true, personality: 'conqueror', doctrine: 'blitz' },
        ],
      },
    }),
    unitsConfig: DRILL_UNITS,
    promptsPerPlayer: 200,
  });
}

function pick<T>(items: ReadonlyArray<T>, rnd: () => number): T {
  return items[Math.floor(rnd() * items.length)]!;
}

function randomCell(snap: Snapshot, rnd: () => number): { col: number; row: number } {
  const map = snap.map;
  const width = map?.width ?? 3;
  const height = map?.height ?? 3;
  return { col: Math.floor(rnd() * width), row: Math.floor(rnd() * height) };
}

function candidates(snap: Snapshot, who: PlayerId, rnd: () => number): Candidate[] {
  const out: Candidate[] = [];
  const own = (snap.commanders?.commanders ?? []).filter((r) => r.owner === who);
  const ownUnits = (snap.units?.units ?? []).filter((u) => u.owner === who);
  const foes = (snap.units?.units ?? []).filter((u) => u.owner !== who);
  const target = own.length === 0 ? 'c0' : pick(own, rnd)!.id;
  // Issue variants across all five verbs (engine oracle judges).
  const cell = randomCell(snap, rnd);
  out.push({
    type: 'order.issue',
    payload: { id: target, kind: 'city.build', params: { type: 'house' } },
  });
  out.push({ type: 'order.issue', payload: { id: target, kind: 'economy.gather', params: cell } });
  if (ownUnits.length > 0 && foes.length > 0) {
    out.push({
      type: 'order.issue',
      payload: {
        id: target,
        kind: 'unit.attack',
        params: { id: pick(ownUnits, rnd)!.id, target: pick(foes, rnd)!.id },
      },
    });
  }
  if (ownUnits.length > 0) {
    out.push({
      type: 'order.issue',
      payload: { id: target, kind: 'unit.move', params: { id: pick(ownUnits, rnd)!.id, ...cell } },
    });
  }
  out.push({
    type: 'order.issue',
    payload: { id: target, kind: 'unit.train', params: { type: 'warrior', ...cell } },
  });
  out.push({ type: 'order.execute', payload: { id: target } });
  out.push({ type: 'order.cancel', payload: { id: target } });
  out.push({ type: 'commander.commission', payload: {} });
  out.push({ type: 'world.noop', payload: {} });
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function queuesOf(snap: Snapshot): Map<string, string> {
  const map = new Map<string, string>();
  for (const record of snap.commanders?.commanders ?? []) {
    map.set(record.id, JSON.stringify(record.orders ?? []));
  }
  return map;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkInvariants(
  match: Match,
  before: Snapshot,
  beforeEvents: number,
  beforeQueues: Map<string, string>,
  appliedType: string,
  payload: unknown,
  violations: string[],
  where: string,
): void {
  const snap = match.getSnapshot();
  const records: ReadonlyArray<CommanderRecord> = snap.commanders?.commanders ?? [];
  // 1. Queue cap holds everywhere (8, canonical bound).
  for (const record of records) {
    const length = record.orders?.length ?? 0;
    if (length > 8) {
      violations.push(`${where}: ${record.id} queue length ${length} exceeds cap`);
    }
  }
  // 2. Every queued kind is orderable (canonical vocabulary).
  for (const record of records) {
    for (const order of record.orders ?? []) {
      if (!(ORDERABLES as readonly string[]).includes(order.kind)) {
        violations.push(`${where}: ${record.id} non-orderable kind ${order.kind}`);
      }
    }
  }
  // 3. Every queued params object passes the canonical envelope.
  for (const record of records) {
    for (const order of record.orders ?? []) {
      if (order.params !== undefined && !isOrderParams(order.params)) {
        violations.push(`${where}: ${record.id} envelope-invalid params`);
      }
    }
  }
  // 4. Exact per-type DOMAIN fact deltas (riders excluded — M030 owns them).
  const RIDERS = new Set(['cell.discovered', 'unit.spotted', 'build.completed']);
  const fresh = match.getEvents().slice(beforeEvents);
  const domain = fresh.filter((e) => !RIDERS.has(e.type));
  const count = (type: string): number => domain.filter((e) => e.type === type).length;
  if (appliedType === 'order.execute') {
    if (count('order.executed') !== 1) {
      violations.push(`${where}: execute emitted ${count('order.executed')} executed facts`);
    }
  } else {
    const want: Record<string, [string, number]> = {
      'order.issue': ['order.issued', 1],
      'order.cancel': ['order.canceled', 1],
      'commander.commission': ['commander.commissioned', 1],
      'world.noop': ['', 0],
    };
    const spec = want[appliedType];
    if (spec === undefined || domain.length !== spec[1]) {
      violations.push(`${where}: ${appliedType} emitted ${domain.length} domain events`);
    } else if (spec[0] !== '' && count(spec[0]) !== 1) {
      violations.push(`${where}: ${appliedType} without its ${spec[0]} fact`);
    }
  }
  // 5. Execute pops exactly its pre-head (kind Acked, tail preserved).
  const target = isRecord(payload) && typeof payload['id'] === 'string' ? payload['id'] : undefined;
  if (appliedType === 'order.execute' && target !== undefined) {
    const preHead = (before.commanders?.commanders.find((r) => r.id === target)?.orders ?? [])[0];
    const executed = fresh.find((e) => e.type === 'order.executed');
    const acked = isRecord(executed?.payload) ? executed?.payload['kind'] : undefined;
    if (preHead === undefined || acked !== preHead.kind) {
      violations.push(`${where}: executed kind ${String(acked)} != pre-head`);
    }
    const preQueue: unknown[] = JSON.parse(beforeQueues.get(target) ?? '[]');
    const wantTail = JSON.stringify(preQueue.slice(1));
    const gotTail = JSON.stringify(
      snap.commanders?.commanders.find((r) => r.id === target)?.orders ?? [],
    );
    if (wantTail !== gotTail) {
      violations.push(`${where}: ${target} tail not preserved`);
    }
  }
  // 6. Non-target queues are byte-identical across the dispatch.
  const afterQueues = queuesOf(snap);
  for (const [id, beforeJson] of beforeQueues) {
    if (id !== target && afterQueues.get(id) !== beforeJson) {
      violations.push(`${where}: bystander queue ${id} mutated`);
    }
  }
  // Commission births exactly one record; noop changes no queues.
  if (appliedType === 'commander.commission' && afterQueues.size !== beforeQueues.size + 1) {
    violations.push(`${where}: commission queue-count drift`);
  }
  if (appliedType === 'world.noop') {
    for (const [id, beforeJson] of beforeQueues) {
      if (afterQueues.get(id) !== beforeJson) {
        violations.push(`${where}: noop mutated queue ${id}`);
      }
    }
  }
  // 7. Zero producer faults + JSON persistence safety.
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
  const violations: string[] = [];
  let applied = 0;
  let rejected = 0;
  const byType: Record<string, number> = {};
  let issued = 0;
  let executed = 0;
  let canceled = 0;
  let rid = 0;
  const sides: PlayerId[] = ['p1' as PlayerId, 'p2' as PlayerId];
  for (let step = 0; step < STEPS; step += 1) {
    const who = sides[step % 2]!;
    const snap = match.getSnapshot();
    const beforeEvents = match.getEvents().length;
    const beforeQueues = queuesOf(snap);
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
        if (c.type === 'order.issue') issued += 1;
        if (c.type === 'order.execute') executed += 1;
        if (c.type === 'order.cancel') canceled += 1;
        done = c;
        break;
      }
      rejected += 1;
    }
    if (done === undefined)
      violations.push(`game ${seed} step ${step}: no legal candidate for ${who}`);
    checkInvariants(
      match,
      snap,
      beforeEvents,
      beforeQueues,
      done?.type ?? '',
      done?.payload,
      violations,
      `game ${seed} step ${step}`,
    );
  }
  return {
    stats: { seed, applied, rejected, appliedByType: byType, issued, executed, canceled },
    violations,
  };
}

function main(): void {
  const t0 = Date.now();
  const games: GameStats[] = [];
  const violations: string[] = [];
  for (let g = 0; g < GAMES; g += 1) {
    const seed = 2000 + g;
    const { stats, violations: v } = playGame(seed);
    games.push(stats);
    violations.push(...v);
  }
  const applied = games.reduce((a, g) => a + g.applied, 0);
  const rejected = games.reduce((a, g) => a + g.rejected, 0);
  const issued = games.reduce((a, g) => a + g.issued, 0);
  const executed = games.reduce((a, g) => a + g.executed, 0);
  const canceled = games.reduce((a, g) => a + g.canceled, 0);
  const appliedByType: Record<string, number> = {};
  for (const g of games) {
    for (const [t, n] of Object.entries(g.appliedByType)) {
      appliedByType[t] = (appliedByType[t] ?? 0) + n;
    }
  }
  const report = {
    meta: {
      kind: 'orders-drill',
      games: GAMES,
      stepsPerGame: STEPS,
      seeds: games.map((g) => g.seed),
      ms: Date.now() - t0,
      note: 'Order queues (issue/cancel/execute) checked against live Matches every dispatch. Deterministic per seed.',
    },
    totals: {
      applied,
      rejected,
      violations: violations.length,
      issued,
      executed,
      canceled,
      appliedByType,
    },
    violations: violations.slice(0, 50),
    games,
  };
  writeFileSync(new URL('./orders-report.json', import.meta.url), JSON.stringify(report, null, 1));
  console.log(
    `orders drill ok: ${GAMES} games x ${STEPS} steps, applied=${applied} rejected=${rejected} ` +
      `violations=${violations.length} issued=${issued} executed=${executed} canceled=${canceled} (${Date.now() - t0}ms)`,
  );
  if (violations.length > 0) {
    console.error(violations.slice(0, 10).join('\n'));
    process.exitCode = 1;
  }
}

main();
