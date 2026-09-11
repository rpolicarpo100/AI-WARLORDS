/**
 * M034 — Personality drill: commanders with DNA/personality/doctrine data
 * living through real deterministic Matches. Bots commission + flip actives
 * (init-placed triples never written — D-025/D-026/D-027); after every
 * applied dispatch the harness asserts the 7 personality invariants.
 * Legality oracle = the genuine engine outcome.
 * Outputs sim/personality-report.json (deterministic except `ms`).
 * Run: npm run sim:personality  (or: npx tsx sim/personality-drill.ts [games] [steps])
 */
import { writeFileSync } from 'node:fs';
import {
  markUntrusted,
  type ClientRequest,
  type PlayerId,
  type Untrusted,
} from '../src/engine/authority.js';
import {
  commanderById,
  isCommanderRecord,
  isCommandersData,
  type CommanderRecord,
} from '../src/engine/commanders.js';
import { isDnaTraits } from '../src/engine/dna.js';
import { isDoctrineId } from '../src/engine/doctrines.js';
import { Match, STANDARD_RULESET } from '../src/engine/match.js';
import { isPersonalityId } from '../src/engine/personalities.js';
import { perceive } from '../src/engine/views.js';
import { createWorldState } from '../src/engine/world-state.js';

const GAMES = Number(process.argv[2] ?? 20);
const STEPS = Number(process.argv[3] ?? 60);

/** Init-placed triples (the sanctioned path — writers are FUTURO). Distinct per side. */
const C0_DNA = {
  aggression: 50,
  defense: 50,
  economy: 50,
  exploration: 50,
  risk: 50,
  expansion: 50,
  diplomacy: 50,
  patience: 50,
  greed: 50,
  adaptability: 50,
};
const C1_DNA = {
  aggression: 60,
  defense: 61,
  economy: 62,
  exploration: 63,
  risk: 64,
  expansion: 65,
  diplomacy: 66,
  patience: 67,
  greed: 68,
  adaptability: 69,
};
const C0_TRIPLE: CommanderRecord = {
  id: 'c0',
  owner: 'p1',
  active: true,
  dna: { ...C0_DNA },
  personality: 'strategist',
  doctrine: 'turtle',
};
const C1_TRIPLE: CommanderRecord = {
  id: 'c1',
  owner: 'p2',
  active: true,
  dna: { ...C1_DNA },
  personality: 'conqueror',
  doctrine: 'blitz',
};
const INIT_IDS = new Set(['c0', 'c1']);
// Personality payload only: `active` legitimately flips (M029 writers mint +
// flip-active, never touch the triple) — stability covers the triple alone.
function tripleJson(record: CommanderRecord): string {
  return JSON.stringify({
    dna: record.dna,
    personality: record.personality,
    doctrine: record.doctrine,
  });
}
const INIT_TRIPLE_JSON = new Map([
  ['c0', tripleJson(C0_TRIPLE)],
  ['c1', tripleJson(C1_TRIPLE)],
]);

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
  commissions: number;
  flips: number;
  commandersFinal: number;
}

function scenarioFor(seed: number): Match {
  return new Match({
    seed,
    ruleset: STANDARD_RULESET,
    players: ['p1' as PlayerId, 'p2' as PlayerId],
    initialState: createWorldState({
      players: ['p1' as PlayerId, 'p2' as PlayerId],
      commanders: {
        schemaVersion: 1,
        nextId: 2,
        commanders: [
          { ...C0_TRIPLE, dna: { ...C0_DNA } },
          { ...C1_TRIPLE, dna: { ...C1_DNA } },
        ],
      },
    }),
    promptsPerPlayer: 200,
  });
}

