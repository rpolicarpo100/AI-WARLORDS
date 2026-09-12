/**
 * M069 — transport tests: every case runs over REAL localhost HTTP
 * (ephemeral port, genuine Matches underneath — no engine mocks;
 * the single fault-injection case uses a labeled TEST MOCK req).
 * Routing/validation branches each pinned per side (100% honest).
 */
import { EventEmitter } from 'node:events';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_RATE_LIMIT,
  MAX_BODY_BYTES,
  MAX_STREAMS_PER_MATCH,
  PRESENCE_TIMEOUT_MS,
  createTransport,
  type RateLimit,
} from './transport.js';

let server: Server;
let port = 0;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(cond: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (cond()) {
      return;
    }
    await sleep(10);
  }
  throw new Error(`TEST BUG: ${label} never arrived`);
}

beforeAll(async () => {
  // Suite volume would trip the shipped default (harness config, not a
  // bypass — the limiter mechanism is proven with low limits below).
  server = createServer(createTransport(Date.now, 50, { windowMs: 60_000, max: 1_000_000 }));
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err === undefined ? resolve() : reject(err)));
  });
});

function post(path: string, body: string): Promise<{ code: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        port,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => {
          resolve({ code: res.statusCode ?? 0, json: JSON.parse(text) });
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

const postJson = (path: string, value: unknown): Promise<{ code: number; json: unknown }> =>
  post(path, JSON.stringify(value));

function options(
  path: string,
): Promise<{ code: number; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ port, path, method: 'OPTIONS' }, (res) => {
      res.resume();
      res.on('end', () => {
        resolve({ code: res.statusCode ?? 0, headers: { ...res.headers } });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function get(path: string): Promise<{ code: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ port, path, method: 'GET' }, (res) => {
      let text = '';
      res.on('data', (chunk) => {
        text += chunk;
      });
      res.on('end', () => {
        resolve({ code: res.statusCode ?? 0, json: JSON.parse(text) });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function openSse(path: string): {
  chunks: string[];
  code: Promise<number>;
  ended: Promise<void>;
  close: () => void;
} {
  const chunks: string[] = [];
  let codeResolve: (code: number) => void = () => {};
  const code = new Promise<number>((resolve) => {
    codeResolve = resolve;
  });
  let endResolve: () => void = () => {};
  const ended = new Promise<void>((resolve) => {
    endResolve = resolve;
  });
  const req = httpRequest({ port, path, method: 'GET' }, (res) => {
    codeResolve(res.statusCode ?? 0);
    res.on('data', (chunk) => {
      chunks.push(String(chunk));
    });
    res.on('end', () => {
      endResolve();
    });
  });
  req.on('error', () => {});
  req.end();
  return {
    chunks,
    code,
    ended,
    close: () => {
      req.destroy();
    },
  };
}

async function sessionFor(playerId: string): Promise<{ matchId: string; sessionId: string }> {
  const created = await postJson('/match', {});
  const matchId = (created.json as { matchId: string }).matchId;
  const joined = await postJson(`/match/${matchId}/join`, { playerId });
  const { sessionId } = joined.json as { sessionId: string };
  return { matchId, sessionId };
}

async function withClock(
  fn: (clock: { now: number }) => Promise<void>,
  maxResults?: number,
  rateLimit?: RateLimit,
): Promise<void> {
  const main = port;
  const clock = { now: 1_000_000 };
  const manual = createServer(createTransport(() => clock.now, maxResults, rateLimit));
  await new Promise<void>((resolve) => manual.listen(0, resolve));
  port = (manual.address() as { port: number }).port;
  try {
    await fn(clock);
  } finally {
    port = main;
    manual.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      manual.close((err) => (err === undefined ? resolve() : reject(err)));
    });
  }
}

async function spendAll(matchId: string, first: string, second: string): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await postJson(`/match/${matchId}/dispatch`, {
      sessionId: first,
      requestId: `e1-${i}`,
      type: 'world.noop',
      payload: {},
    });
    await postJson(`/match/${matchId}/dispatch`, {
      sessionId: second,
      requestId: `e2-${i}`,
      type: 'world.noop',
      payload: {},
    });
  }
}

describe('POST /match (forge skirmish)', () => {
  it('forges with default seed', async () => {
    const { code, json } = await postJson('/match', {});
    expect(code).toBe(200);
    expect(typeof (json as { matchId: string }).matchId).toBe('string');
  });

  it('forges with explicit seed', async () => {
    const { code } = await postJson('/match', { seed: 7 });
    expect(code).toBe(200);
  });

  it('rejects bad seeds', async () => {
    expect(await postJson('/match', { seed: 'x' })).toMatchObject({ code: 400 });
  });

  it('rejects malformed bodies', async () => {
    expect(await postJson('/match', null)).toMatchObject({ code: 400 });
    expect(await postJson('/match', 5)).toMatchObject({ code: 400 });
    expect(await post('/match', '{oops')).toMatchObject({ code: 400 });
  });
});

describe('POST /match/:id/join (sessions)', () => {
  it('opens a session for roster players', async () => {
    const { matchId } = await sessionFor('p1');
    const { code, json } = await postJson(`/match/${matchId}/join`, { playerId: 'p2' });
    expect(code).toBe(200);
    expect(json).toMatchObject({ playerId: 'p2' });
    expect(typeof (json as { sessionId: string }).sessionId).toBe('string');
  });

  it('rejects unknown players', async () => {
    const { matchId } = await sessionFor('p1');
    expect(await postJson(`/match/${matchId}/join`, { playerId: 'px' })).toMatchObject({
      code: 400,
    });
  });

  it('rejects malformed join bodies', async () => {
    const { matchId } = await sessionFor('p1');
    expect(await postJson(`/match/${matchId}/join`, {})).toMatchObject({ code: 400 });
    expect(await postJson(`/match/${matchId}/join`, { playerId: 5 })).toMatchObject({ code: 400 });
    expect(await postJson(`/match/${matchId}/join`, null)).toMatchObject({ code: 400 });
    expect(await post(`/match/${matchId}/join`, '{oops')).toMatchObject({ code: 400 });
  });

  it('404s unknown matches', async () => {
    expect(await postJson('/match/NOPE/join', { playerId: 'p1' })).toMatchObject({ code: 404 });
  });
});

describe('POST /match/:id/dispatch (wire lances)', () => {
  it('applies a noop (outcome echoes over 200)', async () => {
    const { matchId, sessionId } = await sessionFor('p1');
    const { code, json } = await postJson(`/match/${matchId}/dispatch`, {
      sessionId,
      requestId: 'd1',
      type: 'world.noop',
      payload: {},
    });
    expect(code).toBe(200);
    expect(json).toMatchObject({ status: 'applied' });
  });

  it('applies a real attack (u1 strikes u2)', async () => {
    const { matchId, sessionId } = await sessionFor('p1');
    const { code, json } = await postJson(`/match/${matchId}/dispatch`, {
      sessionId,
      requestId: 'atk1',
      type: 'unit.attack',
      payload: { id: 'u1', target: 'u2' },
    });
    expect(code).toBe(200);
    expect(json).toMatchObject({ status: 'applied' });
  });

  it('carries kernel errors as 200 outcomes (never re-interpreted)', async () => {
    const { matchId, sessionId } = await sessionFor('p1');
    const garbage = await postJson(`/match/${matchId}/dispatch`, {
      sessionId,
      requestId: 'd2',
      type: 'bogus.transition',
      payload: {},
    });
    expect(garbage.code).toBe(200);
    expect(garbage.json).toMatchObject({ status: 'error', code: 'UNKNOWN_TRANSITION' });
    const malformed = await postJson(`/match/${matchId}/dispatch`, {
      sessionId,
      type: 'world.noop',
      payload: {},
    });
    expect(malformed.code).toBe(200);
    expect(malformed.json).toMatchObject({ status: 'error', code: 'MALFORMED_REQUEST' });
  });

  it('rejects bad sessions', async () => {
    const { matchId } = await sessionFor('p1');
    expect(
      await postJson(`/match/${matchId}/dispatch`, {
        requestId: 'd1',
        type: 'world.noop',
        payload: {},
      }),
    ).toMatchObject({ code: 400 });
    expect(
      await postJson(`/match/${matchId}/dispatch`, {
        sessionId: 'NOPE',
        requestId: 'd1',
        type: 'world.noop',
        payload: {},
      }),
    ).toMatchObject({ code: 400 });
  });

  it('rejects malformed dispatch bodies', async () => {
    const { matchId } = await sessionFor('p1');
    expect(await postJson(`/match/${matchId}/dispatch`, null)).toMatchObject({ code: 400 });
    expect(await post(`/match/${matchId}/dispatch`, '{oops')).toMatchObject({ code: 400 });
  });

  it('404s unknown matches', async () => {
    expect(
      await postJson('/match/NOPE/dispatch', {
        sessionId: 's',
        requestId: 'd1',
        type: 'world.noop',
        payload: {},
      }),
    ).toMatchObject({ code: 404 });
  });
});

describe('GET /match/:id/state (frozen snapshot)', () => {
  it('serves the skirmish (3 units, 2 holders)', async () => {
    const { matchId } = await sessionFor('p1');
    const { code, json } = await get(`/match/${matchId}/state`);
    expect(code).toBe(200);
    const snapshot = json as { units: { units: unknown[] }; players: unknown[] };
    expect(snapshot.units.units).toHaveLength(3);
    expect(snapshot.players).toHaveLength(2);
  });

  it('404s unknown matches', async () => {
    expect(await get('/match/NOPE/state')).toMatchObject({ code: 404 });
  });
});

describe('GET /match/:id/events (SSE backlog + live)', () => {
  it('replays the backlog from zero', async () => {
    const { matchId } = await sessionFor('p1');
    const stream = openSse(`/match/${matchId}/events?from=0`);
    try {
      expect(await stream.code).toBe(200);
      await waitFor(() => stream.chunks.length > 0, 'backlog chunk');
      expect(stream.chunks.join('')).toContain('data: ');
    } finally {
      stream.close();
    }
    const implicit = openSse(`/match/${matchId}/events`);
    try {
      expect(await implicit.code).toBe(200);
      await waitFor(() => implicit.chunks.length > 0, 'implicit backlog chunk');
    } finally {
      implicit.close();
    }
  });

  it('sends nothing past the tip', async () => {
    const { matchId } = await sessionFor('p1');
    const stream = openSse(`/match/${matchId}/events?from=999`);
    try {
      expect(await stream.code).toBe(200);
      await sleep(60);
      expect(stream.chunks).toEqual([]);
    } finally {
      stream.close();
    }
  });

  it('rejects bad cursors', async () => {
    const { matchId } = await sessionFor('p1');
    expect(await get(`/match/${matchId}/events?from=abc`)).toMatchObject({ code: 400 });
    expect(await get(`/match/${matchId}/events?from=-1`)).toMatchObject({ code: 400 });
  });

  it('404s unknown matches', async () => {
    expect(await get('/match/NOPE/events')).toMatchObject({ code: 404 });
  });

  it('pushes live battles to open streams', async () => {
    const { matchId, sessionId } = await sessionFor('p1');
    const stream = openSse(`/match/${matchId}/events?from=0`);
    try {
      await waitFor(() => stream.chunks.length > 0, 'backlog chunk');
      stream.chunks.length = 0;
      await postJson(`/match/${matchId}/dispatch`, {
        sessionId,
        requestId: 'atk-live',
        type: 'unit.attack',
        payload: { id: 'u1', target: 'u2' },
      });
      await waitFor(() => stream.chunks.join('').includes('unit.attacked'), 'attack event');
    } finally {
      stream.close();
    }
  });

  it('fans out to every stream, survives disconnects', async () => {
    const { matchId, sessionId } = await sessionFor('p1');
    const first = openSse(`/match/${matchId}/events?from=0`);
    const second = openSse(`/match/${matchId}/events?from=0`);
    try {
      await waitFor(() => first.chunks.length > 0 && second.chunks.length > 0, 'both backlogs');
      first.chunks.length = 0;
      second.chunks.length = 0;
      first.close();
      await postJson(`/match/${matchId}/dispatch`, {
        sessionId,
        requestId: 'atk-fan',
        type: 'unit.attack',
        payload: { id: 'u1', target: 'u2' },
      });
      await waitFor(() => second.chunks.join('').includes('unit.attacked'), 'fanout event');
      await sleep(40);
      expect(first.chunks).toEqual([]);
    } finally {
      second.close();
    }
  });
});

describe('routing (unknown paths fail loud)', () => {
  it('404s non-match roots', async () => {
    expect(await get('/nope')).toMatchObject({ code: 404 });
  });

  it('404s wrong methods and short paths', async () => {
    const { matchId } = await sessionFor('p1');
    expect(await get('/match')).toMatchObject({ code: 404 });
    expect(await get(`/match/${matchId}`)).toMatchObject({ code: 404 });
    expect(await get(`/match/${matchId}/bogus`)).toMatchObject({ code: 404 });
  });

  it('404s method-swapped endpoints', async () => {
    const { matchId } = await sessionFor('p1');
    expect(await get(`/match/${matchId}/join`)).toMatchObject({ code: 404 });
    expect(await get(`/match/${matchId}/dispatch`)).toMatchObject({ code: 404 });
    expect(await postJson(`/match/${matchId}/events`, {})).toMatchObject({ code: 404 });
    expect(await postJson(`/match/${matchId}/state`, {})).toMatchObject({ code: 404 });
    expect(await get(`/match/${matchId}/heartbeat`)).toMatchObject({ code: 404 });
    expect(await get(`/match/${matchId}/leave`)).toMatchObject({ code: 404 });
    expect(await get(`/match/${matchId}/close`)).toMatchObject({ code: 404 });
  });

  it('treats handler throws as 500 faults (TEST MOCK req)', async () => {
    const handler = createTransport();
    const req = new EventEmitter() as unknown as IncomingMessage;
    Object.defineProperty(req, 'url', {
      get() {
        throw new Error('TEST MOCK: url fault');
      },
    });
    Object.defineProperty(req, 'method', { value: 'GET' });
    let code = 0;
    let text = '';
    const res = {
      setHeader() {},
      writeHead(c: number) {
        code = c;
      },
      end(t: string) {
        text = t;
      },
    } as unknown as ServerResponse;
    handler(req, res);
    await sleep(20);
    expect(code).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: 'transport fault' });
  });
});

describe('POST /match/:id/heartbeat (roster)', () => {
  it('reports the sorted online roster', async () => {
    const first = await sessionFor('p2');
    await postJson(`/match/${first.matchId}/join`, { playerId: 'p1' });
    const beat = await postJson(`/match/${first.matchId}/heartbeat`, {
      sessionId: first.sessionId,
    });
    expect(beat.code).toBe(200);
    expect(beat.json).toEqual({ online: ['p1', 'p2'] });
  });

  it('dedupes multi-session players', async () => {
    const { matchId } = await sessionFor('p1');
    const twice = await postJson(`/match/${matchId}/join`, { playerId: 'p1' });
    const { json } = await postJson(`/match/${matchId}/heartbeat`, {
      sessionId: (twice.json as { sessionId: string }).sessionId,
    });
    expect(json).toEqual({ online: ['p1'] });
  });

  it('rejects bad heartbeats', async () => {
    const { matchId } = await sessionFor('p1');
    expect(await postJson(`/match/${matchId}/heartbeat`, {})).toMatchObject({ code: 400 });
    expect(await postJson(`/match/${matchId}/heartbeat`, { sessionId: 'NOPE' })).toMatchObject({
      code: 400,
    });
    expect(await postJson(`/match/${matchId}/heartbeat`, null)).toMatchObject({ code: 400 });
    expect(await post(`/match/${matchId}/heartbeat`, '{oops')).toMatchObject({ code: 400 });
  });

  it('404s unknown matches', async () => {
    expect(await postJson('/match/NOPE/heartbeat', { sessionId: 's' })).toMatchObject({
      code: 404,
    });
  });
});

describe('POST /match/:id/leave (goodbye)', () => {
  it('removes the session and reports the rest', async () => {
    const first = await sessionFor('p1');
    await postJson(`/match/${first.matchId}/join`, { playerId: 'p2' });
    const bye = await postJson(`/match/${first.matchId}/leave`, { sessionId: first.sessionId });
    expect(bye.code).toBe(200);
    expect(bye.json).toEqual({ online: ['p2'] });
    expect(
      await postJson(`/match/${first.matchId}/leave`, { sessionId: first.sessionId }),
    ).toMatchObject({ code: 400 });
  });

  it('rejects bad goodbyes', async () => {
    const { matchId } = await sessionFor('p1');
    expect(await postJson(`/match/${matchId}/leave`, {})).toMatchObject({ code: 400 });
    expect(await postJson(`/match/${matchId}/leave`, null)).toMatchObject({ code: 400 });
    expect(await post(`/match/${matchId}/leave`, '{oops')).toMatchObject({ code: 400 });
  });

  it('404s unknown matches', async () => {
    expect(await postJson('/match/NOPE/leave', { sessionId: 's' })).toMatchObject({ code: 404 });
  });
});

describe('presence events + sweeps (manual clock)', () => {
  it('announces joins live (never in backlog)', async () => {
    await withClock(async () => {
      const { matchId } = await sessionFor('p1');
      const stream = openSse(`/match/${matchId}/events?from=0`);
      try {
        await waitFor(() => stream.chunks.length > 0, 'backlog chunk');
        expect(stream.chunks.join('')).not.toContain('event: presence');
        stream.chunks.length = 0;
        await postJson(`/match/${matchId}/join`, { playerId: 'p2' });
        await waitFor(() => stream.chunks.join('').includes('event: presence'), 'join presence');
        expect(stream.chunks.join('')).toContain('"playerId":"p2"');
        expect(stream.chunks.join('')).toContain('"online":true');
      } finally {
        stream.close();
      }
    });
  });

  it('sweeps idle sessions (timeout = death, rejoin)', async () => {
    await withClock(async (clock) => {
      const { matchId, sessionId } = await sessionFor('p1');
      const stream = openSse(`/match/${matchId}/events?from=0`);
      try {
        await waitFor(() => stream.chunks.length > 0, 'backlog chunk');
        stream.chunks.length = 0;
        clock.now += PRESENCE_TIMEOUT_MS;
        expect(await postJson(`/match/${matchId}/heartbeat`, { sessionId })).toMatchObject({
          code: 200,
        });
        clock.now += PRESENCE_TIMEOUT_MS + 1;
        await postJson(`/match/${matchId}/join`, { playerId: 'p2' });
        await waitFor(() => stream.chunks.join('').includes('"online":false'), 'timeout presence');
        expect(stream.chunks.join('')).toContain('"playerId":"p1"');
        expect(await postJson(`/match/${matchId}/heartbeat`, { sessionId })).toMatchObject({
          code: 400,
        });
        expect(await postJson(`/match/${matchId}/leave`, { sessionId })).toMatchObject({
          code: 400,
        });
        expect(await postJson(`/match/${matchId}/join`, { playerId: 'p1' })).toMatchObject({
          code: 200,
        });
      } finally {
        stream.close();
      }
    });
  });

  it('counts dispatches as activity', async () => {
    await withClock(async (clock) => {
      const { matchId, sessionId } = await sessionFor('p1');
      clock.now += PRESENCE_TIMEOUT_MS - 10_000;
      await postJson(`/match/${matchId}/dispatch`, {
        sessionId,
        requestId: 'keep',
        type: 'world.noop',
        payload: {},
      });
      clock.now += PRESENCE_TIMEOUT_MS - 10_000;
      expect(await postJson(`/match/${matchId}/heartbeat`, { sessionId })).toMatchObject({
        code: 200,
      });
    });
  });
});

describe('GET /matches (lobby)', () => {
  it('lists nothing on a fresh server', async () => {
    await withClock(async () => {
      expect(await get('/matches')).toEqual({ code: 200, json: [] });
    });
  });

  it('lists one open table exactly', async () => {
    await withClock(async () => {
      const created = await postJson('/match', {});
      const matchId = (created.json as { matchId: string }).matchId;
      expect(await get('/matches')).toEqual({
        code: 200,
        json: [
          {
            matchId,
            players: ['p1', 'p2'],
            online: [],
            status: 'open',
            revision: 0,
            createdAt: 1_000_000,
          },
        ],
      });
    });
  });

  it('tracks roster, revision and the finished line (join-guarded, dispatch-carried)', async () => {
    const { matchId, sessionId } = await sessionFor('p1');
    const joined = await postJson(`/match/${matchId}/join`, { playerId: 'p2' });
    const tables = (await get('/matches')).json as { matchId: string; online: string[] }[];
    expect(tables.find((table) => table.matchId === matchId)?.online).toEqual(['p1', 'p2']);
    await spendAll(matchId, sessionId, (joined.json as { sessionId: string }).sessionId);
    const done = (await get('/matches')).json as {
      matchId: string;
      status: string;
      revision: number;
    }[];
    const table = done.find((entry) => entry.matchId === matchId);
    expect(table?.status).toBe('finished');
    expect(table?.revision).toBe(20);
    const late = await postJson(`/match/${matchId}/join`, { playerId: 'p1' });
    expect(late).toEqual({ code: 400, json: { error: 'match finished' } });
    const last = await postJson(`/match/${matchId}/dispatch`, {
      sessionId,
      requestId: 'after-end',
      type: 'world.noop',
      payload: {},
    });
    expect(last).toEqual({ code: 200, json: { status: 'error', code: 'MATCH_FINISHED' } });
  });

  it('sweeps ghosts before listing', async () => {
    await withClock(async (clock) => {
      await sessionFor('p1');
      clock.now += PRESENCE_TIMEOUT_MS + 1;
      const tables = (await get('/matches')).json as { online: string[] }[];
      expect(tables).toHaveLength(1);
      expect(tables[0]?.online).toEqual([]);
    });
  });

  it('404s lobby lookalikes', async () => {
    expect(await get('/matches/x')).toMatchObject({ code: 404 });
    expect(await postJson('/matches', {})).toMatchObject({ code: 404 });
  });
});

describe('GET /results (history)', () => {
  it('lists nothing on a fresh server', async () => {
    await withClock(async () => {
      expect(await get('/results')).toEqual({ code: 200, json: [] });
    });
  });

  it('records an early close with live scores', async () => {
    await withClock(async () => {
      const created = await postJson('/match', { seed: 7 });
      const matchId = (created.json as { matchId: string }).matchId;
      const joined = await postJson(`/match/${matchId}/join`, { playerId: 'p1' });
      const { sessionId } = joined.json as { sessionId: string };
      await postJson(`/match/${matchId}/dispatch`, {
        sessionId,
        requestId: 'r1',
        type: 'world.noop',
        payload: {},
      });
      expect(await postJson(`/match/${matchId}/close`, {})).toMatchObject({ code: 200 });
      expect(await get('/results')).toEqual({
        code: 200,
        json: [
          {
            matchId,
            seed: 7,
            status: 'ongoing',
            outcome: null,
            winner: null,
            condition: null,
            scores: { p1: 177, p2: 113 },
            revision: 1,
            createdAt: 1_000_000,
            closedAt: 1_000_000,
          },
        ],
      });
    });
  });

  it('records a finished win with its crown (skirmish p1 outscores)', async () => {
    const { matchId, sessionId } = await sessionFor('p1');
    const joined = await postJson(`/match/${matchId}/join`, { playerId: 'p2' });
    await spendAll(matchId, sessionId, (joined.json as { sessionId: string }).sessionId);
    await postJson(`/match/${matchId}/close`, {});
    const history = (await get('/results')).json as {
      matchId: string;
      status: string;
      outcome: string;
      winner: string;
      condition: string;
      revision: number;
    }[];
    expect(history.find((row) => row.matchId === matchId)).toMatchObject({
      status: 'finished',
      outcome: 'win',
      winner: 'p1',
      condition: 'score-superior',
      revision: 20,
    });
  });

  it('evicts the oldest past the cap', async () => {
    await withClock(async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const created = await postJson('/match', {});
        const matchId = (created.json as { matchId: string }).matchId;
        ids.push(matchId);
        await postJson(`/match/${matchId}/close`, {});
      }
      const history = (await get('/results')).json as { matchId: string }[];
      expect(history.map((row) => row.matchId)).toEqual([ids[1], ids[2]]);
    }, 2);
  });

  it('404s history lookalikes', async () => {
    expect(await get('/results/x')).toMatchObject({ code: 404 });
    expect(await postJson('/results', {})).toMatchObject({ code: 404 });
  });
});

