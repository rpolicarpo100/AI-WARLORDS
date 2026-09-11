/**
 * AI playtesting harness (Vitric-style QA + Python-style balance analysis).
 * Boots real deterministic Matches from the Tiled scenario, plays bot games
 * with heuristic candidate dispatches, and asserts engine invariants after
 * every applied dispatch. Legality oracle = the genuine engine outcome.
 * Outputs sim/report.json + sim/balance.csv (pandas-ready).
 * Run: npm run sim  (or: npx tsx sim/playtest.ts [games] [steps])
 */
import { writeFileSync } from 'node:fs';
import { markUntrusted, type PlayerId, type Untrusted, type ClientRequest } from '../src/engine/authority.js';
import { computeVisibility } from '../src/engine/fog.js';
import { markExplored } from '../src/engine/exploration.js';
import { Match, STANDARD_RULESET } from '../src/engine/match.js';
import { createWorldState } from '../src/engine/world-state.js';
import { maxHpOf, type UnitsConfig } from '../src/engine/warfare.js';
import { loadTiledMap } from '../tools/tiled-map.js';

const TILED_URL = new URL('../assets/vale.tmj', import.meta.url);
const GAMES = Number(process.argv[2] ?? 20);
const STEPS = Number(process.argv[3] ?? 60);

/**
 * Drill fixture: battle-worthy stats so bots train at cost, wound, and kill.
 * maxHp matches the authored vale.tmj roster (5/12/8); costs/damage reuse the
 * engine-test-proven numbers. Real tuning belongs to #92 — these are drill
 * values, not balance. (M026)
 */
const DRILL_UNITS: UnitsConfig = {
  worker: { cost: { food: 10 }, maxHp: 5, damage: 1 },
  warrior: { cost: { food: 20, gold: 5 }, maxHp: 12, damage: 4 },
  archer: { cost: { wood: 15, gold: 10 }, maxHp: 8, damage: 3 },
};

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

// Odd-q offset neighbours (pointy-top). If the engine disagrees on an edge
// case the dispatch is simply rejected and counted — never forced.
function neighbours(col: number, row: number): Array<[number, number]> {
  const odd = (row & 1) === 1;
  const d: Array<[number, number]> =
    row % 2 === 0
      ? [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]]
      : [[1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1]];
  void odd;
  return d
    .map(([dc, dr]) => [col + dc, row + dr] as [number, number])
    .filter(([c, r]) => c >= 0 && c < 8 && r >= 0 && r < 6);
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
  kills: number;
  damageDealt: number;
  trained: number;
  ticks: number;
  finalPiles: Record<string, Record<string, number>>;
  finalBuildings: Record<string, Record<string, number>>;
  explored: number;
}

function scenarioFor(seed: number): Match {
  const tiled = loadTiledMap(TILED_URL);
  return new Match({
    seed,
    ruleset: STANDARD_RULESET,
    players: ['p1' as PlayerId, 'p2' as PlayerId],
    initialState: createWorldState({
      players: ['p1' as PlayerId, 'p2' as PlayerId],
      map: tiled.map,
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
      units: tiled.units,
    }),
    unitsConfig: DRILL_UNITS,
  });
}

