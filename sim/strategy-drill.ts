/**
 * M041 — Strategy drill: the M038/M040 AI wiring living through real
 * deterministic Matches. Bots commission + flip + build + upgrade (city
 * upgrades are the ai.assessment beat — D-034); after every applied
 * dispatch the harness asserts the 7 wiring-coherence invariants.
 * Legality oracle = the genuine engine outcome.
 * Outputs sim/strategy-report.json (deterministic except `ms`).
 * Run: npm run sim:strategy  (or: npx tsx sim/strategy-drill.ts [games] [steps])
 */
import { writeFileSync } from 'node:fs';
import {
  markUntrusted,
  type ClientRequest,
  type PlayerId,
  type Untrusted,
} from '../src/engine/authority.js';
import type { CommanderRecord } from '../src/engine/commanders.js';
import { isStanceId } from '../src/engine/stance.js';
import { Match, STANDARD_RULESET } from '../src/engine/match.js';
import { unitDamageOf, type UnitsConfig } from '../src/engine/warfare.js';
import { createWorldState } from '../src/engine/world-state.js';

const GAMES = Number(process.argv[2] ?? 20);
const STEPS = Number(process.argv[3] ?? 60);

/** Drill stats (the Match runs on these; the drill recomputes against them). */
const DRILL_UNITS: UnitsConfig = {
  worker: { cost: { food: 10 }, maxHp: 5, damage: 1 },
  warrior: { cost: { food: 20, gold: 5 }, maxHp: 12, damage: 4 },
  archer: { cost: { wood: 15, gold: 10 }, maxHp: 8, damage: 3 },
};