describe('GET /ratings (elo)', () => {
  async function finishSkirmish(): Promise<void> {
    const created = await postJson('/match', {});
    const matchId = (created.json as { matchId: string }).matchId;
    const first = await postJson(`/match/${matchId}/join`, { playerId: 'p1' });
    const second = await postJson(`/match/${matchId}/join`, { playerId: 'p2' });
    await spendAll(
      matchId,
      (first.json as { sessionId: string }).sessionId,
      (second.json as { sessionId: string }).sessionId,
    );
    await postJson(`/match/${matchId}/close`, {});
  }

  it('rates nothing on a fresh server', async () => {
    await withClock(async () => {
      expect(await get('/ratings')).toEqual({ code: 200, json: {} });
    });
  });

  it('rates a finished win from fresh wallets', async () => {
    await withClock(async () => {
      await finishSkirmish();
      expect(await get('/ratings')).toEqual({ code: 200, json: { p1: 1216, p2: 1184 } });
    });
  });

  it('leaves ratings untouched on early close', async () => {
    await withClock(async () => {
      const { matchId } = await sessionFor('p1');
      await postJson(`/match/${matchId}/close`, {});
      expect(await get('/ratings')).toEqual({ code: 200, json: {} });
    });
  });

  it('compounds repeat wins with shrinking gains', async () => {
    await withClock(async () => {
      await finishSkirmish();
      await finishSkirmish();
      expect(await get('/ratings')).toEqual({ code: 200, json: { p1: 1231, p2: 1169 } });
    });
  });

  it('404s ratings lookalikes', async () => {
    expect(await get('/ratings/x')).toMatchObject({ code: 404 });
    expect(await postJson('/ratings', {})).toMatchObject({ code: 404 });
  });
});

