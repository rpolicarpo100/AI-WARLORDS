/**
 * M069 — SSE+POST transport (node:http, zero deps).
 *
 * First of the Multiplayer block (M069–M076, D-063, voted sse-post):
 * a tiny real HTTP surface over genuine Matches. POST /match {seed?}
 * forges a fixed server-side 2-player skirmish ([p1, p2] — the
 * client picks seed only, never state); POST /:id/join {playerId}
 * opens a session; POST /:id/dispatch {sessionId, requestId, type,
 * payload} dispatches with the caller DERIVED from the session
 * (spoof-proof by construction — the wire never carries playerId);
 * GET /:id/events?from=N streams match events (SSE backlog + live);
 * GET /:id/state returns the frozen snapshot. M070 (D-064, voted
 * presence) adds life: POST /:id/heartbeat {sessionId} → {online}
 * and POST /:id/leave; a lazy sweep kills sessions idle past
 * PRESENCE_TIMEOUT_MS (timeout = death, rejoin; dispatch counts as
 * activity); join/leave/timeout emit live-only `event: presence`
 * lines (the engine cursor never mixes with transport chatter).
 * M071 (D-065) adds the lobby: GET /matches sweeps every table and
 * lists [{matchId, players, online, status, revision, createdAt}]
 * (status open/finished straight from the verdict); POST /:id/close
 * drains, ends every stream and deletes (closing twice 404s);
 * joining a finished match 400s while dispatching on one still
 * answers 200 carrying MATCH_FINISHED (join-guarded,
 * dispatch-carried — the honest split). Well-formed domain traffic
 * always answers 200 (outcomes carry domain errors — transport
 * never re-interprets them); malformed bodies, unknown sessions
 * and bad cursors answer 400; unknown routes and matches answer
 * 404. No auth (the Security phase owns it), no roster flexibility
 * (fixed skirmish), no production listener yet (tests drive real
 * localhost HTTP; deployment is a later module's call).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  markUntrusted,
  type ClientRequest,
  type PlayerId,
  type SessionHandle,
} from '../engine/authority.js';
import type { MapCell, MapId } from '../engine/map.js';
import { Match, STANDARD_RULESET, createMatchId, isSeed, type MatchInit } from '../engine/match.js';
import { scoreTable } from '../engine/score.js';
import { eloPair, scoreOf } from '../engine/ratings.js';
import { winnerOf } from '../engine/victory.js';
import { createWorldState } from '../engine/world-state.js';

interface Stream {
  readonly res: ServerResponse;
  cursor: number;
}

interface SessionRecord {
  readonly handle: SessionHandle;
  lastSeen: number;
}

interface Entry {
  readonly match: Match;
  readonly sessions: Map<string, SessionRecord>;
  readonly streams: Set<Stream>;
  readonly createdAt: number;
  readonly seed: number;
}

/** One closed table, kept for the history board (M077, D-071). */
export interface MatchResult {
  readonly matchId: string;
  readonly seed: number;
  readonly status: 'finished' | 'ongoing';
  readonly outcome: 'win' | 'draw' | null;
  readonly winner: string | null;
  readonly condition: string | null;
  readonly scores: Readonly<Record<string, number>>;
  readonly revision: number;
  readonly createdAt: number;
  readonly closedAt: number;
}

/** History keeps the freshest tables (FIFO eviction past this). */
const DEFAULT_MAX_RESULTS = 50;

/** Fresh Elo wallets (v1 standard — the caller's constants live here). */
const RATING_DEFAULT = 1200;
const RATING_K = 32;

/** Fixed-window policy (requests per key per window). */
export interface RateLimit {
  readonly windowMs: number;
  readonly max: number;
}

/** v1 policy: human pace with burst room (D-075). */
export const DEFAULT_RATE_LIMIT: RateLimit = { windowMs: 60_000, max: 120 };

/**
 * Rate key: last X-Forwarded-For hop when present (single trusted
 * proxy — the Render topology), else the socket address. Empty XFF
 * falls back (spoofed rotation buys nothing but the shared bucket).
 */