function candidates(
  snap: ReturnType<Match['getSnapshot']>,
  who: PlayerId,
  rnd: () => number,
): Candidate[] {
  const out: Candidate[] = [];
  const units = (snap.units?.units ?? []).filter((u) => u.owner === who);
  const cells = snap.map?.cells ?? [];
  const nodeAt = new Map<number, { col: number; row: number }>();
  for (const c of cells) if (c.resource) nodeAt.set(c.row * 8 + c.col, c);
  for (const u of units) {
    // Gather where we stand (legal iff a node is here — engine decides).
    out.push({ type: 'economy.gather', payload: { col: u.col, row: u.row } });
    // March to a random neighbouring cell.
    const nbs = neighbours(u.col, u.row);
    if (nbs.length > 0) {
      const [col, row] = nbs[Math.floor(rnd() * nbs.length)]!;
      out.push({ type: 'unit.move', payload: { id: u.id, col, row } });
    }
    // Strike adjacent foes (engine decides legality — adjacency oracle).
    const foes = (snap.units?.units ?? []).filter((f) => f.owner !== who);
    for (const [col, row] of neighbours(u.col, u.row)) {
      const foe = foes.find((f) => f.col === col && f.row === row);
      if (foe !== undefined) {
        out.push({ type: 'unit.attack', payload: { id: u.id, target: foe.id } });
      }
    }
  }
  for (const b of ['house', 'tower', 'storage', 'barracks', 'wall']) {
    out.push({ type: 'city.build', payload: { type: b } });
  }
  // Muster recruits anywhere lawful (funds decide — engine oracle).
  for (const t of ['worker', 'warrior', 'archer'] as const) {
    const cell = cells[Math.floor(rnd() * cells.length)];
    if (cell !== undefined) {
      out.push({ type: 'unit.train', payload: { type: t, col: cell.col, row: cell.row } });
    }
  }
  out.push({ type: 'city.upgrade', payload: {} });
  out.push({ type: 'match.advance', payload: {} });
  // Shuffle so the bot policy varies per game/step.
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function checkInvariants(
  snap: ReturnType<Match['getSnapshot']>,
  prev: { explored: number; events: number; tick: number; nextId: number },
  violations: string[],
  where: string,
): { explored: number; events: number; tick: number; nextId: number } {
  const piles = snap.stockpiles?.stockpiles as Record<string, Record<string, number>> | undefined;
  for (const [pid, pile] of Object.entries(piles ?? {})) {
    for (const [res, v] of Object.entries(pile)) {
      if (!Number.isFinite(v) || v < 0) violations.push(`${where}: negative pile ${pid}.${res}=${v}`);
    }
  }
  const seenIds = new Set<string>();
  const nextId = snap.units?.nextId ?? 0;
  for (const u of snap.units?.units ?? []) {
    if (u.hp < 1) violations.push(`${where}: unit ${u.id} hp=${u.hp}`);
    if (u.col < 0 || u.col > 7 || u.row < 0 || u.row > 5) {
      violations.push(`${where}: unit ${u.id} out of bounds (${u.col},${u.row})`);
    }
    if (seenIds.has(u.id)) violations.push(`${where}: duplicate unit id ${u.id}`);
    seenIds.add(u.id);
    const cap = maxHpOf(DRILL_UNITS, u.type);
    if (u.hp > cap) violations.push(`${where}: unit ${u.id} hp=${u.hp} exceeds maxHp=${cap}`);
    const seq = Number(u.id.slice(1));
    if (!Number.isInteger(seq) || seq < 0 || seq >= nextId) {
      violations.push(`${where}: unit id ${u.id} outside nextId=${nextId}`);
    }
  }
  if (nextId < prev.nextId) {
    violations.push(`${where}: nextId went backwards ${prev.nextId}->${nextId}`);
  }
  const explored = (snap as unknown as { exploredCount?: number }).exploredCount;
  void explored;
  const tick = snap.tick ?? 0;
  if (tick < prev.tick) violations.push(`${where}: tick went backwards ${prev.tick}->${tick}`);
  // Snapshot must survive a JSON round-trip (persistence safety).
  JSON.parse(JSON.stringify(snap));
  return { explored: prev.explored, events: prev.events, tick, nextId };
}

function playGame(seed: number): { stats: GameStats; violations: string[]; csv: string[] } {
  const rnd = mulberry(seed);
  const match = scenarioFor(seed);
  const s1 = match.join('p1' as PlayerId);
  const s2 = match.join('p2' as PlayerId);
  const sessions = { p1: s1, p2: s2 };
  const violations: string[] = [];
  const csv: string[] = [];
  let applied = 0;
  let rejected = 0;
  const byType: Record<string, number> = {};
  let memory = { schemaVersion: 1 as const, viewers: {} as Record<string, number[]> };
  let guard = { explored: 0, events: 0, tick: 0, nextId: 0 };
  let rid = 0;
  const sides: PlayerId[] = ['p1' as PlayerId, 'p2' as PlayerId];
  for (let step = 0; step < STEPS; step += 1) {
    const who = sides[step % 2]!;
    const snap = match.getSnapshot();
    let done = false;
    for (const c of candidates(snap, who, rnd)) {
      rid += 1;
      const req = markUntrusted({ requestId: `g${seed}s${rid}`, playerId: who, type: c.type, payload: c.payload } as ClientRequest) as Untrusted<ClientRequest>;
      const outcome = match.dispatch(sessions[who], req);
      if (outcome.status === 'applied') {
        applied += 1;
        byType[c.type] = (byType[c.type] ?? 0) + 1;
        done = true;
        break;
      }
      rejected += 1;
    }
    if (!done) violations.push(`game ${seed} step ${step}: no legal candidate for ${who}`);
    const after = match.getSnapshot();
    guard = checkInvariants(after, guard, violations, `game ${seed} step ${step}`);
    const seen = computeVisibility(after.map!, (after.units?.units ?? []).filter((u) => u.owner === 'p1').map((u) => ({ viewer: 'p1' as PlayerId, col: u.col, row: u.row, range: 2 })));
    memory = markExplored(memory, seen) as typeof memory;
    const p1 = (after.stockpiles?.stockpiles as Record<string, Record<string, number>> | undefined)?.['p1'];
    if (p1 && step % 10 === 0) {
      csv.push(`${seed},${after.tick ?? 0},${p1['food'] ?? 0},${p1['wood'] ?? 0},${p1['stone'] ?? 0},${p1['gold'] ?? 0}`);
    }
  }
  const fin = match.getSnapshot();
  const piles = (fin.stockpiles?.stockpiles ?? {}) as Record<string, Record<string, number>>;
  const buildings = ((fin.buildings as unknown as { buildings: Record<string, Record<string, number>> })?.buildings ?? {}) as Record<string, Record<string, number>>;
  let kills = 0;
  let damageDealt = 0;
  let trained = 0;
  for (const e of match.getEvents()) {
    if (e.type === 'unit.slain') kills += 1;
    else if (e.type === 'unit.trained') trained += 1;
    else if (e.type === 'unit.attacked') {
      const dmg = (e.payload as { damage?: unknown }).damage;
      if (typeof dmg === 'number') damageDealt += dmg;
    }
  }
  return {
    stats: {
      seed,
      applied,
      rejected,
      appliedByType: byType,
      kills,
      damageDealt,
      trained,
      ticks: fin.tick ?? 0,
      finalPiles: piles,
      finalBuildings: buildings,
      explored: memory.viewers['p1']?.length ?? 0,
    },
    violations,
    csv,
  };
}

function main(): void {
  const t0 = Date.now();
  const games: GameStats[] = [];
  const violations: string[] = [];
  const csv = ['game,tick,p1_food,p1_wood,p1_stone,p1_gold'];
  for (let g = 0; g < GAMES; g += 1) {
    const seed = 1000 + g;
    const { stats, violations: v, csv: rows } = playGame(seed);
    games.push(stats);
    violations.push(...v);
    csv.push(...rows);
  }
  const applied = games.reduce((a, g) => a + g.applied, 0);
  const rejected = games.reduce((a, g) => a + g.rejected, 0);
  const kills = games.reduce((a, g) => a + g.kills, 0);
  const damageDealt = games.reduce((a, g) => a + g.damageDealt, 0);
  const trained = games.reduce((a, g) => a + g.trained, 0);
  const appliedByType: Record<string, number> = {};
  for (const g of games) {
    for (const [t, n] of Object.entries(g.appliedByType)) {
      appliedByType[t] = (appliedByType[t] ?? 0) + n;
    }
  }
  const avgTick = games.reduce((a, g) => a + g.ticks, 0) / Math.max(1, games.length);
  const avg = (pick: (g: GameStats) => number): number =>
    games.reduce((a, g) => a + pick(g), 0) / Math.max(1, games.length);
  const report = {
    meta: {
      kind: 'ai-playtest-report',
      games: GAMES,
      stepsPerGame: STEPS,
      seeds: games.map((g) => g.seed),
      ms: Date.now() - t0,
      note: 'Bots play heuristic candidates; legality comes from genuine engine outcomes. Deterministic per seed.',
    },
    totals: { applied, rejected, violations: violations.length, kills, damageDealt, trained, appliedByType },
    balance: {
      avgTicks: avgTick,
      avgFinalP1: {
        food: avg((g) => g.finalPiles['p1']?.['food'] ?? 0),
        wood: avg((g) => g.finalPiles['p1']?.['wood'] ?? 0),
        stone: avg((g) => g.finalPiles['p1']?.['stone'] ?? 0),
        gold: avg((g) => g.finalPiles['p1']?.['gold'] ?? 0),
      },
      avgFinalP1Buildings: {
        house: avg((g) => g.finalBuildings['p1']?.['house'] ?? 0),
        tower: avg((g) => g.finalBuildings['p1']?.['tower'] ?? 0),
        storage: avg((g) => g.finalBuildings['p1']?.['storage'] ?? 0),
        barracks: avg((g) => g.finalBuildings['p1']?.['barracks'] ?? 0),
      },
      avgKills: avg((g) => g.kills),
      avgDamageDealt: avg((g) => g.damageDealt),
      avgTrained: avg((g) => g.trained),
    },
    violations: violations.slice(0, 50),
    games,
  };
  writeFileSync(new URL('./report.json', import.meta.url), JSON.stringify(report, null, 1));
  writeFileSync(new URL('./balance.csv', import.meta.url), csv.join('\n') + '\n');
  console.log(
    `playtest ok: ${GAMES} games x ${STEPS} steps, applied=${applied} rejected=${rejected} ` +
      `violations=${violations.length} avgTicks=${avgTick.toFixed(1)} (${Date.now() - t0}ms)`,
  );
  if (violations.length > 0) {
    console.error(violations.slice(0, 10).join('\n'));
    process.exitCode = 1;
  }
}

main();