describe('rate limiting (one shared window)', () => {
  it('pins the shipped default policy', () => {
    expect(DEFAULT_RATE_LIMIT).toEqual({ windowMs: 60_000, max: 300 });
  });

  it('refuses past the max, then serves again past the window', async () => {
    await withClock(
      async (clock) => {
        expect((await get('/ratings')).code).toBe(200);
        expect((await get('/ratings')).code).toBe(200);
        expect(await get('/ratings')).toEqual({ code: 429, json: { error: 'rate limited' } });
        clock.now += 60_000;
        expect((await get('/ratings')).code).toBe(200);
      },
      50,
      { windowMs: 60_000, max: 2 },
    );
  });

  it('shares one bucket across claimed identities (no key evasion)', async () => {
    const once = (xff: string): Promise<{ code: number; json: unknown }> =>
      new Promise((resolve, reject) => {
        const req = httpRequest(
          { port, path: '/ratings', method: 'GET', headers: { 'X-Forwarded-For': xff } },
          (res) => {
            let text = '';
            res.on('data', (chunk) => {
              text += chunk;
            });
            res.on('end', () => {
              resolve({ code: res.statusCode ?? 0, json: JSON.parse(text) });
            });
          },
        );
        req.on('error', reject);
        req.end();
      });
    await withClock(
      async () => {
        expect((await once('spoof-a')).code).toBe(200);
        expect(await once('spoof-b')).toEqual({ code: 429, json: { error: 'rate limited' } });
      },
      50,
      { windowMs: 60_000, max: 1 },
    );
  });
});