const C0_TRIPLE: CommanderRecord = {
  id: 'c0',
  owner: 'p1',
  active: true,
  personality: 'strategist',
  doctrine: 'turtle',
};
const C1_TRIPLE: CommanderRecord = {
  id: 'c1',
  owner: 'p2',
  active: true,
  personality: 'conqueror',
  doctrine: 'blitz',
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

interface Candidate {
  type: string;
  payload: unknown;
}

interface GameStats {
  seed: number;
  applied: number;
  rejected: number;
  appliedByType: Record<string, number>;
  upgrades: number;
  aiFacts: number;
  commandersFinal: number;
}

function scenarioFor(seed: number): Match {
  return new Match({
    seed,
    ruleset: STANDARD_RULESET,
    players: ['p1' as PlayerId, 'p2' as PlayerId],
    initialState: createWorldState({
      players: ['p1' as PlayerId, 'p2' as PlayerId],
      units: {
        schemaVersion: 1,
        nextId: 3,
        units: [
          { id: 'u0', owner: 'p1', type: 'worker', hp: 5, col: 0, row: 0 },
          { id: 'u1', owner: 'p1', type: 'warrior', hp: 12, col: 1, row: 0 },
          { id: 'u2', owner: 'p2', type: 'archer', hp: 8, col: 2, row: 0 },
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
          p1: { 'town-center': 1, house: 2, storage: 1, barracks: 0, wall: 0, tower: 0 },
          p2: { 'town-center': 1, house: 1, storage: 0, barracks: 0, wall: 0, tower: 0 },
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
        commanders: [{ ...C0_TRIPLE }, { ...C1_TRIPLE }],
      },
    }),
    unitsConfig: DRILL_UNITS,
    promptsPerPlayer: 200,
  });
}

function candidates(
  snap: ReturnType<Match['getSnapshot']>,
  who: PlayerId,
  rnd: () => number,
): Candidate[] {
  const out: Candidate[] = [];
  out.push({ type: 'commander.commission', payload: {} });
  const owned = (snap.commanders?.commanders ?? []).filter((r) => r.owner === who);
  if (owned.length > 0) {
    const pick = owned[Math.floor(rnd() * owned.length)]!;
    out.push({
      type: pick.active ? 'commander.deactivate' : 'commander.activate',
      payload: { id: pick.id },
    });
  }
  out.push({ type: 'commander.activate', payload: { id: 'c999999' } });
  // Strategic beats: builds (funds-gated) + upgrades (level-gated).
  const builds = ['house', 'tower', 'storage', 'barracks', 'wall'];
  out.push({ type: 'city.build', payload: { type: builds[Math.floor(rnd() * builds.length)] } });
  out.push({ type: 'city.upgrade', payload: {} });
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

function checkInvariants(
  match: Match,
  prevAiFacts: number,
  appliedType: string,
  violations: string[],
  where: string,
): number {
  const snap = match.getSnapshot();
  for (const viewer of ['p1', 'p2'] as const) {
    const query = match.assessmentOf(viewer);
    const ownUnits = (snap.units?.units ?? []).filter((u) => u.owner === viewer);
    const ownCommanders = (snap.commanders?.commanders ?? []).filter((r) => r.owner === viewer);
    // 1. Query counts match the live snapshot exactly.
    if (query.military.units !== ownUnits.length) {
      violations.push(`${where}: ${viewer} units ${query.military.units} vs ${ownUnits.length}`);
    }
    if (query.commanders.count !== ownCommanders.length) {
      violations.push(
        `${where}: ${viewer} commanders ${query.commanders.count} vs ${ownCommanders.length}`,
      );
    }
    const active = ownCommanders.filter((r) => r.active).length;
    if (query.commanders.active !== active) {
      violations.push(`${where}: ${viewer} active ${query.commanders.active} vs ${active}`);
    }
    // 2. Military independently recomputed (drill path vs wiring path).
    let hp = 0;
    let damage = 0;
    for (const u of ownUnits) {
      hp += u.hp;
      damage += unitDamageOf(DRILL_UNITS, u.type);
    }
    if (query.military.totalHp !== hp || query.military.totalDamage !== damage) {
      violations.push(`${where}: ${viewer} military recompute mismatch`);
    }
    // 3. Stances valid + roster-ordered; posture majority sits in the argmax set.
    const stances = match.stancesOf(viewer);
    const ids = ownCommanders.map((r) => r.id);
    if (stances.length !== ids.length || !stances.every((s, i) => s.id === ids[i])) {
      violations.push(`${where}: ${viewer} stances ids/order drift`);
    }
    for (const s of stances) {
      if (!isStanceId(s.stance)) {
        violations.push(`${where}: ${viewer} stance ${s.id} invalid (${String(s.stance)})`);
      }
    }
    const posture = match.postureOf(viewer);
    const counts = Object.values(posture.distribution);
    if (counts.reduce((a, b) => a + b, 0) !== ownCommanders.length) {
      violations.push(`${where}: ${viewer} posture distribution sum drift`);
    }
    const max = Math.max(...counts);
    const winners = Object.entries(posture.distribution)
      .filter(([, n]) => n === max)
      .map(([stance]) => stance);
    if (!isStanceId(posture.majority) || !winners.includes(posture.majority)) {
      violations.push(`${where}: ${viewer} majority ${posture.majority} outside argmax`);
    }
    // 4. Economy deep-equals raw snapshot reads (independent path, zeros when absent).
    const rawPile = snap.stockpiles?.stockpiles[viewer];
    const wantPile =
      rawPile === undefined
        ? { food: 0, wood: 0, stone: 0, gold: 0 }
        : { food: rawPile.food, wood: rawPile.wood, stone: rawPile.stone, gold: rawPile.gold };
    if (JSON.stringify(query.economy.stockpile) !== JSON.stringify(wantPile)) {
      violations.push(`${where}: ${viewer} stockpile query drift`);
    }
    const rawCounts = snap.buildings?.buildings[viewer];
    const wantCounts =
      rawCounts === undefined
        ? { 'town-center': 0, house: 0, storage: 0, barracks: 0, wall: 0, tower: 0 }
        : {
            'town-center': rawCounts['town-center'],
            house: rawCounts.house,
            storage: rawCounts.storage,
            barracks: rawCounts.barracks,
            wall: rawCounts.wall,
            tower: rawCounts.tower,
          };
    if (JSON.stringify(query.economy.buildings) !== JSON.stringify(wantCounts)) {
      violations.push(`${where}: ${viewer} buildings query drift`);
    }
    const wantLevel = snap.cities?.cities[viewer]?.level ?? 1;
    if (query.economy.cityLevel !== wantLevel) {
      violations.push(`${where}: ${viewer} cityLevel ${query.economy.cityLevel} vs ${wantLevel}`);
    }
  }
  // 5. ai.assessment facts: shape-valid newcomers only.
  const events = match.getEvents();
  const aiFacts = events.filter((e) => e.type === 'ai.assessment');
  for (const fact of aiFacts.slice(prevAiFacts)) {
    if (fact.priority !== 'low') {
      violations.push(`${where}: ai fact priority ${fact.priority}`);
    }
    const payload = fact.payload;
    if (!isRecord(payload)) {
      violations.push(`${where}: ai fact payload not a record`);
      continue;
    }
    if (payload['player'] !== 'p1' && payload['player'] !== 'p2') {
      violations.push(`${where}: ai fact unknown player`);
    }
    const military = payload['military'];
    const economy = payload['economy'];
    const command = payload['commanders'];
    if (!isRecord(military) || !isRecord(economy) || !isRecord(command)) {
      violations.push(`${where}: ai fact sections malformed`);
      continue;
    }
    for (const key of ['units', 'totalHp', 'totalDamage']) {
      if (typeof military[key] !== 'number' || !Number.isFinite(military[key] as number)) {
        violations.push(`${where}: ai fact military.${key} malformed`);
      }
    }
    const pile = economy['stockpile'];
    if (!isRecord(pile)) {
      violations.push(`${where}: ai fact stockpile malformed`);
    }
    if (typeof economy['cityLevel'] !== 'number') {
      violations.push(`${where}: ai fact cityLevel malformed`);
    }
    if (typeof command['count'] !== 'number' || typeof command['active'] !== 'number') {
      violations.push(`${where}: ai fact commanders counts malformed`);
    }
    const avg = command['avgEffective'];
    if (avg !== undefined) {
      if (!isRecord(avg)) {
        violations.push(`${where}: ai fact avgEffective malformed`);
      } else {
        for (const value of Object.values(avg)) {
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
            violations.push(`${where}: ai fact avg trait out of bounds`);
            break;
          }
        }
      }
    }
    const stances = command['stances'];
    if (!Array.isArray(stances)) {
      violations.push(`${where}: ai fact stances malformed`);
    } else {
      for (const entry of stances) {
        if (!isRecord(entry) || typeof entry['id'] !== 'string' || !isStanceId(entry['stance'])) {
          violations.push(`${where}: ai fact stance entry malformed`);
          break;
        }
      }
    }
  }
  // 6. Beat cliché: upgrades emit exactly two facts (both holders), others zero.
  const fresh = aiFacts.length - prevAiFacts;
  const want = appliedType === 'city.upgrade' ? 2 : 0;
  if (fresh !== want) {
    violations.push(`${where}: ${appliedType} emitted ${fresh} ai facts (want ${want})`);
  }
  // 7. Zero producer faults + JSON persistence safety.
  for (const e of events) {
    if (e.type === 'system.event-fault') {
      violations.push(`${where}: event-fault ${JSON.stringify(e.payload).slice(0, 120)}`);
      break;
    }
  }
  JSON.parse(JSON.stringify(snap));
  return aiFacts.length;
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
  let upgrades = 0;
  let aiFacts = 0;
  let rid = 0;
  const sides: PlayerId[] = ['p1' as PlayerId, 'p2' as PlayerId];
  for (let step = 0; step < STEPS; step += 1) {
    const who = sides[step % 2]!;
    const snap = match.getSnapshot();
    let done = '';
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
        if (c.type === 'city.upgrade') upgrades += 1;
        done = c.type;
        break;
      }
      rejected += 1;
    }
    if (done === '') violations.push(`game ${seed} step ${step}: no legal candidate for ${who}`);
    aiFacts = checkInvariants(match, aiFacts, done, violations, `game ${seed} step ${step}`);
  }
  return {
    stats: {
      seed,
      applied,
      rejected,
      appliedByType: byType,
      upgrades,
      aiFacts,
      commandersFinal: match.getSnapshot().commanders?.commanders.length ?? 0,
    },
    violations,
  };
}