function rateKey(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const hops = forwarded.split(',');
    const last = hops[hops.length - 1] as string;
    const trimmed = last.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return req.socket.remoteAddress as string;
}

/** Idle strictly past this, a session dies (the boundary stays online). */
export const PRESENCE_TIMEOUT_MS = 30_000;

/** Seed for seedless forges (fixed — matchIds still differ). */
const DEFAULT_SKIRMISH_SEED = 69;

function skirmishInit(seed: number | undefined): MatchInit {
  const cells: MapCell[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      cells.push(
        col === 0 && row === 0
          ? { col, row, terrain: 'resource', resource: { type: 'gold', amount: 5 } }
          : { col, row, terrain: 'field' },
      );
    }
  }
  const players = ['p1', 'p2'] as unknown as [PlayerId, PlayerId];
  return {
    matchId: createMatchId(),
    seed: seed ?? DEFAULT_SKIRMISH_SEED,
    ruleset: STANDARD_RULESET,
    players,
    initialState: createWorldState({
      players,
      map: {
        schemaVersion: 1,
        id: 'skirmish' as MapId,
        width: 3,
        height: 3,
        stagger: 'odd',
        cells,
        spawns: [],
      },
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
    }),
  };
}

function send(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      } catch {
        resolve({ ok: false });
      }
    });
  });
}

function asRecord(body: unknown): Record<string, unknown> | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  return body as Record<string, unknown>;
}

/**
 * node:http request handler (never throws — every seam guarded).
 * The clock is injectable (manual in tests — deterministic sweeps).
 */