describe('body limits (64KB choke)', () => {
  it('pins the shipped body cap', () => {
    expect(MAX_BODY_BYTES).toBe(64_000);
  });

  it('refuses oversized bodies with 413 (valid JSON, too many bytes)', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(70_000) });
    expect(big.length).toBeGreaterThan(MAX_BODY_BYTES);
    expect(await post('/match', big)).toEqual({ code: 413, json: { error: 'body too large' } });
  });

  it('serves bodies exactly at the cap (strictly-greater trips)', async () => {
    const pad = 'x'.repeat(MAX_BODY_BYTES - 10);
    const edge = JSON.stringify({ pad });
    expect(edge.length).toBe(MAX_BODY_BYTES);
    const forged = await post('/match', edge);
    expect(forged.code).toBe(200);
    expect(typeof (forged.json as { matchId: string }).matchId).toBe('string');
  });
});

describe('audit hardness pins (M084)', () => {
  it('resolves dot-segments via the URL parser (no fs to escape — Map router)', async () => {
    await withClock(async () => {
      const seen = await new Promise<{ code: number; json: unknown }>((resolve, reject) => {
        const req = httpRequest({ port, path: '/match/../ratings', method: 'GET' }, (res) => {
          let text = '';
          res.on('data', (chunk) => {
            text += chunk;
          });
          res.on('end', () => {
            resolve({ code: res.statusCode ?? 0, json: JSON.parse(text) });
          });
        });
        req.on('error', reject);
        req.end();
      });
      expect(seen).toEqual({ code: 200, json: {} });
    });
  });

  it('404s wrong methods on forged routes (PUT forge)', async () => {
    const code = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ port, path: '/match', method: 'PUT' }, (res) => {
        res.resume();
        res.on('end', () => {
          resolve(res.statusCode ?? 0);
        });
      });
      req.on('error', reject);
      req.end('{}');
    });
    expect(code).toBe(404);
  });

  it('answers giant strings gracefully (engine id fence, exact)', async () => {
    const { matchId, sessionId } = await sessionFor('p1');
    const outcome = await postJson(`/match/${matchId}/dispatch`, {
      sessionId,
      requestId: 'r'.repeat(60_000),
      type: 'world.noop',
      payload: {},
    });
    expect(outcome).toEqual({ code: 200, json: { status: 'error', code: 'MALFORMED_REQUEST' } });
  });

  it('forges past deep-but-valid JSON (no parser crash, exact)', async () => {
    const deep = `[`.repeat(20_000) + `]`.repeat(20_000);
    expect(deep.length).toBeLessThan(MAX_BODY_BYTES);
    const forged = await post('/match', deep);
    expect(forged.code).toBe(200);
    expect(typeof (forged.json as { matchId: string }).matchId).toBe('string');
  });
});

