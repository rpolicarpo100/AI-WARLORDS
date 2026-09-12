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
 * GET /:id/state returns the frozen snapshot. Well-formed domain
 * traffic always answers 200 (outcomes carry domain errors —
 * transport never re-interprets them); malformed bodies, unknown
 * sessions and bad cursors answer 400; unknown routes and matches
 * answer 404. No auth (the Security phase owns it), no roster
 * flexibility (fixed skirmish), no production listener yet (tests
 * drive real localhost HTTP; deployment is a later module's call).
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
import { createWorldState } from '../engine/world-state.js';

interface Stream {
  readonly res: ServerResponse;
  cursor: number;
}

interface Entry {
  readonly match: Match;
  readonly sessions: Map<string, SessionHandle>;
  readonly streams: Set<Stream>;
}

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

/** node:http request handler (never throws — every seam guarded). */
export function createTransport(): (req: IncomingMessage, res: ServerResponse) => void {
  const matches = new Map<string, Entry>();

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
    void route(req, res).catch(() => {
      send(res, 500, { error: 'transport fault' });
    });
  };

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method as string;
    const url = new URL(req.url as string, 'http://local');
    const parts = url.pathname.split('/').filter((part) => part.length > 0);
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
      matches.set(match.id, { match, sessions: new Map(), streams: new Set() });
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
      let handle: SessionHandle;
      try {
        handle = entry.match.join(playerId as PlayerId);
      } catch {
        send(res, 400, { error: 'unknown player' });
        return;
      }
      entry.sessions.set(handle.sessionId, handle);
      send(res, 200, { sessionId: handle.sessionId, playerId: handle.playerId });
      return;
    }
    if (parts[2] === 'dispatch' && method === 'POST') {
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
      const handle = entry.sessions.get(sessionId);
      if (handle === undefined) {
        send(res, 400, { error: 'unknown session' });
        return;
      }
      const outcome = entry.match.dispatch(
        handle,
        markUntrusted({
          requestId: record['requestId'],
          playerId: handle.playerId,
          type: record['type'],
          payload: record['payload'],
        } as ClientRequest),
      );
      broadcast(entry);
      send(res, 200, outcome);
      return;
    }
    if (parts[2] === 'events' && method === 'GET') {
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