function main(): void {
  const t0 = Date.now();
  const games: GameStats[] = [];
  const violations: string[] = [];
  for (let g = 0; g < GAMES; g += 1) {
    const seed = 1000 + g;
    const { stats, violations: v } = playGame(seed);
    games.push(stats);
    violations.push(...v);
  }
  const applied = games.reduce((a, g) => a + g.applied, 0);
  const rejected = games.reduce((a, g) => a + g.rejected, 0);
  const upgrades = games.reduce((a, g) => a + g.upgrades, 0);
  const aiFacts = games.reduce((a, g) => a + g.aiFacts, 0);
  const appliedByType: Record<string, number> = {};
  for (const g of games) {
    for (const [t, n] of Object.entries(g.appliedByType)) {
      appliedByType[t] = (appliedByType[t] ?? 0) + n;
    }
  }
  const report = {
    meta: {
      kind: 'ai-strategy-drill',
      games: GAMES,
      stepsPerGame: STEPS,
      seeds: games.map((g) => g.seed),
      ms: Date.now() - t0,
      note: 'AI wiring (queries + upgrade snapshots) checked against live Matches every dispatch. Deterministic per seed.',
    },
    totals: { applied, rejected, violations: violations.length, upgrades, aiFacts, appliedByType },
    violations: violations.slice(0, 50),
    games,
  };
  writeFileSync(
    new URL('./strategy-report.json', import.meta.url),
    JSON.stringify(report, null, 1),
  );
  console.log(
    `strategy drill ok: ${GAMES} games x ${STEPS} steps, applied=${applied} rejected=${rejected} ` +
      `violations=${violations.length} upgrades=${upgrades} aiFacts=${aiFacts} (${Date.now() - t0}ms)`,
  );
  if (violations.length > 0) {
    console.error(violations.slice(0, 10).join('\n'));
    process.exitCode = 1;
  }
}

main();