describe('watcher cap (flood fence)', () => {
  it('pins the shipped watcher cap', () => {
    expect(MAX_STREAMS_PER_MATCH).toBe(32);
  });

  it('503s the 33rd watcher and frees slots on close', async () => {
    await withClock(async () => {
      const { matchId } = await sessionFor('p1');
      const crowd: { close: () => void }[] = [];
      for (let i = 0; i < MAX_STREAMS_PER_MATCH; i += 1) {
        const stream = openSse(`/match/${matchId}/events?from=0`);
        expect(await stream.code).toBe(200);
        crowd.push(stream);
      }
      const extra = openSse(`/match/${matchId}/events?from=0`);
      expect(await extra.code).toBe(503);
      await extra.ended;
      crowd[0]?.close();
      let seated = false;
      for (let i = 0; i < 200 && !seated; i += 1) {
        const attempt = openSse(`/match/${matchId}/events?from=0`);
        if ((await attempt.code) === 200) {
          seated = true;
          attempt.close();
        } else {
          await attempt.ended;
          await sleep(10);
        }
      }
      expect(seated).toBe(true);
      for (const stream of crowd) {
        stream.close();
      }
    });
  });
});

describe('POST /match/:id/close (last call)', () => {
  it('ends streams, deletes the table, refuses seconds', async () => {
    const { matchId } = await sessionFor('p1');
    const stream = openSse(`/match/${matchId}/events?from=0`);
    try {
      await waitFor(() => stream.chunks.length > 0, 'backlog chunk');
      expect(await postJson(`/match/${matchId}/close`, {})).toEqual({
        code: 200,
        json: { closed: true },
      });
      await stream.ended;
      expect(await postJson(`/match/${matchId}/join`, { playerId: 'p1' })).toMatchObject({
        code: 404,
      });
      expect(await postJson(`/match/${matchId}/close`, {})).toMatchObject({ code: 404 });
    } finally {
      stream.close();
    }
  });
});