export function createTransport(
  now: () => number = Date.now,
  maxResults: number = DEFAULT_MAX_RESULTS,
  rateLimit: RateLimit = DEFAULT_RATE_LIMIT,
): (req: IncomingMessage, res: ServerResponse) => void {
  const matches = new Map<string, Entry>();
  const results: MatchResult[] = [];
  const ratings = new Map<string, number>();
  const buckets = new Map<string, { count: number; resetAt: number }>();

  const presence = (entry: Entry, playerId: string, online: boolean): void => {
    const line = `event: presence\ndata: ${JSON.stringify({ source: 'transport', kind: 'presence', playerId, online, at: now() })}\n\n`;
    for (const stream of entry.streams) {
      stream.res.write(line, () => {});
    }
  };

  const sweep = (entry: Entry): void => {
    const moment = now();
    for (const [sessionId, record] of entry.sessions) {
      if (moment - record.lastSeen > PRESENCE_TIMEOUT_MS) {
        entry.sessions.delete(sessionId);
        presence(entry, record.handle.playerId, false);
      }
    }
  };

  const roster = (entry: Entry): string[] => {
    const online = new Set<string>();
    for (const record of entry.sessions.values()) {
      online.add(record.handle.playerId);
    }
    return [...online].sort();
  };

  const broadcast = (entry: Entry): void => {
    const events = entry.match.getEvents();
    for (const stream of entry.streams) {
      for (const event of events.slice(stream.cursor)) {
        stream.res.write(`data: ${JSON.stringify(event)}\n\n`, () => {});
      }
      stream.cursor = events.length;
    }
  };

  const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    void route(req, res).catch(() => {
      send(res, 500, { error: 'transport fault' });
    });
  };

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const key = rateKey(req);
    const bucket = buckets.get(key);
    if (bucket === undefined || now() >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now() + rateLimit.windowMs });
    } else {
      bucket.count += 1;
      if (bucket.count > rateLimit.max) {
        send(res, 429, { error: 'rate limited' });
        return;
      }
    }
    const method = req.method as string;
    const url = new URL(req.url as string, 'http://local');
    const parts = url.pathname.split('/').filter((part) => part.length > 0);
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (parts.length === 0 && method === 'GET') {
      send(res, 200, { service: 'ai-warlords', ok: true });
      return;
    }
    if (parts[0] === 'matches' && parts.length === 1 && method === 'GET') {
      const listing: unknown[] = [];
      for (const [matchId, item] of matches) {
        sweep(item);
        listing.push({
          matchId,
          players: item.match.getSnapshot().players.map((player) => player.id),
          online: roster(item),
          status: item.match.getVerdict().status === 'finished' ? 'finished' : 'open',
          revision: item.match.getRevision(),
          createdAt: item.createdAt,
        });
      }
      send(res, 200, listing);
      return;
    }
    if (parts[0] === 'results' && parts.length === 1 && method === 'GET') {
      send(res, 200, results);
      return;
    }
    if (parts[0] === 'ratings' && parts.length === 1 && method === 'GET') {
      send(res, 200, Object.fromEntries(ratings));
      return;
    }
    if (parts[0] !== 'match') {
      send(res, 404, { error: 'unknown route' });
      return;
    }
    if (parts.length === 1) {
      if (method !== 'POST') {
        send(res, 404, { error: 'unknown route' });
        return;
      }
      const body = await readJson(req);
      if (!body.ok) {
        send(res, 400, { error: 'malformed json' });
        return;
      }
      const record = asRecord(body.value);
      if (record === undefined) {
        send(res, 400, { error: 'malformed body' });
        return;
      }
      const seed = record['seed'];
      if (seed !== undefined && !isSeed(seed)) {
        send(res, 400, { error: 'bad seed' });
        return;
      }
      const match = new Match(skirmishInit(seed));
      matches.set(match.id, {
        match,
        sessions: new Map(),
        streams: new Set(),
        createdAt: now(),
        seed: seed ?? DEFAULT_SKIRMISH_SEED,
      });
      send(res, 200, { matchId: match.id });
      return;
    }
    const entry = matches.get(parts[1] as string);
    if (entry === undefined) {
      send(res, 404, { error: 'unknown match' });
      return;
    }
    if (parts.length !== 3) {
      send(res, 404, { error: 'unknown route' });
      return;
    }
    if (parts[2] === 'join' && method === 'POST') {
      sweep(entry);
      const body = await readJson(req);
      if (!body.ok) {
        send(res, 400, { error: 'malformed json' });
        return;
      }
      const record = asRecord(body.value);
      if (record === undefined) {
        send(res, 400, { error: 'malformed body' });
        return;
      }
      const playerId = record['playerId'];
      if (typeof playerId !== 'string') {
        send(res, 400, { error: 'bad playerId' });
        return;
      }
      if (entry.match.getVerdict().status === 'finished') {
        send(res, 400, { error: 'match finished' });
        return;
      }
      let handle: SessionHandle;
      try {
        handle = entry.match.join(playerId as PlayerId);
      } catch {
        send(res, 400, { error: 'unknown player' });
        return;
      }
      entry.sessions.set(handle.sessionId, { handle, lastSeen: now() });
      presence(entry, handle.playerId, true);
      send(res, 200, { sessionId: handle.sessionId, playerId: handle.playerId });
      return;
    }
    if (parts[2] === 'dispatch' && method === 'POST') {
      sweep(entry);
      const body = await readJson(req);
      if (!body.ok) {
        send(res, 400, { error: 'malformed json' });
        return;
      }
      const record = asRecord(body.value);
      if (record === undefined) {
        send(res, 400, { error: 'malformed body' });
        return;
      }
      const sessionId = record['sessionId'];
      if (typeof sessionId !== 'string') {
        send(res, 400, { error: 'bad sessionId' });
        return;
      }
      const found = entry.sessions.get(sessionId);
      if (found === undefined) {
        send(res, 400, { error: 'unknown session' });
        return;
      }
      found.lastSeen = now();
      const outcome = entry.match.dispatch(
        found.handle,
        markUntrusted({
          requestId: record['requestId'],
          playerId: found.handle.playerId,
          type: record['type'],
          payload: record['payload'],
        } as ClientRequest),
      );
      broadcast(entry);
      send(res, 200, outcome);
      return;
    }
    if (parts[2] === 'heartbeat' && method === 'POST') {
      sweep(entry);
      const body = await readJson(req);
      if (!body.ok) {
        send(res, 400, { error: 'malformed json' });
        return;
      }
      const record = asRecord(body.value);
      if (record === undefined) {
        send(res, 400, { error: 'malformed body' });
        return;
      }
      const sessionId = record['sessionId'];
      if (typeof sessionId !== 'string') {
        send(res, 400, { error: 'bad sessionId' });
        return;
      }
      const found = entry.sessions.get(sessionId);
      if (found === undefined) {
        send(res, 400, { error: 'unknown session' });
        return;
      }
      found.lastSeen = now();
      send(res, 200, { online: roster(entry) });
      return;
    }
    if (parts[2] === 'leave' && method === 'POST') {
      sweep(entry);
      const body = await readJson(req);
      if (!body.ok) {
        send(res, 400, { error: 'malformed json' });
        return;
      }
      const record = asRecord(body.value);
      if (record === undefined) {
        send(res, 400, { error: 'malformed body' });
        return;
      }
      const sessionId = record['sessionId'];
      if (typeof sessionId !== 'string') {
        send(res, 400, { error: 'bad sessionId' });
        return;
      }
      const found = entry.sessions.get(sessionId);
      if (found === undefined) {
        send(res, 400, { error: 'unknown session' });
        return;
      }
      entry.sessions.delete(sessionId);
      presence(entry, found.handle.playerId, false);
      send(res, 200, { online: roster(entry) });
      return;
    }
    if (parts[2] === 'close' && method === 'POST') {
      req.resume();
      for (const stream of entry.streams) {
        stream.res.end();
      }
      const verdict = entry.match.getVerdict();
      const rosterPlayers = entry.match.getSnapshot().players.map((player) => player.id);
      if (verdict.status === 'finished') {
        // Pairwise Elo over the forged pair (forge is always 2p — the
        // cast is the transport mold for structurally-fixed shapes).
        const first = rosterPlayers[0] as string;
        const second = rosterPlayers[1] as string;
        const updated = eloPair(
          ratings.get(first) ?? RATING_DEFAULT,
          ratings.get(second) ?? RATING_DEFAULT,
          scoreOf(verdict.outcome, first),
          RATING_K,
        );
        ratings.set(first, updated.a);
        ratings.set(second, updated.b);
      }
      results.push({
        matchId: parts[1] as string,
        seed: entry.seed,
        status: verdict.status,
        outcome: verdict.status === 'finished' ? verdict.outcome.kind : null,
        winner: verdict.status === 'finished' ? winnerOf(verdict.outcome) : null,
        condition: verdict.status === 'finished' ? verdict.condition : null,
        scores: scoreTable(entry.match.getSnapshot(), rosterPlayers),
        revision: entry.match.getRevision(),
        createdAt: entry.createdAt,
        closedAt: now(),
      });
      if (results.length > maxResults) {
        results.shift();
      }
      matches.delete(parts[1] as string);
      send(res, 200, { closed: true });
      return;
    }
    if (parts[2] === 'events' && method === 'GET') {
      sweep(entry);
      const from = url.searchParams.get('from');
      const cursor = from === null ? 0 : Number(from);
      if (!Number.isInteger(cursor) || cursor < 0) {
        send(res, 400, { error: 'bad from' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.flushHeaders();
      const stream: Stream = { res, cursor };
      const events = entry.match.getEvents();
      for (const event of events.slice(cursor)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`, () => {});
      }
      stream.cursor = events.length;
      entry.streams.add(stream);
      req.on('close', () => {
        entry.streams.delete(stream);
      });
      return;
    }
    if (parts[2] === 'state' && method === 'GET') {
      send(res, 200, entry.match.getSnapshot());
      return;
    }
    send(res, 404, { error: 'unknown route' });
  };

  return onRequest;
}