function candidates(
  snap: ReturnType<Match['getSnapshot']>,
  who: PlayerId,
  rnd: () => number,
): Candidate[] {
  const out: Candidate[] = [];
  // Commission is lawful until 2^32 (roster uncapped — M029).
  out.push({ type: 'commander.commission', payload: {} });
  const owned = (snap.commanders?.commanders ?? []).filter((r) => r.owner === who);
  // Flip a random owned commander (engine decides — already-active rejects).
  if (owned.length > 0) {
    const pick = owned[Math.floor(rnd() * owned.length)]!;
    out.push({
      type: pick.active ? 'commander.deactivate' : 'commander.activate',
      payload: { id: pick.id },
    });
    // A second flip on another owned id (often the no-op twin — oracle decides).
    const other = owned[Math.floor(rnd() * owned.length)]!;
    out.push({
      type: other.active ? 'commander.deactivate' : 'commander.activate',
      payload: { id: other.id },
    });
  }
  // Blind flip on an unknown id (must reject loud — engine oracle).
  out.push({ type: 'commander.activate', payload: { id: 'c999999' } });
  out.push({ type: 'world.noop', payload: {} });
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function checkInvariants(
  snap: ReturnType<Match['getSnapshot']>,
  prevNextId: number,
  violations: string[],
  where: string,
): number {
  const data = snap.commanders;
  // 1. Guard holds live: whole data + every record validate.
  if (data === undefined) {
    violations.push(`${where}: commanders data missing`);
    return prevNextId;
  }
  if (!isCommandersData(data)) {
    violations.push(`${where}: isCommandersData false`);
  }
  const seen = new Set<string>();
  for (const record of data.commanders) {
    if (!isCommanderRecord(record)) {
      violations.push(`${where}: record ${record.id} fails guard`);
    }
    // 2. Canonical agreement live (mirrors crossed at runtime).
    if (record.dna !== undefined && !isDnaTraits(record.dna)) {
      violations.push(`${where}: record ${record.id} dna fails canonical`);
    }
    if (record.personality !== undefined && !isPersonalityId(record.personality)) {
      violations.push(`${where}: record ${record.id} personality fails canonical`);
    }
    if (record.doctrine !== undefined && !isDoctrineId(record.doctrine)) {
      violations.push(`${where}: record ${record.id} doctrine fails canonical`);
    }
    // 3. Init triples byte-stable (no writer mutates personality data).
    const want = INIT_TRIPLE_JSON.get(record.id);
    if (want !== undefined && tripleJson(record) !== want) {
      violations.push(`${where}: init triple ${record.id} mutated`);
    }
    // 4. Minted commanders carry no triple (commission takes no params — M029).
    if (!INIT_IDS.has(record.id)) {
      if (
        record.dna !== undefined ||
        record.personality !== undefined ||
        record.doctrine !== undefined
      ) {
        violations.push(`${where}: minted ${record.id} carries triple data`);
      }
    }
    // 5. Ids unique + c-sequence below nextId.
    if (seen.has(record.id)) {
      violations.push(`${where}: duplicate commander id ${record.id}`);
    }
    seen.add(record.id);
    const seq = /^c(\d+)$/.exec(record.id);
    if (seq === null || Number(seq[1]) >= data.nextId) {
      violations.push(`${where}: commander id ${record.id} outside nextId=${data.nextId}`);
    }
  }
  if (data.nextId < prevNextId) {
    violations.push(`${where}: nextId went backwards ${prevNextId}->${data.nextId}`);
  }
  // 6. Snapshot must survive a JSON round-trip (persistence safety).
  JSON.parse(JSON.stringify(snap));
  // 7. Perception: own-only, no leak, no loss (M027/M031).
  for (const viewer of ['p1', 'p2'] as const) {
    const seenIds = perceive(snap, viewer as PlayerId).commanders.map((r) => r.id);
    for (const id of seenIds) {
      const record = commanderById(data, id);
      if (record === undefined) {
        violations.push(`${where}: ${viewer} perceives ghost ${id}`);
      } else if (record.owner !== viewer) {
        violations.push(`${where}: ${viewer} perceives foe commander ${id}`);
      }
    }
    const ownIds = data.commanders.filter((r) => r.owner === viewer).map((r) => r.id);
    if (seenIds.length !== ownIds.length || !ownIds.every((id) => seenIds.includes(id))) {
      violations.push(
        `${where}: ${viewer} perception loss (own=${ownIds.length} seen=${seenIds.length})`,
      );
    }
  }
  return data.nextId;
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
  let commissions = 0;
  let flips = 0;
  let nextId = 2;
  let rid = 0;
  const sides: PlayerId[] = ['p1' as PlayerId, 'p2' as PlayerId];
  for (let step = 0; step < STEPS; step += 1) {
    const who = sides[step % 2]!;
    const snap = match.getSnapshot();
    let done = false;
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
        if (c.type === 'commander.commission') commissions += 1;
        if (c.type === 'commander.activate' || c.type === 'commander.deactivate') flips += 1;
        done = true;
        break;
      }
      rejected += 1;
    }
    if (!done) violations.push(`game ${seed} step ${step}: no legal candidate for ${who}`);
    nextId = checkInvariants(match.getSnapshot(), nextId, violations, `game ${seed} step ${step}`);
  }
  return {
    stats: {
      seed,
      applied,
      rejected,
      appliedByType: byType,
      commissions,
      flips,
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
  const commissions = games.reduce((a, g) => a + g.commissions, 0);
  const flips = games.reduce((a, g) => a + g.flips, 0);
  const appliedByType: Record<string, number> = {};
  for (const g of games) {
    for (const [t, n] of Object.entries(g.appliedByType)) {
      appliedByType[t] = (appliedByType[t] ?? 0) + n;
    }
  }
  const report = {
    meta: {
      kind: 'ai-personality-drill',
      games: GAMES,
      stepsPerGame: STEPS,
      seeds: games.map((g) => g.seed),
      ms: Date.now() - t0,
      note: 'Commanders with personality triples play real Matches; legality from genuine engine outcomes. Deterministic per seed.',
    },
    totals: { applied, rejected, violations: violations.length, commissions, flips, appliedByType },
    violations: violations.slice(0, 50),
    games,
  };
  writeFileSync(
    new URL('./personality-report.json', import.meta.url),
    JSON.stringify(report, null, 1),
  );
  console.log(
    `personality drill ok: ${GAMES} games x ${STEPS} steps, applied=${applied} rejected=${rejected} ` +
      `violations=${violations.length} commissions=${commissions} flips=${flips} (${Date.now() - t0}ms)`,
  );
  if (violations.length > 0) {
    console.error(violations.slice(0, 10).join('\n'));
    process.exitCode = 1;
  }
}

main();