describe('root + preflight + CORS (M072 deploy seams)', () => {
  it('serves health at /', async () => {
    expect(await get('/')).toEqual({ code: 200, json: { service: 'ai-warlords', ok: true } });
  });

  it('404s non-GET roots', async () => {
    expect(await postJson('/', {})).toMatchObject({ code: 404 });
  });

  it('answers preflights with CORS', async () => {
    const { code, headers } = await options('/match/NOPE/dispatch');
    expect(code).toBe(204);
    expect(headers['access-control-allow-origin']).toBe('*');
    expect(headers['access-control-allow-methods']).toContain('POST');
  });

  it('tags real responses with CORS', async () => {
    const headers = await new Promise<Record<string, string | string[] | undefined>>(
      (resolve, reject) => {
        const req = httpRequest({ port, path: '/match', method: 'POST' }, (res) => {
          res.resume();
          res.on('end', () => {
            resolve({ ...res.headers });
          });
        });
        req.on('error', reject);
        req.end(JSON.stringify({}));
      },
    );
    expect(headers['access-control-allow-origin']).toBe('*');
  });

  it('hardens real responses (nosniff + deny-framing)', async () => {
    const headers = await new Promise<Record<string, string | string[] | undefined>>(
      (resolve, reject) => {
        const req = httpRequest({ port, path: '/ratings', method: 'GET' }, (res) => {
          res.resume();
          res.on('end', () => {
            resolve({ ...res.headers });
          });
        });
        req.on('error', reject);
        req.end();
      },
    );
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
  });
});
